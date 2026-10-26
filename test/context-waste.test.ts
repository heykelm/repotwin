import { describe, it, expect } from 'vitest';
import { inspectRepository } from '../src/analysis/inspector.js';
import { analyzeContextWaste } from '../src/analysis/context-waste.js';
import { AgentRun } from '../src/types/contracts.js';
import path from 'node:path';

describe('Context Waste Analyzer (RFC-002)', () => {
  it('operates in static mode when no traces are supplied and flags findings as heuristic', () => {
    const repoPath = path.resolve('.');
    const snapshot = inspectRepository(repoPath);
    expect(snapshot.schemaVersion).toBe('1');
    expect(snapshot.commitSha).toBeDefined();

    const report = analyzeContextWaste(snapshot, []);
    expect(report.mode).toBe('static');
    for (const f of report.findings) {
      expect(f.evidenceKind).toBe('heuristic');
    }
  });

  it('operates in observed mode when traces are supplied and attaches run IDs', () => {
    const repoPath = path.resolve('.');
    const snapshot = inspectRepository(repoPath);

    const mockRuns: AgentRun[] = [
      {
        schemaVersion: '1',
        runId: 'run-alpha',
        taskId: 'task-1',
        repositoryFingerprint: 'fp-1',
        commitSha: 'sha-1',
        variant: 'baseline',
        agentName: 'mock-agent',
        modelId: 'mock-model',
        adapterVersion: '1.0.0',
        startedAt: new Date().toISOString(),
        status: 'success',
        tokens: { total: 10000, source: 'provider' },
        toolCalls: 55,
        filesRead: ['src/index.ts', 'src/index.ts', 'src/index.ts', 'src/index.ts', 'src/index.ts'],
        validation: { commands: ['npm test'], passed: true },
        traceCompleteness: 'complete',
        artifacts: {}
      }
    ];

    const report = analyzeContextWaste(snapshot, mockRuns);
    expect(report.mode).toBe('observed');
    expect(report.observedMetrics?.totalRunsAnalyzed).toBe(1);

    const observedFinding = report.findings.find(f => f.evidenceKind === 'observed');
    expect(observedFinding).toBeDefined();
    expect(observedFinding?.supportingRunIds).toContain('run-alpha');
  });
});
