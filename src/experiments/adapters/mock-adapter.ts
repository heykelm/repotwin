import { AgentAdapter, AgentAdapterContext } from './adapter-interface.js';
import { AgentRun } from '../../types/contracts.js';
import fs from 'node:fs';
import path from 'node:path';

export interface MockAdapterOptions {
  baselineTokens?: number;
  candidateTokens?: number;
  baselineToolCalls?: number;
  candidateToolCalls?: number;
  baselineFilesRead?: string[];
  candidateFilesRead?: string[];
  shouldPass?: boolean;
  durationMs?: number;
  touchFiles?: string[];
}

export class MockAgentAdapter implements AgentAdapter {
  readonly name = 'mock-agent';
  readonly version = '1.0.0';

  constructor(private options: MockAdapterOptions = {}) {}

  async executeTask(context: AgentAdapterContext): Promise<AgentRun> {
    const isCandidate = context.variant === 'candidate';
    const tokensTotal = isCandidate
      ? (this.options.candidateTokens ?? 15000)
      : (this.options.baselineTokens ?? 35000);

    const toolCalls = isCandidate
      ? (this.options.candidateToolCalls ?? 8)
      : (this.options.baselineToolCalls ?? 22);

    const filesRead = isCandidate
      ? (this.options.candidateFilesRead ?? ['AGENTS.md', 'src/core.ts'])
      : (this.options.baselineFilesRead ?? ['README.md', 'docs/arch.md', 'legacy.ts', 'src/core.ts']);

    const passed = this.options.shouldPass !== false;

    // Simulate touching files in the worktree if requested
    if (this.options.touchFiles && this.options.touchFiles.length > 0) {
      for (const rel of this.options.touchFiles) {
        const full = path.join(context.worktreePath, rel);
        fs.mkdirSync(path.dirname(full), { recursive: true });
        fs.appendFileSync(full, '\n// modified by mock agent');
      }
    }

    return {
      schemaVersion: '1',
      runId: `mock-${context.variant}-t${context.trialIndex}-${Date.now()}`,
      taskId: context.task.id,
      repositoryFingerprint: context.fingerprint,
      commitSha: context.commitSha,
      variant: context.variant,
      agentName: this.name,
      modelId: 'mock-deterministic-v1',
      adapterVersion: this.version,
      startedAt: new Date().toISOString(),
      endedAt: new Date(Date.now() + (this.options.durationMs ?? 1200)).toISOString(),
      status: passed ? 'success' : 'failure',
      tokens: {
        total: tokensTotal,
        input: Math.round(tokensTotal * 0.75),
        output: Math.round(tokensTotal * 0.25),
        cachedInput: Math.round(tokensTotal * 0.4),
        source: 'adapter',
        semantics: 'Simulated deterministic counts; no provider request was made.'
      },
      durationMs: this.options.durationMs ?? 1200,
      toolCalls,
      filesRead,
      validation: {
        commands: context.task.validation.commands,
        passed,
        details: passed ? ['All mock validation checks passed'] : ['Mock test assertion failure']
      },
      traceCompleteness: 'complete',
      artifacts: {}
    };
  }
}
