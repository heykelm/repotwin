import { ValidationKind, ValidationStatus } from './command-runner.js';

export interface ExtractedFailure {
  testName?: string;
  file?: string;
  line?: number;
  message?: string;
  expected?: string;
  received?: string;
  diff?: string;
  stackSnippet?: string[];
}

export interface CompactSieveResult {
  kind: ValidationKind;
  status: ValidationStatus;
  summary: string;
  failures: ExtractedFailure[];
  compactOutput: string;
  metrics: {
    rawCharacters: number;
    compactCharacters: number;
    estimatedRawTokens: number;
    estimatedCompactTokens: number;
    tokensPreserved: number;
    savingsPercent: number;
  };
}

/**
 * Strips ANSI terminal escape sequences (colors, cursor movements).
 */
export function stripAnsi(text: string): string {
  return text.replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '');
}

/**
 * Estimates LLM token count from text using standard ~4 chars/token heuristic.
 */
export function estimateTokens(text: string): number {
  if (!text || text.length === 0) return 0;
  return Math.ceil(text.length / 4);
}

/**
 * Extracts compact failure details from common test runners
 * (Vitest, Jest, Mocha, Pytest, Cargo, Go test, Flutter).
 */
export function extractFailuresFromOutput(output: string, kind: ValidationKind): ExtractedFailure[] {
  const clean = stripAnsi(output);
  const lines = clean.split('\n');
  const failures: ExtractedFailure[] = [];

  let currentFailure: ExtractedFailure | null = null;
  let capturingDiff = false;
  let diffLines: string[] = [];

  function finalizeDiff() {
    if (capturingDiff && diffLines.length > 0 && currentFailure) {
      currentFailure.diff = diffLines.join('\n');
      if (!currentFailure.message) {
        currentFailure.message = 'Assertion failed (value mismatch)';
      }
    }
    capturingDiff = false;
    diffLines = [];
  }

  function pushCurrent() {
    finalizeDiff();
    if (currentFailure) {
      failures.push(currentFailure);
      currentFailure = null;
    }
  }

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    const line = rawLine.trim();

    // Skip generic runner package footers (e.g. "FAIL", "FAIL\tpackage/path", "exit status 1")
    if (/^FAIL(?:\t|\s*$|\s+(?:[a-zA-Z0-9_\-./]+\/(?:pkg|cmd|internal|pkg|v\d+)|github\.com))/.test(line)) {
      continue;
    }

    // 1. Go test: "--- FAIL: TestName (0.00s)" and "    file_test.go:42: expected 100, got 200"
    const goTestFailMatch = line.match(/^---\s+FAIL:\s+([^\s]+)/);
    const goAssertMatch = rawLine.match(/^\s*([a-zA-Z0-9_\-./\\]+\.go):(\d+):\s+(.*)$/);

    if (goTestFailMatch) {
      pushCurrent();
      currentFailure = {
        testName: goTestFailMatch[1],
        stackSnippet: []
      };
      continue;
    }

    if (goAssertMatch) {
      if (!currentFailure) {
        currentFailure = { stackSnippet: [] };
      }
      if (currentFailure.message) {
        const testName: string | undefined = currentFailure.testName;
        pushCurrent();
        currentFailure = { testName, stackSnippet: [] };
      }
      currentFailure.file = goAssertMatch[1];
      currentFailure.line = parseInt(goAssertMatch[2], 10);
      currentFailure.message = goAssertMatch[3].trim();
      continue;
    }

    // 2. Pytest: "FAILED test_file.py::test_function - AssertionError: ..."
    const pytestMatch = line.match(/FAILED\s+([^:]+)::([^\s]+)(?:\s+-\s+(.*))?/);
    if (pytestMatch) {
      pushCurrent();
      currentFailure = {
        file: pytestMatch[1],
        testName: pytestMatch[2],
        message: pytestMatch[3] || 'Assertion failed',
        stackSnippet: []
      };
      continue;
    }

    // 3. Cargo test: "test tests::test_name ... FAILED" or "assertion failed: `(left == right)`"
    const cargoFailMatch = line.match(/test\s+([^\s]+)\s+\.\.\.\s+FAILED/);
    const cargoAssertMatch = line.match(/assertion `(.*?)` failed/);
    if (cargoFailMatch) {
      pushCurrent();
      currentFailure = {
        testName: cargoFailMatch[1],
        message: 'Cargo test failed',
        stackSnippet: []
      };
      continue;
    }

    // 4. Jest failing file header: "FAIL path/to/file.test.ts"
    const jestFileFailMatch = line.match(/^FAIL\s+([a-zA-Z0-9_\-./\\]+\.(?:ts|js|jsx|tsx))\b/);
    if (jestFileFailMatch) {
      if (!currentFailure) {
        currentFailure = { file: jestFileFailMatch[1], stackSnippet: [] };
      } else if (!currentFailure.file) {
        currentFailure.file = jestFileFailMatch[1];
      }
      continue;
    }

    // 5. Jest / Vitest individual test failure: "● Suite > test name" or "✕ test name" or "❯ test name"
    const isReportFooter = line.includes('Test Files') || line.includes('Tests:') || line.includes('Duration:');
    const jestIndividualFailMatch = line.match(/(?:✕|×|❯|●)\s+(?:.*?>\s*)?(.*?)(?:\s+\(\d+m?s\))?$/i);
    if (jestIndividualFailMatch && !isReportFooter) {
      const candidateName = jestIndividualFailMatch[1].trim();
      if (candidateName && candidateName.length > 2 && !candidateName.startsWith('http')) {
        if (currentFailure && !currentFailure.testName) {
          currentFailure.testName = candidateName;
        } else {
          pushCurrent();
          currentFailure = {
            testName: candidateName,
            stackSnippet: []
          };
        }
      }
    }

    const jestAssertionMatch = line.match(/(?:AssertionError|Error):\s+(.*)/i);
    if (jestAssertionMatch) {
      if (!currentFailure) currentFailure = { stackSnippet: [] };
      currentFailure.message = jestAssertionMatch[1];
    } else if (cargoAssertMatch) {
      if (!currentFailure) currentFailure = { stackSnippet: [] };
      currentFailure.message = cargoAssertMatch[0];
    }

    // 5. Multiline diff detection (Jest, Vitest, diffs)
    const vitestExpectedDiffMatch = line.match(/(?:expected|diff:)\s+['"]?(.*?)['"]?\s+to (?:deeply equal|equal|match)\s+['"]?(.*?)['"]?$/i);
    const diffStartMatch = line.match(/^(?:[-+]\s*(?:Expected|Received)|(?:Expected|Received):)/i);

    if (vitestExpectedDiffMatch) {
      if (!currentFailure) currentFailure = { stackSnippet: [] };
      currentFailure.expected = vitestExpectedDiffMatch[2];
      currentFailure.received = vitestExpectedDiffMatch[1];
      currentFailure.diff = `- expected: ${vitestExpectedDiffMatch[2]}\n+ received: ${vitestExpectedDiffMatch[1]}`;
    } else if (diffStartMatch) {
      if (!currentFailure) currentFailure = { stackSnippet: [] };
      capturingDiff = true;
      diffLines.push(rawLine.trimEnd());
    } else if (capturingDiff) {
      // While capturing diff, accumulate diff lines (+, -, spaces, object properties)
      const isDiffContinuation = /^[ \t]*[-+]/m.test(rawLine) ||
        /^[ \t]+(?:Object|Array|\{|\}|"[^"]+":)/.test(rawLine) ||
        line.startsWith('-') || line.startsWith('+');

      if (isDiffContinuation) {
        diffLines.push(rawLine.trimEnd());
      } else if (line.startsWith('at ') || line.startsWith('FAIL') || isReportFooter) {
        finalizeDiff();
      } else if (line.length === 0 && diffLines.length > 0) {
        diffLines.push('');
      } else if (diffLines.length > 0) {
        finalizeDiff();
      }
    }

    // Cargo displays assertion operands on separate lines after the panic.
    const cargoValue = line.match(/^(left|right):\s*(.*)$/);
    if (cargoValue && currentFailure) {
      const label = cargoValue[1] === 'left' ? 'received' : 'expected';
      currentFailure.diff = [currentFailure.diff, `${label}: ${cargoValue[2]}`].filter(Boolean).join('\n');
    }

    // 6. File & Line matching
    const fileLineMatch = line.match(/(?:at\s+(?:.*?\()?)?([a-zA-Z0-9_\-./\\]+\.(?:ts|js|jsx|tsx|py|rs|go|dart)):(\d+)(?::\d+)?\)?/);
    if (fileLineMatch && currentFailure) {
      const matchPath = fileLineMatch[1];
      if (!matchPath.includes('node_modules') && !matchPath.includes('.cargo') && !matchPath.includes('site-packages')) {
        if (!currentFailure.file) {
          currentFailure.file = matchPath;
        }
        if (!currentFailure.line) {
          currentFailure.line = parseInt(fileLineMatch[2], 10);
        }
      }
    }

    // Capture non-node_modules stack lines (max 4 lines)
    if (line.startsWith('at ') && currentFailure && currentFailure.stackSnippet && currentFailure.stackSnippet.length < 4) {
      if (!line.includes('node_modules') && !line.includes('node:internal')) {
        currentFailure.stackSnippet.push(line);
      }
    }
  }

  pushCurrent();

  // Fallback: If no structured failure was extracted but output contains error keywords, extract top error lines
  if (failures.length === 0 && clean.length > 0) {
    const errorLines = lines
      .map(l => l.trim())
      .filter(l => l.length > 0 && !l.includes('node_modules') && !l.includes('node:internal'))
      .filter(l => /(?:error|fail|exception|assert|fatal|syntaxerror|typeerror)/i.test(l))
      .slice(0, 5);

    if (errorLines.length > 0) {
      failures.push({
        message: errorLines.join(' | '),
        stackSnippet: errorLines.slice(1, 4)
      });
    }
  }

  return failures;
}

/**
 * Sieves command output down to its surgical essence, eliminating terminal noise
 * and computing tokens preserved.
 */
export function sieveCommandOutput(
  rawOutput: string,
  kind: ValidationKind,
  status: ValidationStatus
): CompactSieveResult {
  const clean = stripAnsi(rawOutput || '').trim();
  const rawCharacters = clean.length;
  const estimatedRawTokens = estimateTokens(clean);

  if (status === 'passed') {
    // For successful commands, return a one-line confirmation with summary
    let summary = `All ${kind} checks passed successfully.`;
    const testsCountMatch = clean.match(/Tests\s+(\d+\s+passed)/i) || clean.match(/(\d+)\s+passed/i);
    const durationMatch = clean.match(/Duration\s+([\d.]+m?s)/i) || clean.match(/in\s+([\d.]+s)/i);

    if (testsCountMatch || durationMatch) {
      const count = testsCountMatch ? testsCountMatch[1] : 'all checks';
      const dur = durationMatch ? ` in ${durationMatch[1]}` : '';
      summary = `PASS: ${count}${dur}.`;
    }

    const compactOutput = `✅ ${summary}`;
    const compactCharacters = compactOutput.length;
    const estimatedCompactTokens = estimateTokens(compactOutput);
    const tokensPreserved = Math.max(0, estimatedRawTokens - estimatedCompactTokens);
    const savingsPercent = estimatedRawTokens > 0 ? Math.round((tokensPreserved / estimatedRawTokens) * 100) : 0;

    return {
      kind,
      status,
      summary,
      failures: [],
      compactOutput,
      metrics: {
        rawCharacters,
        compactCharacters,
        estimatedRawTokens,
        estimatedCompactTokens,
        tokensPreserved,
        savingsPercent
      }
    };
  }

  // For failed / timed-out / unavailable commands
  const failures = extractFailuresFromOutput(clean, kind);
  const failureCount = failures.length > 0 ? failures.length : 1;
  const summary = `FAILED: ${failureCount} failure${failureCount > 1 ? 's' : ''} detected in ${kind} execution.`;

  const outputLines: string[] = [`❌ ${summary}`];

  for (let i = 0; i < failures.length; i++) {
    const f = failures[i];
    const prefix = failures.length > 1 ? `[Failure ${i + 1}] ` : '';
    if (f.testName) outputLines.push(`${prefix}Test: ${f.testName}`);
    if (f.file) outputLines.push(`Location: ${f.file}${f.line ? `:${f.line}` : ''}`);
    if (f.message) outputLines.push(`Error: ${f.message}`);
    if (f.diff) outputLines.push(`Diff:\n${f.diff}`);
    if (f.stackSnippet && f.stackSnippet.length > 0) {
      outputLines.push(`Stack:\n  ${f.stackSnippet.join('\n  ')}`);
    }
  }

  // Anti-blindness fallback: if no failure or if extracted failure lacks actionable details (message, diff, location)
  const hasActionableDetail = failures.some(f => Boolean(f.message || f.diff || (f.file && f.line)));
  if (failures.length === 0 || !hasActionableDetail) {
    const fallbackLines = clean.split('\n')
      .map(l => l.trimEnd())
      .filter(l => l.trim().length > 0 && !l.includes('node_modules') && !l.includes('node:internal'))
      .slice(-15);
    if (fallbackLines.length > 0) {
      outputLines.push(`Diagnostic output:\n  ${fallbackLines.join('\n  ')}`);
    }
  }

  const compactOutput = outputLines.join('\n');
  const compactCharacters = compactOutput.length;
  const estimatedCompactTokens = estimateTokens(compactOutput);
  const tokensPreserved = Math.max(0, estimatedRawTokens - estimatedCompactTokens);
  const savingsPercent = estimatedRawTokens > 0 ? Math.round((tokensPreserved / estimatedRawTokens) * 100) : 0;

  return {
    kind,
    status,
    summary,
    failures,
    compactOutput,
    metrics: {
      rawCharacters,
      compactCharacters,
      estimatedRawTokens,
      estimatedCompactTokens,
      tokensPreserved,
      savingsPercent
    }
  };
}

