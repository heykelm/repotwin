import os from 'node:os';
import { execFileSync } from 'node:child_process';

/** Git inspection and checkout must never invoke repository hooks. */
export function runGit(repoPath: string, args: string[]): string {
  return execFileSync('git', ['-c', `core.hooksPath=${os.devNull}`, '-C', repoPath, ...args], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 128 * 1024 * 1024
  });
}
