import { AgentRun } from '../types/contracts.js';

export type DecisionVerdict = 'improvement' | 'regression' | 'neutral' | 'inconclusive';

export interface VariantStats {
  totalRuns: number;
  successes: number;
  failures: number;
  successRate: number; // 0.0 to 1.0
  tokensPerSuccessfulTask?: number;
  operationalTokensPerSuccess?: number;
  medianTokens?: number;
  meanDurationMs?: number;
  meanToolCalls?: number;
}

export interface ComparisonReport {
  schemaVersion: string;
  experimentId: string;
  baseline: VariantStats;
  candidate: VariantStats;
  delta: {
    relativeTokenReduction?: number; // e.g. 0.35 = 35% reduction
    successRateDiff: number; // e.g. 0.0 = identical, -0.2 = regression
    toolCallReduction?: number;
    durationReduction?: number;
  };
  verdict: DecisionVerdict;
  explanation: string;
  breakEven?: {
    breakEvenTasks?: number;
    explanation: string;
  };
}

function computeMedian(values: number[]): number | undefined {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function computeVariantStats(runs: AgentRun[]): VariantStats {
  const totalRuns = runs.length;
  if (totalRuns === 0) {
    return {
      totalRuns: 0,
      successes: 0,
      failures: 0,
      successRate: 0
    };
  }

  const successRuns = runs.filter(r => r.status === 'success');
  const successes = successRuns.length;
  const failures = totalRuns - successes;
  const successRate = successes / totalRuns;

  // Tokens of successful tasks
  const successTokens = successRuns
    .map(r => r.tokens.total)
    .filter((t): t is number => typeof t === 'number' && !Number.isNaN(t));

  const allTokens = runs
    .map(r => r.tokens.total)
    .filter((t): t is number => typeof t === 'number' && !Number.isNaN(t));

  const totalTokensSpent = allTokens.reduce((acc, v) => acc + v, 0);

  const tokensPerSuccessfulTask = successTokens.length > 0
    ? successTokens.reduce((acc, v) => acc + v, 0) / successTokens.length
    : undefined;

  const operationalTokensPerSuccess = (successes > 0 && allTokens.length === totalRuns)
    ? totalTokensSpent / successes
    : undefined;

  const medianTokens = computeMedian(allTokens);

  const durations = runs
    .map(r => r.durationMs)
    .filter((d): d is number => typeof d === 'number');
  const meanDurationMs = durations.length > 0
    ? durations.reduce((acc, d) => acc + d, 0) / durations.length
    : undefined;

  const toolCalls = runs
    .map(r => r.toolCalls)
    .filter((c): c is number => typeof c === 'number');
  const meanToolCalls = toolCalls.length > 0
    ? toolCalls.reduce((acc, c) => acc + c, 0) / toolCalls.length
    : undefined;

  return {
    totalRuns,
    successes,
    failures,
    successRate,
    tokensPerSuccessfulTask,
    operationalTokensPerSuccess,
    medianTokens,
    meanDurationMs,
    meanToolCalls
  };
}

export function compareVariants(
  experimentId: string,
  baselineRuns: AgentRun[],
  candidateRuns: AgentRun[],
  options: {
    optimizationCostUsd?: number;
    benchmarkCostUsd?: number;
    costPerTokenUsd?: number;
  } = {}
): ComparisonReport {
  const baseline = computeVariantStats(baselineRuns);
  const candidate = computeVariantStats(candidateRuns);

  const successRateDiff = candidate.successRate - baseline.successRate;

  let relativeTokenReduction: number | undefined;
  if (
    baseline.tokensPerSuccessfulTask !== undefined &&
    candidate.tokensPerSuccessfulTask !== undefined &&
    baseline.tokensPerSuccessfulTask > 0
  ) {
    relativeTokenReduction = (baseline.tokensPerSuccessfulTask - candidate.tokensPerSuccessfulTask) / baseline.tokensPerSuccessfulTask;
  }

  let toolCallReduction: number | undefined;
  if (baseline.meanToolCalls && candidate.meanToolCalls && baseline.meanToolCalls > 0) {
    toolCallReduction = (baseline.meanToolCalls - candidate.meanToolCalls) / baseline.meanToolCalls;
  }

  let durationReduction: number | undefined;
  if (baseline.meanDurationMs && candidate.meanDurationMs && baseline.meanDurationMs > 0) {
    durationReduction = (baseline.meanDurationMs - candidate.meanDurationMs) / baseline.meanDurationMs;
  }

  // Verdict decision logic (conservative RFC-002 rules)
  let verdict: DecisionVerdict = 'inconclusive';
  let explanation = '';

  if (baseline.totalRuns < 2 || candidate.totalRuns < 2) {
    verdict = 'inconclusive';
    explanation = 'Insufficient sample size: at least 2 trials per variant are required for exploratory comparison.';
  } else if (successRateDiff < -0.15) {
    verdict = 'regression';
    explanation = `Candidate task success rate degraded by ${Math.round(Math.abs(successRateDiff) * 100)}% compared to baseline.`;
  } else if (relativeTokenReduction !== undefined && relativeTokenReduction < -0.10) {
    verdict = 'regression';
    explanation = `Candidate consumed ${Math.round(Math.abs(relativeTokenReduction) * 100)}% more tokens per successful task.`;
  } else if (
    successRateDiff >= -0.05 &&
    relativeTokenReduction !== undefined &&
    relativeTokenReduction >= 0.08
  ) {
    verdict = 'improvement';
    explanation = `Candidate achieved a ${Math.round(relativeTokenReduction * 100)}% reduction in provider tokens per successful task without degrading task success rate.`;
  } else if (
    successRateDiff >= -0.05 &&
    ((toolCallReduction !== undefined && toolCallReduction > 0.15) ||
     (durationReduction !== undefined && durationReduction > 0.20))
  ) {
    verdict = 'improvement';
    explanation = 'Candidate demonstrated significant reduction in tool calls or latency without correctness loss.';
  } else {
    verdict = 'neutral';
    explanation = 'Observed variance was within confidence tolerance; candidate showed no material difference from baseline.';
  }

  // Break-even calculation if financial context is provided
  let breakEven: ComparisonReport['breakEven'];
  if (
    options.costPerTokenUsd &&
    relativeTokenReduction &&
    relativeTokenReduction > 0 &&
    baseline.tokensPerSuccessfulTask &&
    candidate.tokensPerSuccessfulTask
  ) {
    const tokensSavedPerTask = baseline.tokensPerSuccessfulTask - candidate.tokensPerSuccessfulTask;
    const savingsPerTaskUsd = tokensSavedPerTask * options.costPerTokenUsd;
    const upfrontCost = (options.optimizationCostUsd || 0) + (options.benchmarkCostUsd || 0);

    if (savingsPerTaskUsd > 0 && upfrontCost > 0) {
      const breakEvenTasks = Math.ceil(upfrontCost / savingsPerTaskUsd);
      breakEven = {
        breakEvenTasks,
        explanation: `At $${options.costPerTokenUsd.toFixed(6)}/token, saving ~${Math.round(tokensSavedPerTask)} tokens/task recovers the $${upfrontCost.toFixed(2)} upfront cost in ${breakEvenTasks} completed tasks.`
      };
    }
  }

  return {
    schemaVersion: '1',
    experimentId,
    baseline,
    candidate,
    delta: {
      relativeTokenReduction,
      successRateDiff,
      toolCallReduction,
      durationReduction
    },
    verdict,
    explanation,
    breakEven
  };
}
