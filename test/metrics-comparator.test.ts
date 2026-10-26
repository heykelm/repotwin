import { describe, it, expect } from 'vitest';
import { computeVariantStats, compareVariants } from '../src/metrics/comparator.js';
import { generateMarkdownReport } from '../src/reports/markdown-reporter.js';
import { AgentRun } from '../src/types/contracts.js';

describe('Metrics Comparator & Statistical Reporting (RFC-002)', () => {
  const createMockRun = (
    variant: 'baseline' | 'candidate',
    status: 'success' | 'failure',
    tokens: number,
    toolCalls: number
  ): AgentRun => ({
    schemaVersion: '1',
    runId: `run-${variant}-${Math.random()}`,
    taskId: 'task-test',
    repositoryFingerprint: 'fp-1',
    commitSha: 'sha-1',
    variant,
    agentName: 'claude-code',
    modelId: 'claude-3-7-sonnet',
    adapterVersion: '1.0.0',
    startedAt: new Date().toISOString(),
    status,
    tokens: { total: tokens, source: 'provider' },
    toolCalls,
    durationMs: 4000,
    filesRead: ['AGENTS.md'],
    validation: { commands: ['npm test'], passed: status === 'success' },
    traceCompleteness: 'complete',
    artifacts: {}
  });

  it('computes tokens per successful task correctly and excludes failures', () => {
    const runs: AgentRun[] = [
      createMockRun('baseline', 'success', 20000, 10),
      createMockRun('baseline', 'failure', 50000, 25), // failed run should not lower or dilute success token avg
      createMockRun('baseline', 'success', 30000, 15)
    ];

    const stats = computeVariantStats(runs);
    expect(stats.totalRuns).toBe(3);
    expect(stats.successes).toBe(2);
    expect(stats.failures).toBe(1);
    expect(stats.successRate).toBeCloseTo(2 / 3);
    // Success tokens: (20000 + 30000) / 2 = 25000
    expect(stats.tokensPerSuccessfulTask).toBe(25000);
    // Operational tokens per success: (20000 + 50000 + 30000) / 2 = 50000
    expect(stats.operationalTokensPerSuccess).toBe(50000);
  });

  it('decides improvement when token reduction is achieved without correctness loss', () => {
    const baselineRuns: AgentRun[] = [
      createMockRun('baseline', 'success', 40000, 20),
      createMockRun('baseline', 'success', 42000, 22)
    ];
    const candidateRuns: AgentRun[] = [
      createMockRun('candidate', 'success', 20000, 10),
      createMockRun('candidate', 'success', 22000, 11)
    ];

    const comparison = compareVariants('exp-test-1', baselineRuns, candidateRuns, {
      costPerTokenUsd: 0.000003,
      optimizationCostUsd: 2.0,
      benchmarkCostUsd: 1.0
    });

    expect(comparison.verdict).toBe('improvement');
    expect(comparison.delta.relativeTokenReduction).toBeGreaterThan(0.40);
    expect(comparison.breakEven?.breakEvenTasks).toBeDefined();

    const markdown = generateMarkdownReport(comparison, [...baselineRuns, ...candidateRuns]);
    expect(markdown).toContain('IMPROVEMENT');
    expect(markdown).toContain('Tokens / Successful Task');
  });

  it('decides regression when success rate drops materially', () => {
    const baselineRuns: AgentRun[] = [
      createMockRun('baseline', 'success', 30000, 15),
      createMockRun('baseline', 'success', 30000, 15)
    ];
    const candidateRuns: AgentRun[] = [
      createMockRun('candidate', 'failure', 10000, 5),
      createMockRun('candidate', 'failure', 10000, 5)
    ];

    const comparison = compareVariants('exp-test-2', baselineRuns, candidateRuns);
    expect(comparison.verdict).toBe('regression');
  });

  it('labels mock results as simulation in markdown regardless of the calculated verdict', () => {
    const initial = { ...createMockRun('baseline', 'success', 30000, 15), agentName: 'mock-agent' };
    const candidate = { ...createMockRun('candidate', 'success', 14000, 8), agentName: 'mock-agent' };
    const result = compareVariants('simulated', [initial, initial], [candidate, candidate]);
    const markdown = generateMarkdownReport(result, [initial, initial, candidate, candidate]);
    expect(markdown).toMatch(/^> \*\*SIMULATION/);
    expect(markdown).toContain('do not measure a real RepoTwin gain');
  });
});
