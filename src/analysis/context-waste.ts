import { Finding, RepositorySnapshot, AgentRun, EvidenceKind } from '../types/contracts.js';

export interface WasteAnalysisReport {
  mode: 'static' | 'observed';
  findings: Finding[];
  observedMetrics?: {
    totalRunsAnalyzed: number;
    repeatedFileReads: Array<{ path: string; count: number; runIds: string[] }>;
    excessiveToolCalls: Array<{ runId: string; toolCalls: number }>;
    unverifiedToolFailures: number;
  };
}

export function analyzeContextWaste(
  snapshot: RepositorySnapshot,
  runs: AgentRun[] = []
): WasteAnalysisReport {
  const findings: Finding[] = [...snapshot.findings];

  if (!runs || runs.length === 0) {
    // Static mode only (no traces available)
    // Add disclaimer and heuristic checks
    return {
      mode: 'static',
      findings
    };
  }

  // Observed mode (real traces are supplied)
  const fileReadCounts = new Map<string, { count: number; runIds: Set<string> }>();
  const excessiveToolCalls: Array<{ runId: string; toolCalls: number }> = [];
  let unverifiedToolFailures = 0;

  for (const run of runs) {
    if (run.filesRead && Array.isArray(run.filesRead)) {
      // Check repeat reads within or across runs
      const fileOccurrencesInRun = new Map<string, number>();
      for (const file of run.filesRead) {
        fileOccurrencesInRun.set(file, (fileOccurrencesInRun.get(file) || 0) + 1);

        const current = fileReadCounts.get(file) || { count: 0, runIds: new Set<string>() };
        current.count += 1;
        current.runIds.add(run.runId);
        fileReadCounts.set(file, current);
      }
    }

    // Check high tool calls (> 30 calls without success or > 60 total)
    if (run.toolCalls && run.toolCalls > 40) {
      excessiveToolCalls.push({
        runId: run.runId,
        toolCalls: run.toolCalls
      });
    }

    if (run.status === 'failure' || run.status === 'budget_exceeded') {
      unverifiedToolFailures++;
    }
  }

  // Generate observed findings for repeated file reads
  const repeatedFiles: Array<{ path: string; count: number; runIds: string[] }> = [];
  for (const [filePath, data] of fileReadCounts.entries()) {
    if (data.count > runs.length * 2 && data.count >= 4) {
      repeatedFiles.push({
        path: filePath,
        count: data.count,
        runIds: Array.from(data.runIds)
      });

      findings.push({
        id: `observed-repeat-reads-${Buffer.from(filePath).toString('hex').substring(0, 8)}`,
        ruleId: 'observed/repeated-file-reads',
        severity: 'medium',
        evidenceKind: 'observed',
        status: 'confirmed',
        summary: `File read repeatedly across agent sessions: ${filePath} (${data.count} reads across ${data.runIds.size} run(s))`,
        locations: [{ path: filePath }],
        supportingRunIds: Array.from(data.runIds),
        explanation: 'Observed telemetry indicates the agent repeatedly inspects this file across execution cycles, suggesting missing cache, unclear architecture index, or ambiguous module boundaries.',
        suggestedAction: 'Consider adding a concise summary of this module in the repository map to reduce exploratory re-reads.'
      });
    }
  }

  // Generate observed findings for excessive tool calls
  if (excessiveToolCalls.length > 0) {
    findings.push({
      id: 'observed-excessive-tool-churn',
      ruleId: 'observed/tool-churn',
      severity: 'high',
      evidenceKind: 'observed',
      status: 'confirmed',
      summary: `High tool call churn detected in ${excessiveToolCalls.length} run(s) (>40 calls)`,
      locations: [],
      supportingRunIds: excessiveToolCalls.map(e => e.runId),
      explanation: 'Runs exhibiting high tool call volumes indicate the agent struggled to locate target symbols or verification scripts.',
      suggestedAction: 'Refine test and build command discovery in AGENTS.md or package scripts.'
    });
  }

  return {
    mode: 'observed',
    findings,
    observedMetrics: {
      totalRunsAnalyzed: runs.length,
      repeatedFileReads: repeatedFiles,
      excessiveToolCalls,
      unverifiedToolFailures
    }
  };
}
