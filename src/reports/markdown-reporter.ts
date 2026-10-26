import { ComparisonReport } from '../metrics/comparator.js';
import { AgentRun } from '../types/contracts.js';

function renderAsciiBar(value: number, max: number, width = 24): string {
  if (max <= 0) return '░'.repeat(width);
  const filled = Math.min(width, Math.max(0, Math.round((value / max) * width)));
  return '█'.repeat(filled) + '░'.repeat(width - filled);
}

export function generateMarkdownReport(
  report: ComparisonReport,
  runs: AgentRun[] = []
): string {
  const simulated = runs.some(run => /mock|simulat/i.test(
    [run.agentName, run.modelId, run.runId, run.tokens.semantics].join(' ')
  ));
  const provenanceNotice = simulated
    ? '> **SIMULATION — predefined mock data. These results do not measure a real RepoTwin gain.**\n\n'
    : runs.length === 0
      ? '> **UNVERIFIED — aggregate results were supplied without source runs.**\n\n'
      : '';
  const sampleRun = runs[0];
  const agentInfo = sampleRun ? `${sampleRun.agentName} (${sampleRun.modelId})` : 'Declared agent';
  const repoFingerprint = sampleRun?.repositoryFingerprint || 'unknown';
  const commitSha = sampleRun?.commitSha || 'unknown';

  const formatPct = (val?: number) => (val !== undefined ? `${(val * 100).toFixed(1)}%` : 'N/A');
  const formatNum = (val?: number) => (val !== undefined ? Math.round(val).toLocaleString() : 'N/A');

  const verdictBadge =
    report.verdict === 'improvement'
      ? '🟢 **IMPROVEMENT**'
      : report.verdict === 'regression'
      ? '🔴 **REGRESSION**'
      : report.verdict === 'neutral'
      ? '⚪ **NEUTRAL**'
      : '🟡 **INCONCLUSIVE**';

  // 1. Token Bar Chart
  const bTokens = report.baseline.tokensPerSuccessfulTask ?? 0;
  const cTokens = report.candidate.tokensPerSuccessfulTask ?? 0;
  const maxTokens = Math.max(bTokens, cTokens, 1);
  const tokenChart = `
\`\`\`text
Baseline  [${renderAsciiBar(bTokens, maxTokens)}] ${formatNum(bTokens)} tokens
Candidate [${renderAsciiBar(cTokens, maxTokens)}] ${formatNum(cTokens)} tokens (${formatPct(report.delta.relativeTokenReduction)} ${report.delta.relativeTokenReduction && report.delta.relativeTokenReduction > 0 ? 'saved' : ''})
\`\`\``;

  // 2. Execution Time Bar Chart
  const bDur = (report.baseline.meanDurationMs ?? 0) / 1000;
  const cDur = (report.candidate.meanDurationMs ?? 0) / 1000;
  const maxDur = Math.max(bDur, cDur, 0.01);
  const durChart = `
\`\`\`text
Baseline  [${renderAsciiBar(bDur, maxDur)}] ${bDur.toFixed(2)}s
Candidate [${renderAsciiBar(cDur, maxDur)}] ${cDur.toFixed(2)}s (${formatPct(report.delta.durationReduction)})
\`\`\``;

  // 3. Success Rate
  const bRate = report.baseline.successRate;
  const cRate = report.candidate.successRate;
  const successChart = `
\`\`\`text
Baseline  [${renderAsciiBar(bRate, 1)}] ${Math.round(bRate * 100)}% (${report.baseline.successes}/${report.baseline.totalRuns})
Candidate [${renderAsciiBar(cRate, 1)}] ${Math.round(cRate * 100)}% (${report.candidate.successes}/${report.candidate.totalRuns})
\`\`\``;

  // 4. Navigation & Tool Calls
  const bTools = report.baseline.meanToolCalls ?? 0;
  const cTools = report.candidate.meanToolCalls ?? 0;
  const maxTools = Math.max(bTools, cTools, 1);
  const navChart = `
\`\`\`text
Baseline  [${renderAsciiBar(bTools, maxTools)}] ${bTools.toFixed(1)} tool calls
Candidate [${renderAsciiBar(cTools, maxTools)}] ${cTools.toFixed(1)} tool calls (${formatPct(report.delta.toolCallReduction)})
\`\`\``;

  // 5. Variability across trials
  const bTrials = runs.filter(r => r.variant === 'baseline' && r.tokens.total).map(r => r.tokens.total!);
  const cTrials = runs.filter(r => r.variant === 'candidate' && r.tokens.total).map(r => r.tokens.total!);
  const variabilitySection = bTrials.length > 0 && cTrials.length > 0
    ? `
**Baseline Trials:** ${bTrials.map(t => t.toLocaleString()).join(', ')} tokens (median: ${formatNum(report.baseline.medianTokens)})  
**Candidate Trials:** ${cTrials.map(t => t.toLocaleString()).join(', ')} tokens (median: ${formatNum(report.candidate.medianTokens)})`
    : '*Données de variabilité non disponibles.*';

  return `${provenanceNotice}# RepoTwin Experiment Report: ${report.experimentId}

**Verdict:** ${verdictBadge}  
**Primary Metric:** Tokens per successfully completed task  
**Date:** ${new Date().toISOString().split('T')[0]}  
**Product Motto:** *Measure. Optimize. Prove.*

---

## 1. Executive Summary & Verdict

${report.explanation}

${report.breakEven ? `> **Break-Even Analysis:** ${report.breakEven.explanation}` : ''}

---

## 2. Experimental Controls & Setup

- **Repository Fingerprint:** \`${repoFingerprint}\`
- **Base Commit SHA:** \`${commitSha}\`
- **Agent Under Test:** \`${agentInfo}\`
- **Isolation Strategy:** Dual Git Worktrees (\`baseline\` vs \`candidate\`)
- **Total Executions Analyzed:** ${runs.length} (${report.baseline.totalRuns} baseline, ${report.candidate.totalRuns} candidate)

---

## 3. Results Comparison Matrix

| Metric | Baseline | Candidate | Delta / Impact |
| :--- | :--- | :--- | :--- |
| **Success Rate** | ${formatPct(report.baseline.successRate)} (${report.baseline.successes}/${report.baseline.totalRuns}) | ${formatPct(report.candidate.successRate)} (${report.candidate.successes}/${report.candidate.totalRuns}) | **${formatPct(report.delta.successRateDiff)}** |
| **Tokens / Successful Task** | ${formatNum(report.baseline.tokensPerSuccessfulTask)} | ${formatNum(report.candidate.tokensPerSuccessfulTask)} | **${formatPct(report.delta.relativeTokenReduction)}** ${report.delta.relativeTokenReduction && report.delta.relativeTokenReduction > 0 ? 'saved' : ''} |
| **Operational Tokens / Success** | ${formatNum(report.baseline.operationalTokensPerSuccess)} | ${formatNum(report.candidate.operationalTokensPerSuccess)} | Includes failed retries |
| **Median Tokens** | ${formatNum(report.baseline.medianTokens)} | ${formatNum(report.candidate.medianTokens)} | Robust to outliers |
| **Mean Tool Calls** | ${formatNum(report.baseline.meanToolCalls)} | ${formatNum(report.candidate.meanToolCalls)} | **${formatPct(report.delta.toolCallReduction)}** |
| **Mean Duration (ms)** | ${formatNum(report.baseline.meanDurationMs)} ms | ${formatNum(report.candidate.meanDurationMs)} ms | **${formatPct(report.delta.durationReduction)}** |

---

## 4. Visual Efficiency Charts (RFC-002)

### 1. Token Consumption (Before / After)
${tokenChart}

### 2. Agent Execution Time
${durChart}

### 3. Task Success Rate & Regression Guard
${successChart}

### 4. Context & Navigation Efficiency
${navChart}

### 5. Benchmark Variability Across Trials
${variabilitySection}

---

## 5. Methodology & Variance Caveats

- **Stochastic Non-Determinism:** LLM coding agents exhibit temperature-driven variability. Reported metrics reflect observed runs.
- **Prompt Caching:** Token accounting separates raw input, cached input, and output where provider telemetry supports it.
- **Validation Contract:** Tasks are labeled successful only if declared verification commands exit cleanly (code 0).

---

## 6. Reproduction Protocol

To reproduce this experiment or review the patch artifacts:
\`\`\`bash
# Inspect the experiment runs and comparison
repotwin compare --experiment ${report.experimentId} --format markdown

# Clean up temporary worktrees when done
repotwin clean --experiment ${report.experimentId}
\`\`\`

*Report generated by RepoTwin RFC-002 Evidence-Based Agent Efficiency Engine.*
`;
}
