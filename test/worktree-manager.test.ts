import { afterEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { cleanTwins, createCandidateTwin } from '../src/twin/worktree-manager.js';

const directories: string[] = [];

function git(repo: string, args: string[]): string {
  return execFileSync('git', ['-C', repo, ...args], { encoding: 'utf-8' });
}

function temporaryRepository(): string {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'repotwin-worktree-'));
  directories.push(repo);
  git(repo, ['init']);
  git(repo, ['config', 'user.email', 'test@example.com']);
  git(repo, ['config', 'user.name', 'RepoTwin test']);
  fs.writeFileSync(path.join(repo, 'README.md'), '# fixture\n');
  git(repo, ['add', 'README.md']);
  git(repo, ['commit', '-m', 'initial']);
  return repo;
}

afterEach(() => {
  delete process.env.REPOTWIN_TWINS_DIR;
  for (const directory of directories.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

describe('worktree manager', () => {
  it('cleans only its own unchanged candidate and preserves a user-modified twin', () => {
    const repo = temporaryRepository();
    const cache = fs.mkdtempSync(path.join(os.tmpdir(), 'repotwin-cache-'));
    directories.push(cache);
    process.env.REPOTWIN_TWINS_DIR = cache;
    const recipe = {
      agentsMdContent: '# generated\n',
      agentReadyJsonContent: '{"version":1}\n',
      summaryChanges: []
    };

    const first = createCandidateTwin(repo, recipe);
    expect(cleanTwins(repo)).toEqual({ cleaned: 1, skippedDirty: 0 });
    expect(fs.existsSync(first.twinPath)).toBe(false);

    const second = createCandidateTwin(repo, recipe);
    fs.writeFileSync(path.join(second.twinPath, 'user-note.txt'), 'keep me');
    expect(cleanTwins(repo)).toEqual({ cleaned: 0, skippedDirty: 1 });
    expect(fs.existsSync(second.twinPath)).toBe(true);
  });
});
