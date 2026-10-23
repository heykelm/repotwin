import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execSync } from 'node:child_process';
import { GeneratedRecipe } from '../generator/recipe-agents-md.js';

export interface TwinResult {
  twinPath: string;
  branchName: string;
  filesModified: string[];
}

/**
 * Creates an isolated git worktree outside the repo and applies the candidate recipe.
 */
export function createCandidateTwin(
  repoPath: string,
  recipe: GeneratedRecipe
): TwinResult {
  const repoName = path.basename(repoPath);
  const timestamp = Date.now();
  const branchName = `repotwin/candidate-${timestamp}`;
  const baseDir = path.join(os.homedir(), '.cache', 'repotwin', 'twins');
  const twinPath = path.join(baseDir, `${repoName}-candidate-${timestamp}`);

  fs.mkdirSync(baseDir, { recursive: true });

  // 1. Create worktree from HEAD
  execSync(`git -C "${repoPath}" worktree add -b "${branchName}" "${twinPath}" HEAD`, {
    stdio: 'pipe'
  });

  // 2. Apply recipe files in the worktree
  const agentsMdTarget = path.join(twinPath, 'AGENTS.md');
  const agentReadyJsonTarget = path.join(twinPath, 'agent-ready.json');

  fs.writeFileSync(agentsMdTarget, recipe.agentsMdContent, 'utf-8');
  fs.writeFileSync(agentReadyJsonTarget, recipe.agentReadyJsonContent, 'utf-8');

  return {
    twinPath,
    branchName,
    filesModified: ['AGENTS.md', 'agent-ready.json']
  };
}

/**
 * Cleans up all repotwin worktrees and branches.
 */
export function cleanTwins(repoPath: string): number {
  let cleaned = 0;
  try {
    const output = execSync(`git -C "${repoPath}" worktree list`, { encoding: 'utf-8' });
    const lines = output.trim().split('\n');

    for (const line of lines) {
      if (line.includes('repotwin')) {
        const wtPath = line.split(' ')[0];
        try {
          execSync(`git -C "${repoPath}" worktree remove --force "${wtPath}"`, { stdio: 'pipe' });
          cleaned++;
        } catch {
          // ignore
        }
      }
    }

    execSync(`git -C "${repoPath}" worktree prune`, { stdio: 'pipe' });
  } catch {
    // ignore
  }

  return cleaned;
}
