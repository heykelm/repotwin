import fs from 'node:fs';
import path from 'node:path';
import { SubprojectInfo } from '../types/index.js';
import { estimateTokens } from '../verification/compact-sieve.js';

export interface InstructionTokenEntry {
  path: string;
  sizeBytes: number;
  characters: number;
  estimatedTokens: number;
  status: 'optimal' | 'moderate' | 'excessive';
}

export interface ContextHogEntry {
  path: string;
  lines: number;
  characters: number;
  estimatedTokens: number;
  risk: 'medium' | 'high';
}

export interface VerbosityAuditEntry {
  subproject: string;
  command: string;
  isVerbose: boolean;
  recommendation?: string;
}

export interface TokenEfficiencyAudit {
  score: number;
  grade: 'A' | 'B' | 'C' | 'D' | 'F';
  totalInstructionTokens: number;
  instructionsStatus: 'optimal' | 'moderate' | 'excessive';
  instructionFiles: InstructionTokenEntry[];
  contextHogs: ContextHogEntry[];
  commandVerbosity: VerbosityAuditEntry[];
  estimatedSieveSavingsPercent: number;
  recommendations: string[];
}

const IGNORED_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  'coverage',
  '.next',
  '.nuxt',
  'target',
  'vendor',
  '.turbo',
  'fixtures'
]);

const CODE_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.py', '.rs', '.go', '.dart', '.java', '.c', '.cpp', '.rb', '.php', '.swift'
]);

function scanLargeSourceFiles(dir: string, baseDir: string, maxFiles: number = 5): ContextHogEntry[] {
  const hogs: ContextHogEntry[] = [];

  function walk(currentDir: string) {
    if (hogs.length >= 30) return; // avoid runaway
    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(currentDir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (!IGNORED_DIRS.has(entry.name) && !entry.name.startsWith('.')) {
          walk(path.join(currentDir, entry.name));
        }
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (CODE_EXTENSIONS.has(ext)) {
          try {
            const fullPath = path.join(currentDir, entry.name);
            const content = fs.readFileSync(fullPath, 'utf8');
            const lines = content.split('\n').length;
            if (lines > 500) {
              const relPath = path.relative(baseDir, fullPath);
              const characters = content.length;
              hogs.push({
                path: relPath,
                lines,
                characters,
                estimatedTokens: estimateTokens(content),
                risk: lines > 1000 ? 'high' : 'medium'
              });
            }
          } catch {
            // ignore read error
          }
        }
      }
    }
  }

  walk(dir);
  return hogs.sort((a, b) => b.lines - a.lines).slice(0, maxFiles);
}

/**
 * Audits repository token footprint and context budget efficiency.
 */
export function auditTokenEfficiency(
  repoPath: string,
  subprojects: SubprojectInfo[] = []
): TokenEfficiencyAudit {
  const resolved = path.resolve(repoPath);

  // 1. Audit instruction files
  const candidateInstructionFiles = [
    'AGENTS.md',
    'CLAUDE.md',
    'GEMINI.md',
    '.cursorrules',
    'README.md'
  ];

  const instructionEntries: InstructionTokenEntry[] = [];
  let totalInstructionTokens = 0;

  for (const rel of candidateInstructionFiles) {
    const full = path.join(resolved, rel);
    if (fs.existsSync(full) && fs.statSync(full).isFile()) {
      try {
        const content = fs.readFileSync(full, 'utf8');
        const tokens = estimateTokens(content);
        const status: 'optimal' | 'moderate' | 'excessive' =
          tokens <= 800 ? 'optimal' : tokens <= 1800 ? 'moderate' : 'excessive';

        instructionEntries.push({
          path: rel,
          sizeBytes: Buffer.byteLength(content, 'utf8'),
          characters: content.length,
          estimatedTokens: tokens,
          status
        });
        totalInstructionTokens += tokens;
      } catch {
        // ignore
      }
    }
  }

  // 2. Scan for Context Hogs (files > 500 lines)
  const contextHogs = scanLargeSourceFiles(resolved, resolved, 5);

  // 3. Audit command verbosity in subprojects
  const commandVerbosity: VerbosityAuditEntry[] = [];
  for (const sub of subprojects) {
    const cmd = sub.testScript;
    if (cmd) {
      const isVerbose = !cmd.includes('--silent') && !cmd.includes('-q') && !cmd.includes('--reporter=compact') && !cmd.includes('--no-progress');
      let recommendation: string | undefined;
      if (isVerbose) {
        if (cmd.includes('vitest') || cmd.includes('jest')) {
          recommendation = 'Add --silent or run via RepoTwin Compact Sieve to prevent full console dumps.';
        } else if (cmd.includes('pytest')) {
          recommendation = 'Add -q (quiet mode) to avoid printing passing tests.';
        } else {
          recommendation = 'Use RepoTwin Compact Sieve to filter noise and preserve context.';
        }
      }
      commandVerbosity.push({
        subproject: sub.name,
        command: cmd,
        isVerbose,
        recommendation
      });
    }
  }

  // 4. Calculate Score (0-100)
  let score = 100;
  const recommendations: string[] = [];

  // Penalty for excessive instruction tokens (base prompt overhead)
  if (totalInstructionTokens > 3000) {
    score -= 35;
    recommendations.push(`Instruction files total ${totalInstructionTokens} tokens (> 3,000 threshold). Prune obsolete rules to lighten agent base prompts.`);
  } else if (totalInstructionTokens > 1500) {
    score -= 15;
    recommendations.push(`Instruction files total ${totalInstructionTokens} tokens. Consider modularizing instructions under .cursor/rules/ or archiving legacy guides.`);
  }

  // Penalty for Context Hogs
  if (contextHogs.length > 0) {
    const highRisk = contextHogs.filter(h => h.risk === 'high');
    const penalty = Math.min(25, contextHogs.length * 5 + highRisk.length * 5);
    score -= penalty;
    recommendations.push(`${contextHogs.length} large source file(s) (>500 lines) detected. Split monolithic files to prevent AI agents from re-reading thousands of lines repeatedly.`);
  }

  // Penalty for verbose test commands
  const verboseCommands = commandVerbosity.filter(c => c.isVerbose);
  if (verboseCommands.length > 0) {
    score -= Math.min(15, verboseCommands.length * 5);
    recommendations.push(`${verboseCommands.length} test command(s) lack quiet or compact flags. AI agents will swallow hundreds of terminal lines on each test run.`);
  }

  score = Math.max(20, Math.min(100, score));

  const grade: 'A' | 'B' | 'C' | 'D' | 'F' =
    score >= 90 ? 'A' :
    score >= 80 ? 'B' :
    score >= 65 ? 'C' :
    score >= 50 ? 'D' : 'F';

  const instructionsStatus: 'optimal' | 'moderate' | 'excessive' =
    totalInstructionTokens <= 1000 ? 'optimal' :
    totalInstructionTokens <= 2500 ? 'moderate' : 'excessive';

  recommendations.push('Run verification through RepoTwin Twin Sieve (repotwin_run_checks) to save ~70-85% of tokens on test/debug iterations.');

  return {
    score,
    grade,
    totalInstructionTokens,
    instructionsStatus,
    instructionFiles: instructionEntries,
    contextHogs,
    commandVerbosity,
    estimatedSieveSavingsPercent: 74,
    recommendations
  };
}

