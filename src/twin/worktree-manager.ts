import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { GeneratedRecipe } from '../generator/recipe-agents-md.js';

export interface TwinResult {
  twinPath: string;
  branchName: string;
  filesModified: string[];
  diff?: string;
  /** Submodules checked out in the twin from local clones. */
  submodulesInitialized?: string[];
  /** Submodules that could not be checked out; their commands will fail. */
  submoduleWarnings?: string[];
}

export interface CleanTwinsResult {
  cleaned: number;
  skippedDirty: number;
}

function twinsBaseDir(): string {
  return process.env.REPOTWIN_TWINS_DIR || path.join(os.homedir(), '.cache', 'repotwin', 'twins');
}

function manifestPath(): string {
  return path.join(twinsBaseDir(), 'manifest.json');
}

function runGit(repoPath: string, args: string[]): string {
  return execFileSync('git', ['-C', repoPath, ...args], {
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe']
  });
}

function assertGitRepository(repoPath: string): void {
  if (!fs.statSync(repoPath).isDirectory()) {
    throw new Error(`Repository path is not a directory: ${repoPath}`);
  }

  const result = runGit(repoPath, ['rev-parse', '--is-inside-work-tree']).trim();
  if (result !== 'true') {
    throw new Error(`Repository path is not a Git work tree: ${repoPath}`);
  }
}

function isManagedTwinPath(worktreePath: string): boolean {
  try {
    const baseDir = fs.realpathSync(twinsBaseDir());
    const candidate = fs.realpathSync(worktreePath);
    const relative = path.relative(baseDir, candidate);
    return relative.length > 0 && !relative.startsWith(`..${path.sep}`) && relative !== '..';
  } catch {
    return false;
  }
}

function writeFileAtomically(target: string, content: string): void {
  const tempPath = `${target}.${process.pid}.${crypto.randomUUID()}.tmp`;
  fs.writeFileSync(tempPath, content, { encoding: 'utf-8', mode: 0o600 });
  fs.renameSync(tempPath, target);
}

function sha256(content: string): string {
  return crypto.createHash('sha256').update(content).digest('hex');
}

interface TwinManifestRecord {
  baseCommit: string;
  repoPath: string;
  twinPath: string;
  branchName: string;
  fileHashes: Record<string, string>;
}

function readManifest(): TwinManifestRecord[] {
  try {
    const parsed = JSON.parse(fs.readFileSync(manifestPath(), 'utf-8'));
    return Array.isArray(parsed?.twins) ? parsed.twins : [];
  } catch {
    return [];
  }
}

function writeManifest(records: TwinManifestRecord[]): void {
  fs.mkdirSync(twinsBaseDir(), { recursive: true, mode: 0o700 });
  writeFileAtomically(manifestPath(), `${JSON.stringify({ version: 1, twins: records }, null, 2)}\n`);
}

interface WorktreeRecord {
  path: string;
  branch?: string;
}

/**
 * Checks out declared submodules inside a twin using the user's existing local
 * clones as the source. Nothing is fetched from the network and the main
 * repository's submodules are only read. The pinned commit must already exist
 * in the local clone; otherwise the submodule is reported and left empty.
 */
function initializeSubmodulesFromLocalClones(repoPath: string, twinPath: string): { initialized: string[]; warnings: string[] } {
  const initialized: string[] = [];
  const warnings: string[] = [];
  if (!fs.existsSync(path.join(twinPath, '.gitmodules'))) return { initialized, warnings };

  let entries: Array<{ name: string; subPath: string }> = [];
  try {
    entries = runGit(twinPath, ['config', '-f', '.gitmodules', '--get-regexp', '^submodule\\..*\\.path$'])
      .split('\n').filter(Boolean)
      .map(line => {
        const [key, ...rest] = line.split(' ');
        return { name: key!.replace(/^submodule\./, '').replace(/\.path$/, ''), subPath: rest.join(' ') };
      });
  } catch {
    return { initialized, warnings: ['.gitmodules could not be read'] };
  }

  for (const { name, subPath } of entries) {
    const localClone = path.resolve(repoPath, subPath);
    const relative = path.relative(repoPath, localClone);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      warnings.push(`${subPath}: path escapes the repository`);
      continue;
    }
    let isClone = false;
    try {
      const topLevel = runGit(localClone, ['rev-parse', '--show-toplevel']).trim();
      isClone = fs.realpathSync(topLevel) === fs.realpathSync(localClone);
    } catch { /* not cloned */ }
    if (!isClone) {
      warnings.push(`${subPath}: not cloned locally (run git submodule update --init in the main repository)`);
      continue;
    }
    try {
      runGit(twinPath, ['submodule', 'init', '--', subPath]);
      runGit(twinPath, ['config', `submodule.${name}.url`, localClone]);
      runGit(twinPath, ['-c', 'protocol.file.allow=always', 'submodule', 'update', '--no-fetch', '--', subPath]);
      initialized.push(subPath);
    } catch {
      try {
        runGit(twinPath, ['-c', 'protocol.file.allow=always', 'submodule', 'update', '--', subPath]);
        initialized.push(subPath);
      } catch (error) {
        const stderr = (error as { stderr?: string }).stderr?.trim().split('\n').pop() ?? 'checkout failed';
        warnings.push(`${subPath}: ${stderr}`);
      }
    }
  }
  return { initialized, warnings };
}

function matchesRecipe(record: TwinManifestRecord): boolean {
  const expectedFiles = Object.keys(record.fileHashes);
  try {
    if (!record.baseCommit || runGit(record.twinPath, ['rev-parse', 'HEAD']).trim() !== record.baseCommit) return false;
    if (runGit(record.twinPath, ['diff', '--cached', '--name-only', '-z'])) return false;
    if (runGit(record.twinPath, ['ls-files', '--others', '--ignored', '--exclude-standard', '-z'])) return false;
    const changed = runGit(record.twinPath, ['diff', '--ignore-submodules=untracked', '--name-only', '-z']).split('\0').filter(Boolean);
    const untracked = runGit(record.twinPath, ['ls-files', '--others', '--exclude-standard', '-z']).split('\0').filter(Boolean);
    const allChanged = new Set([...changed, ...untracked]);
    if ([...allChanged].some(file => !expectedFiles.includes(file))) return false;

    return expectedFiles.every(file => {
      const target = path.join(record.twinPath, file);
      return fs.existsSync(target) && sha256(fs.readFileSync(target, 'utf-8')) === record.fileHashes[file];
    });
  } catch {
    return false;
  }
}

function listWorktrees(repoPath: string): WorktreeRecord[] {
  const output = runGit(repoPath, ['worktree', 'list', '--porcelain']);
  const records: WorktreeRecord[] = [];
  let current: Partial<WorktreeRecord> = {};

  for (const line of output.split('\n')) {
    if (line === '') {
      if (current.path) records.push(current as WorktreeRecord);
      current = {};
    } else if (line.startsWith('worktree ')) {
      current.path = line.slice('worktree '.length);
    } else if (line.startsWith('branch ')) {
      current.branch = line.slice('branch refs/heads/'.length);
    }
  }
  if (current.path) records.push(current as WorktreeRecord);
  return records;
}

/**
 * Creates an isolated git worktree outside the repo and applies the candidate recipe.
 */
export function createCandidateTwin(
  repoPath: string,
  recipe: GeneratedRecipe
): TwinResult {
  assertGitRepository(repoPath);

  const canonicalRepoPath = fs.realpathSync(repoPath);
  const token = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
  const repoName = path.basename(canonicalRepoPath).replace(/[^a-zA-Z0-9._-]/g, '_');
  const branchName = `repotwin/candidate-${token}`;
  const requestedBaseDir = twinsBaseDir();
  fs.mkdirSync(requestedBaseDir, { recursive: true, mode: 0o700 });
  const baseDir = fs.realpathSync(requestedBaseDir);
  const twinPath = path.join(baseDir, `${repoName}-candidate-${token}`);
  runGit(canonicalRepoPath, ['worktree', 'add', '-b', branchName, twinPath, 'HEAD']);
  const submodules = initializeSubmodulesFromLocalClones(canonicalRepoPath, twinPath);

  try {
    writeFileAtomically(path.join(twinPath, 'AGENTS.md'), recipe.agentsMdContent);
    writeFileAtomically(path.join(twinPath, 'agent-ready.json'), recipe.agentReadyJsonContent);
    const records = readManifest().filter(record => record.twinPath !== twinPath);
    records.push({
      baseCommit: runGit(twinPath, ['rev-parse', 'HEAD']).trim(),
      repoPath: canonicalRepoPath,
      twinPath,
      branchName,
      fileHashes: {
        'AGENTS.md': sha256(recipe.agentsMdContent),
        'agent-ready.json': sha256(recipe.agentReadyJsonContent)
      }
    });
    writeManifest(records);
  } catch (error) {
    try {
      runGit(canonicalRepoPath, ['worktree', 'remove', twinPath]);
      runGit(canonicalRepoPath, ['branch', '-d', branchName]);
    } catch {
      // Preserve the write error; manual cleanup is safer than force deletion.
    }
    throw error;
  }

  let diff = '';
  for (const file of ['AGENTS.md', 'agent-ready.json']) {
    let tracked = true;
    try { runGit(twinPath, ['ls-files', '--error-unmatch', '--', file]); } catch { tracked = false; }
    if (tracked) diff += runGit(twinPath, ['diff', '--no-color', 'HEAD', '--', file]);
    else {
      try {
        diff += runGit(twinPath, ['diff', '--no-index', '--no-color', '--', process.platform === 'win32' ? 'NUL' : '/dev/null', file]);
      } catch (error) {
        const result = error as { status?: number; stdout?: string };
        if (result.status !== 1 || typeof result.stdout !== 'string') throw error;
        diff += result.stdout;
      }
    }
  }

  return {
    twinPath,
    branchName,
    filesModified: ['AGENTS.md', 'agent-ready.json'],
    diff,
    submodulesInitialized: submodules.initialized,
    submoduleWarnings: submodules.warnings
  };
}

export function candidateIsIntact(repoPath: string, twin: TwinResult): boolean {
  const record = readManifest().find(record => record.repoPath === fs.realpathSync(repoPath) && record.twinPath === twin.twinPath && record.branchName === twin.branchName);
  return Boolean(record && matchesRecipe(record));
}

/**
 * Removes only ignored artifacts created after a verified command run. The
 * candidate recipe and every non-ignored path must still match before cleanup.
 */
export function cleanCandidateIgnoredArtifacts(repoPath: string, twin: TwinResult): string[] {
  const canonicalRepoPath = fs.realpathSync(repoPath);
  const record = readManifest().find(item =>
    item.repoPath === canonicalRepoPath && item.twinPath === twin.twinPath && item.branchName === twin.branchName
  );
  if (!record || !isManagedTwinPath(record.twinPath)) throw new Error('Candidate is not owned by RepoTwin');
  if (runGit(record.twinPath, ['rev-parse', 'HEAD']).trim() !== record.baseCommit) throw new Error('Candidate commit changed during verification');
  if (runGit(record.twinPath, ['diff', '--cached', '--name-only', '-z'])) throw new Error('Candidate staged files during verification');

  const expectedFiles = Object.keys(record.fileHashes);
  const changed = runGit(record.twinPath, ['diff', '--ignore-submodules=untracked', '--name-only', '-z']).split('\0').filter(Boolean);
  const untracked = runGit(record.twinPath, ['ls-files', '--others', '--exclude-standard', '-z']).split('\0').filter(Boolean);
  if ([...changed, ...untracked].some(file => !expectedFiles.includes(file))) {
    throw new Error('Project commands changed source files in the candidate');
  }
  for (const file of expectedFiles) {
    const target = path.join(record.twinPath, file);
    if (!fs.existsSync(target) || sha256(fs.readFileSync(target, 'utf-8')) !== record.fileHashes[file]) {
      throw new Error(`Project commands changed generated recipe file: ${file}`);
    }
  }

  const ignored = runGit(record.twinPath, ['ls-files', '--others', '--ignored', '--exclude-standard', '-z']).split('\0').filter(Boolean);
  if (ignored.length) runGit(record.twinPath, ['clean', '-fdX']);
  return ignored;
}

/**
 * Cleans up all repotwin worktrees and branches.
 */
export function cleanTwins(repoPath: string): CleanTwinsResult {
  assertGitRepository(repoPath);
  let cleaned = 0;
  let skippedDirty = 0;
  const canonicalRepoPath = fs.realpathSync(repoPath);
  const manifestRecords = readManifest();
  const remainingRecords: TwinManifestRecord[] = [];

  for (const worktree of listWorktrees(repoPath)) {
    const isCandidateBranch = Boolean(worktree.branch && /^repotwin\/candidate-\d+-[a-f0-9]{8}$/.test(worktree.branch));
    if (!isManagedTwinPath(worktree.path) || !isCandidateBranch || !worktree.branch) continue;
    const manifestRecord = manifestRecords.find(record =>
      record.repoPath === canonicalRepoPath && record.twinPath === worktree.path && record.branchName === worktree.branch
    );
    if (!manifestRecord || !matchesRecipe(manifestRecord)) {
      skippedDirty++;
      continue;
    }

    runGit(repoPath, ['worktree', 'remove', '--force', worktree.path]);
    runGit(repoPath, ['branch', '-d', worktree.branch]);
    cleaned++;
  }

  for (const record of manifestRecords) {
    const wasRemoved = record.repoPath === canonicalRepoPath && !fs.existsSync(record.twinPath);
    if (!wasRemoved) remainingRecords.push(record);
  }
  writeManifest(remainingRecords);

  runGit(repoPath, ['worktree', 'prune']);
  return { cleaned, skippedDirty };
}
