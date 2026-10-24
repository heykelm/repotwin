import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { runGit } from '../git.js';

export interface SourceState { commit: string; fingerprint: string; hasUncommittedChanges: boolean }

/** Includes staged/unstaged content, untracked files and initialized submodules; excludes only RepoTwin artifacts. */
export function captureSourceState(repo: string): SourceState {
  const commit = runGit(repo, ['rev-parse', 'HEAD']).trim();
  const hash = crypto.createHash('sha256').update(commit);
  const paths = ['.', ':(exclude).repotwin'];
  hash.update(runGit(repo, ['diff', '--no-ext-diff', '--no-textconv', '--binary', 'HEAD', '--', ...paths]));
  hash.update(runGit(repo, ['diff', '--cached', '--no-ext-diff', '--no-textconv', '--binary', '--', ...paths]));
  const untracked = runGit(repo, ['ls-files', '--others', '--exclude-standard', '-z', '--', ...paths]).split('\0').filter(Boolean).sort();
  for (const file of untracked) {
    const target = path.join(repo, file);
    const stat = fs.lstatSync(target);
    hash.update(file).update('\0');
    if (stat.isSymbolicLink()) hash.update(fs.readlinkSync(target));
    else if (stat.isFile()) hash.update(fs.readFileSync(target));
  }
  const submodules = runGit(repo, ['ls-files', '--stage', '-z']).split('\0').filter(line => line.startsWith('160000 '));
  for (const entry of submodules) {
    const subPath = entry.slice(entry.indexOf('\t') + 1);
    const directory = path.join(repo, subPath);
    if (fs.existsSync(path.join(directory, '.git'))) hash.update(subPath).update(captureSourceState(directory).fingerprint);
  }
  const hasUncommittedChanges = runGit(repo, ['status', '--porcelain', '--untracked-files=all', '--', ...paths]).length > 0;
  return { commit, fingerprint: hash.digest('hex'), hasUncommittedChanges };
}

export function assertSourceUnchanged(repo: string, expected: SourceState): void {
  if (captureSourceState(repo).fingerprint !== expected.fingerprint) {
    throw new Error('Source repository changed since candidate creation. Create and verify a new twin.');
  }
}
