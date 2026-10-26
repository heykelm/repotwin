import { afterEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runExperimentSuite } from '../src/experiments/runner.js';
import { MockAgentAdapter } from '../src/experiments/adapters/mock-adapter.js';
import { ExperimentSuite } from '../src/types/contracts.js';

const directories: string[] = [];

function git(repo: string, args: string[]): string {
  return execFileSync('git', ['-C', repo, ...args], { encoding: 'utf-8' });
}

function temporaryRepository(): string {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'repotwin-exp-run-'));
  directories.push(repo);
  git(repo, ['init', '-b', 'main']);
  git(repo, ['config', 'user.email', 'test@example.com']);
  git(repo, ['config', 'user.name', 'RepoTwin test']);
  fs.writeFileSync(path.join(repo, 'README.md'), '# fixture\n');
  git(repo, ['add', 'README.md']);
  git(repo, ['commit', '-m', 'initial']);
  return repo;
}

afterEach(() => {
  delete process.env.REPOTWIN_TWINS_DIR;
  for (const directory of directories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe('Experiment Runner (Component D)', () => {
  it('runs counterbalanced trials on isolated twins and records telemetry', async () => {
    const repo = temporaryRepository();
    const cache = fs.mkdtempSync(path.join(os.tmpdir(), 'repotwin-cache-'));
    directories.push(cache);
    process.env.REPOTWIN_TWINS_DIR = cache;

    const suite: ExperimentSuite = {
      schemaVersion: '1',
      suiteId: 'unit-test-suite',
      tasks: [
        {
          schemaVersion: '1',
          id: 'task-smoke',
          description: 'Smoke test task',
          validation: { commands: ['npm test'], required: true }
        }
      ]
    };

    const mockAdapter = new MockAgentAdapter({
      baselineTokens: 30000,
      candidateTokens: 12000,
      shouldPass: true
    });

    const result = await runExperimentSuite(repo, suite, mockAdapter, {
      trialsPerTask: 2,
      candidatePatch: {
        files: {
          'AGENTS.md': '# Optimized Rules'
        }
      }
    });

    expect(result.runs.length).toBe(4); // 1 task * 2 trials * 2 variants (baseline + candidate)
    const baselineRuns = result.runs.filter(r => r.variant === 'baseline');
    const candidateRuns = result.runs.filter(r => r.variant === 'candidate');

    expect(baselineRuns.length).toBe(2);
    expect(candidateRuns.length).toBe(2);

    expect(baselineRuns[0].tokens.total).toBe(30000);
    expect(baselineRuns[0].tokens.source).toBe('adapter');
    expect(baselineRuns[0].tokens.semantics).toContain('Simulated');
    expect(candidateRuns[0].tokens.total).toBe(12000);
    expect(candidateRuns[0].status).toBe('success');
  });
});
