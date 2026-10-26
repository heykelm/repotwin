import { afterEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createExperimentTwinPair } from '../src/twin/experiment-twins.js';

const directories: string[] = [];

function git(repo: string, args: string[]): string {
  return execFileSync('git', ['-C', repo, ...args], { encoding: 'utf-8' });
}

function temporaryRepository(): string {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'repotwin-exp-fixture-'));
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

describe('Experiment Twin Pair (Component C)', () => {
  it('creates isolated baseline and candidate worktrees without modifying the main repository', () => {
    const repo = temporaryRepository();
    const cache = fs.mkdtempSync(path.join(os.tmpdir(), 'repotwin-exp-cache-'));
    directories.push(cache);
    process.env.REPOTWIN_TWINS_DIR = cache;

    const pair = createExperimentTwinPair(repo, 'HEAD', {
      files: {
        'AGENTS.md': '# Candidate Instructions\n'
      }
    });

    try {
      expect(fs.existsSync(pair.baselinePath)).toBe(true);
      expect(fs.existsSync(pair.candidatePath)).toBe(true);
      // Main repository must not have AGENTS.md
      expect(fs.existsSync(path.join(repo, 'AGENTS.md'))).toBe(false);
      // Baseline must not have AGENTS.md
      expect(fs.existsSync(path.join(pair.baselinePath, 'AGENTS.md'))).toBe(false);
      // Candidate must have AGENTS.md
      expect(fs.existsSync(path.join(pair.candidatePath, 'AGENTS.md'))).toBe(true);
      expect(fs.readFileSync(path.join(pair.candidatePath, 'AGENTS.md'), 'utf-8')).toBe('# Candidate Instructions\n');
    } finally {
      pair.clean();
      expect(fs.existsSync(pair.baselinePath)).toBe(false);
      expect(fs.existsSync(pair.candidatePath)).toBe(false);
    }
  });

  it('rejects unapproved source file changes when allowSourceEdits is false', () => {
    const repo = temporaryRepository();
    const cache = fs.mkdtempSync(path.join(os.tmpdir(), 'repotwin-exp-cache-'));
    directories.push(cache);
    process.env.REPOTWIN_TWINS_DIR = cache;

    expect(() => {
      createExperimentTwinPair(repo, 'HEAD', {
        files: {
          'src/app.ts': 'console.log("malicious edit");'
        }
      });
    }).toThrow(/allowlist/);
  });
});
