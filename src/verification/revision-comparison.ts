import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { discoverSubprojects } from '../analyzer/subproject-scanner.js';
import { initializeSubmodulesFromLocalClones } from '../twin/worktree-manager.js';
import { buildValidationPlan, runValidationPlan, ValidationCommand, ValidationProgressEvent, ValidationResult } from './command-runner.js';

type Side = 'before' | 'after';
export type ComparisonOutcome = 'regression' | 'fixed' | 'failing-both' | 'passing-both' | 'not-verified';
export interface ComparisonCheck {
  command: ValidationCommand;
  outcome: ComparisonOutcome;
  reason?: string;
  before?: ValidationResult;
  after?: ValidationResult;
}
export interface ComparisonPlan {
  baseCommit: string;
  targetCommit: string;
  before: ValidationCommand[];
  after: ValidationCommand[];
  definitions: Record<Side, Record<string, string>>;
  warnings: string[];
  fingerprint: string;
}

function git(repo: string, args: string[]) {
  return execFileSync('git', ['-c', 'core.hooksPath=' + os.devNull, '-C', repo, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 128 * 1024 * 1024,
  });
}
function resolveCommit(repo: string, ref: string) {
  if (!ref || ref.length > 256 || ref.startsWith('-') || /[\x00-\x1f]/.test(ref)) throw new Error('Invalid revision. Use a commit, branch or tag.');
  return git(repo, ['rev-parse', '--verify', '--end-of-options', `${ref}^{commit}`]).trim();
}
interface Snapshot { directory: string; worktree: string; warnings: string[] }
function snapshot(repo: string, commit: string): Snapshot {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'repotwin-compare-'));
  const worktree = path.join(directory, 'repo');
  try {
    git(repo, ['worktree', 'add', '--detach', worktree, commit]);
    return { directory, worktree, warnings: initializeSubmodulesFromLocalClones(repo, worktree).warnings };
  } catch (error) {
    // Never remove a partially created checkout without inspecting it.
    throw new Error(`Could not create comparison snapshot. Inspect ${directory}. ${error instanceof Error ? error.message : ''}`);
  }
}
function isIntact(snapshot: Snapshot, commit: string) {
  return git(snapshot.worktree, ['rev-parse', 'HEAD']).trim() === commit &&
    git(snapshot.worktree, ['status', '--porcelain', '--untracked-files=all']).trim() === '';
}
function dispose(repo: string, snapshot: Snapshot, commit: string, warnings: string[]) {
  try {
    if (!isIntact(snapshot, commit)) {
      warnings.push(`Source changes made by commands preserved for inspection: ${snapshot.worktree}`);
      return;
    }
    // This temporary checkout is owned by this run; only ignored artifacts remain.
    git(repo, ['worktree', 'remove', '--force', snapshot.worktree]);
    fs.rmdirSync(snapshot.directory);
  } catch { warnings.push(`Comparison snapshot retained: ${snapshot.worktree}`); }
}
function describe(root: string, commands: ValidationCommand[]) {
  const definitions: Record<string, string> = {};
  for (const command of commands) {
    if (command.kind === 'install') continue;
    if (command.executable === 'npm' && command.args[0] === 'run') {
      try {
        const scripts = JSON.parse(fs.readFileSync(path.join(root, command.relPath, 'package.json'), 'utf8')).scripts ?? {};
        const name = command.args[1];
        definitions[command.id] = JSON.stringify([scripts[`pre${name}`] ?? '', scripts[name] ?? '', scripts[`post${name}`] ?? '']);
      } catch { definitions[command.id] = '(manifest unavailable)'; }
    } else definitions[command.id] = command.display;
  }
  return definitions;
}
function planForSnapshots(base: Snapshot, target: Snapshot, baseCommit: string, targetCommit: string): ComparisonPlan {
  const before = buildValidationPlan(discoverSubprojects(base.worktree));
  const after = buildValidationPlan(discoverSubprojects(target.worktree));
  const definitions = { before: describe(base.worktree, before), after: describe(target.worktree, after) };
  const payload = { baseCommit, targetCommit, before, after, definitions };
  return { ...payload, warnings: [...base.warnings, ...target.warnings], fingerprint: crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex') };
}

/** Preparing a plan does not execute project code or install dependencies. */
export function prepareComparison(repoPath: string, baseRef: string, targetRef: string): ComparisonPlan {
  const repo = fs.realpathSync(repoPath);
  const baseCommit = resolveCommit(repo, baseRef);
  const targetCommit = resolveCommit(repo, targetRef);
  const base = snapshot(repo, baseCommit);
  let target: Snapshot | undefined;
  const warnings: string[] = [];
  try {
    target = snapshot(repo, targetCommit);
    const plan = planForSnapshots(base, target, baseCommit, targetCommit);
    return { ...plan, warnings };
  } finally {
    warnings.push(...base.warnings, ...(target?.warnings ?? []));
    if (target) dispose(repo, target, targetCommit, warnings);
    dispose(repo, base, baseCommit, warnings);
  }
}

export function classifyChecks(plan: ComparisonPlan, before: ValidationResult[], after: ValidationResult[], intact = true): ComparisonCheck[] {
  const commands = new Map([...plan.before, ...plan.after].filter(c => c.kind !== 'install').map(c => [c.id, c]));
  return [...commands.values()].map(command => {
    const a = before.find(result => result.id === command.id);
    const b = after.find(result => result.id === command.id);
    let outcome: ComparisonOutcome = 'not-verified';
    let reason: string | undefined;
    if (!intact) reason = 'Commands changed snapshot source files; comparison is invalid.';
    else if (!a || !b) reason = 'Control is declared on only one side.';
    else if (plan.definitions.before[command.id] !== plan.definitions.after[command.id]) reason = 'Command definition or npm lifecycle changed; results are not directly comparable.';
    else if (!['passed', 'failed'].includes(a.status) || !['passed', 'failed'].includes(b.status)) reason = 'Command unavailable, skipped or timed out on at least one side.';
    else if (a.status === 'passed' && b.status === 'failed') outcome = 'regression';
    else if (a.status === 'failed' && b.status === 'passed') outcome = 'fixed';
    else outcome = a.status === 'passed' ? 'passing-both' : 'failing-both';
    return { command, outcome, reason, before: a, after: b };
  });
}

export async function compareRevisions(repoPath: string, approved: ComparisonPlan, options: {
  timeoutMs?: number;
  onProgress?: (side: Side, event: ValidationProgressEvent) => void;
} = {}) {
  const repo = fs.realpathSync(repoPath);
  const base = snapshot(repo, approved.baseCommit);
  let target: Snapshot | undefined;
  const warnings = [...approved.warnings];
  try {
    target = snapshot(repo, approved.targetCommit);
    const actual = planForSnapshots(base, target, approved.baseCommit, approved.targetCommit);
    if (actual.fingerprint !== approved.fingerprint) throw new Error('Comparison plan changed. Review a new plan before executing.');
    warnings.push(...actual.warnings);
    const startedAt = new Date().toISOString();
    const before = await runValidationPlan(base.worktree, actual.before, { timeoutMs: options.timeoutMs, onProgress: e => options.onProgress?.('before', e) });
    const after = await runValidationPlan(target.worktree, actual.after, { timeoutMs: options.timeoutMs, onProgress: e => options.onProgress?.('after', e) });
    const intact = isIntact(base, actual.baseCommit) && isIntact(target, actual.targetCommit);
    const checks = classifyChecks(actual, before, after, intact);
    const counts = Object.fromEntries(['regression', 'fixed', 'failing-both', 'passing-both', 'not-verified'].map(outcome => [outcome, checks.filter(c => c.outcome === outcome).length]));
    return {
      baseCommit: actual.baseCommit, targetCommit: actual.targetCommit, startedAt,
      finishedAt: new Date().toISOString(), checks, counts, before, after, warnings,
      verdict: !intact || warnings.length || !checks.length || counts['not-verified'] ? 'incomplete' : counts.regression ? 'regressions' : 'no-regression-observed',
      scope: 'declared-project-controls' as const
    };
  } finally {
    if (target) dispose(repo, target, approved.targetCommit, warnings);
    dispose(repo, base, approved.baseCommit, warnings);
  }
}
