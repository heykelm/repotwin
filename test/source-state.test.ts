import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { afterEach, expect, it } from 'vitest';
import { captureSourceState, assertSourceUnchanged } from '../src/verification/source-state.js';
import { createCandidateTwin } from '../src/twin/worktree-manager.js';

const directories: string[] = [];
afterEach(() => {
  delete process.env.REPOTWIN_TWINS_DIR;
  directories.splice(0).forEach(directory => fs.rmSync(directory, { recursive: true, force: true }));
});
function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rt-source-'));
  directories.push(dir);
  const git = (...args: string[]) => execFileSync('git', ['-C', dir, ...args], { stdio: 'pipe' });
  git('init'); git('config', 'user.email', 'test@example.com'); git('config', 'user.name', 'test');
  fs.writeFileSync(path.join(dir, 'code.js'), 'original');
  git('add', '.'); git('commit', '-m', 'fixture');
  return { dir, git };
}
it('binds verification to code, index, untracked content and HEAD', () => {
  const { dir, git } = fixture();
  const initial = captureSourceState(dir);
  fs.writeFileSync(path.join(dir, 'code.js'), 'changed');
  expect(() => assertSourceUnchanged(dir, initial)).toThrow('Source repository changed');
  git('add', '.');
  fs.writeFileSync(path.join(dir, 'code.js'), 'original');
  expect(() => assertSourceUnchanged(dir, initial)).toThrow('Source repository changed');
  git('reset', '--', 'code.js');
  expect(() => assertSourceUnchanged(dir, initial)).not.toThrow();
  fs.writeFileSync(path.join(dir, 'new.js'), 'one');
  const withUntracked = captureSourceState(dir);
  fs.writeFileSync(path.join(dir, 'new.js'), 'two');
  expect(() => assertSourceUnchanged(dir, withUntracked)).toThrow('Source repository changed');
  git('add', '.'); git('commit', '-m', 'new commit');
  expect(() => assertSourceUnchanged(dir, initial)).toThrow('Source repository changed');
});
it('ignores only tool-owned report artifacts', () => {
  const { dir } = fixture();
  const state = captureSourceState(dir);
  fs.mkdirSync(path.join(dir, '.repotwin'));
  fs.writeFileSync(path.join(dir, '.repotwin', 'report.json'), '{}');
  expect(() => assertSourceUnchanged(dir, state)).not.toThrow();
});
it('does not execute checkout hooks when creating a candidate', () => {
  const { dir } = fixture();
  const cache = fs.mkdtempSync(path.join(os.tmpdir(), 'rt-hook-cache-'));
  directories.push(cache);
  process.env.REPOTWIN_TWINS_DIR = cache;
  const marker = path.join(dir, 'hook-ran');
  fs.writeFileSync(path.join(dir, '.git', 'hooks', 'post-checkout'), '#!/bin/sh\nprintf ran > "' + marker + '"\n', { mode: 0o755 });
  createCandidateTwin(dir, { agentsMdContent: '# instructions', agentReadyJsonContent: '{}', summaryChanges: [] });
  expect(fs.existsSync(marker)).toBe(false);
});
