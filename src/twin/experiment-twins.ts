import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';
import { runGit } from '../git.js';
import { initializeSubmodulesFromLocalClones } from './worktree-manager.js';

export interface ExperimentTwinPair {
  experimentId: string;
  baseCommit: string;
  baselinePath: string;
  candidatePath: string;
  baselineBranch: string;
  candidateBranch: string;
  filesModifiedInCandidate: string[];
  clean: () => void;
}

export interface CandidatePatchInput {
  files?: Record<string, string>; // relative path -> content
  patchContent?: string;
  allowSourceEdits?: boolean;
}

const DEFAULT_ALLOWED_CONFIG_FILES = [
  'AGENTS.md',
  'CLAUDE.md',
  'GEMINI.md',
  '.cursorrules',
  'agent-ready.json'
];

function isPathAllowed(relPath: string, allowSourceEdits = false): boolean {
  if (allowSourceEdits) return true;
  const base = path.basename(relPath);
  if (DEFAULT_ALLOWED_CONFIG_FILES.includes(base)) return true;
  if (relPath.startsWith('.cursor/rules/')) return true;
  return false;
}

export function createExperimentTwinPair(
  repoPath: string,
  baseCommitArg?: string,
  patchInput?: CandidatePatchInput
): ExperimentTwinPair {
  const resolvedRepo = path.resolve(repoPath);
  const baseCommit = baseCommitArg
    ? runGit(resolvedRepo, ['rev-parse', baseCommitArg]).trim()
    : runGit(resolvedRepo, ['rev-parse', 'HEAD']).trim();

  const experimentId = `exp-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
  const baseDir = process.env.REPOTWIN_TWINS_DIR || path.join(os.homedir(), '.cache', 'repotwin', 'twins');
  fs.mkdirSync(baseDir, { recursive: true, mode: 0o700 });

  const baselinePath = path.join(baseDir, `${experimentId}-baseline`);
  const candidatePath = path.join(baseDir, `${experimentId}-candidate`);

  const baselineBranch = `repotwin/${experimentId}-baseline`;
  const candidateBranch = `repotwin/${experimentId}-candidate`;

  // Create baseline worktree
  runGit(resolvedRepo, ['worktree', 'add', '-b', baselineBranch, baselinePath, baseCommit]);
  initializeSubmodulesFromLocalClones(resolvedRepo, baselinePath);

  // Create candidate worktree
  runGit(resolvedRepo, ['worktree', 'add', '-b', candidateBranch, candidatePath, baseCommit]);
  initializeSubmodulesFromLocalClones(resolvedRepo, candidatePath);

  const filesModifiedInCandidate: string[] = [];

  // Apply candidate patch if provided
  if (patchInput?.files) {
    for (const [relPath, content] of Object.entries(patchInput.files)) {
      if (!isPathAllowed(relPath, patchInput.allowSourceEdits)) {
        throw new Error(`File ${relPath} is not in the approved candidate patch allowlist. Enable allowSourceEdits to modify source code.`);
      }
      const target = path.join(candidatePath, relPath);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, content, 'utf-8');
      filesModifiedInCandidate.push(relPath);
    }
  }

  const clean = () => {
    try {
      if (fs.existsSync(candidatePath)) {
        runGit(resolvedRepo, ['worktree', 'remove', '--force', candidatePath]);
      }
      runGit(resolvedRepo, ['branch', '-D', candidateBranch]);
    } catch {
      // ignore clean errors
    }

    try {
      if (fs.existsSync(baselinePath)) {
        runGit(resolvedRepo, ['worktree', 'remove', '--force', baselinePath]);
      }
      runGit(resolvedRepo, ['branch', '-D', baselineBranch]);
    } catch {
      // ignore clean errors
    }
  };

  return {
    experimentId,
    baseCommit,
    baselinePath,
    candidatePath,
    baselineBranch,
    candidateBranch,
    filesModifiedInCandidate,
    clean
  };
}
