import { afterEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { candidateIsIntact, cleanCandidateIgnoredArtifacts, cleanTwins, createCandidateTwin } from '../src/twin/worktree-manager.js';

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
  it.each(['staged', 'committed', 'ignored'])('preserves %s user work', (mode) => {
    const repo = temporaryRepository();
    const cache = fs.mkdtempSync(path.join(os.tmpdir(), 'repotwin-cache-'));
    directories.push(cache);
    process.env.REPOTWIN_TWINS_DIR = cache;
    const twin = createCandidateTwin(repo, { agentsMdContent: '# recipe', agentReadyJsonContent: '{}', summaryChanges: [] });
    const name = mode === 'ignored' ? 'private.log' : 'user-work.txt';
    fs.writeFileSync(path.join(twin.twinPath, name), 'preserve me');
    if (mode === 'ignored') fs.appendFileSync(path.join(repo, '.git', 'info', 'exclude'), '\n*.log\n');
    else {
      git(twin.twinPath, ['add', name]);
      if (mode === 'committed') git(twin.twinPath, ['commit', '-m', 'user work']);
    }
    expect(cleanTwins(repo)).toEqual({ cleaned: 0, skippedDirty: 1 });
    expect(fs.readFileSync(path.join(twin.twinPath, name), 'utf8')).toBe('preserve me');
    expect(git(repo, ['show-ref', '--verify', `refs/heads/${twin.branchName}`])).toBeTruthy();
  });
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

  it('removes generated ignored artifacts but refuses source changes', () => {
    const repo = temporaryRepository();
    const cache = fs.mkdtempSync(path.join(os.tmpdir(), 'repotwin-cache-'));
    directories.push(cache);
    process.env.REPOTWIN_TWINS_DIR = cache;
    fs.appendFileSync(path.join(repo, '.git', 'info', 'exclude'), '\ndist/\n');
    const twin = createCandidateTwin(repo, { agentsMdContent: '# recipe', agentReadyJsonContent: '{}', summaryChanges: [] });

    fs.mkdirSync(path.join(twin.twinPath, 'dist'));
    fs.writeFileSync(path.join(twin.twinPath, 'dist', 'bundle.js'), 'generated');
    expect(cleanCandidateIgnoredArtifacts(repo, twin)).toEqual(['dist/bundle.js']);
    expect(fs.existsSync(path.join(twin.twinPath, 'dist'))).toBe(false);
    expect(candidateIsIntact(repo, twin)).toBe(true);

    fs.writeFileSync(path.join(twin.twinPath, 'README.md'), '# changed by command\n');
    expect(() => cleanCandidateIgnoredArtifacts(repo, twin)).toThrow('changed source files');
  });

  it('checks out submodules in the twin from local clones and reports missing ones', () => {
    const shared = temporaryRepository();
    fs.writeFileSync(path.join(shared, 'index.ts'), 'export const shared = 1;\n');
    git(shared, ['add', 'index.ts']);
    git(shared, ['commit', '-m', 'shared code']);
    const repo = temporaryRepository();
    git(repo, ['-c', 'protocol.file.allow=always', 'submodule', 'add', shared, 'libs/shared']);
    git(repo, ['commit', '-m', 'add submodule']);
    const cache = fs.mkdtempSync(path.join(os.tmpdir(), 'repotwin-cache-'));
    directories.push(cache);
    process.env.REPOTWIN_TWINS_DIR = cache;
    const recipe = { agentsMdContent: '# recipe', agentReadyJsonContent: '{}', summaryChanges: [] };

    const twin = createCandidateTwin(repo, recipe);
    expect(twin.submodulesInitialized).toEqual(['libs/shared']);
    expect(twin.submoduleWarnings).toEqual([]);
    expect(fs.readFileSync(path.join(twin.twinPath, 'libs/shared/index.ts'), 'utf8')).toContain('shared = 1');

    // Untracked artifacts inside a submodule (e.g. installed dependencies) keep the candidate intact.
    fs.writeFileSync(path.join(twin.twinPath, 'libs/shared/artifact.tmp'), 'build output');
    expect(candidateIsIntact(repo, twin)).toBe(true);
    // A modified tracked file inside a submodule is still detected.
    fs.writeFileSync(path.join(twin.twinPath, 'libs/shared/index.ts'), 'tampered');
    expect(candidateIsIntact(repo, twin)).toBe(false);
    git(path.join(twin.twinPath, 'libs/shared'), ['checkout', '--', 'index.ts']);
    fs.rmSync(path.join(twin.twinPath, 'libs/shared/artifact.tmp'));
    expect(cleanTwins(repo)).toEqual({ cleaned: 1, skippedDirty: 0 });

    git(repo, ['submodule', 'deinit', '-f', 'libs/shared']);
    const withoutClone = createCandidateTwin(repo, recipe);
    expect(withoutClone.submodulesInitialized).toEqual([]);
    expect(withoutClone.submoduleWarnings?.[0]).toContain('libs/shared: not cloned locally');
  }, 20_000);
});
