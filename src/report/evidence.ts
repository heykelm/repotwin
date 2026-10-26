import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import type { SubprojectInfo } from '../types/index.js';

type Json = Record<string, unknown>;
export interface ArchivedCommand {
  project: string;
  kind: string;
  display: string;
  durationMs?: number;
}
export interface FileEvidence {
  name: string;
  before: string | null;
  current: string | null;
  diff: Array<{ kind: 'same' | 'added' | 'removed'; text: string }> | null;
}
export interface LocalEvidence {
  generatedAt: string;
  head: string | null;
  instructionFilesDirty: boolean | null;
  snapshot: { id: string | null; date: string | null; commit: string | null };
  backupDir: string | null;
  files: FileEvidence[];
  customRules: 'same' | 'different' | 'unknown';
  addedProjects: string[];
  addedCommands: string[];
  addedProtectedPaths: string[];
  configurationCompared: boolean;
  currentChecks: Array<ArchivedCommand & { directory: string }>;
  setups: ArchivedCommand[];
  archivedChecks: ArchivedCommand[];
  checksDate: string | null;
  history: Array<{ id: string; date: string; git: string | null }>;
}
function record(value: unknown): Json | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Json : null;
}
function text(value: unknown): string | null { return typeof value === 'string' ? value : null; }
function date(value: unknown): string | null {
  const raw = text(value);
  return raw && Number.isFinite(Date.parse(raw)) ? raw : null;
}
function readText(base: string, candidate: string): string | null {
  try {
    const root = fs.realpathSync(base);
    const file = fs.realpathSync(candidate);
    if (!file.startsWith(root + path.sep)) return null;
    const stat = fs.statSync(file);
    if (!stat.isFile() || stat.size > 1024 * 1024) return null;
    return fs.readFileSync(file, 'utf8');
  } catch { return null; }
}
function parse(raw: string | null): Json | null {
  try { return raw === null ? null : record(JSON.parse(raw)); } catch { return null; }
}
function commands(value: unknown): ArchivedCommand[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap(raw => {
    const entry = record(raw);
    if (!entry) return [];
    const project = text(entry.project);
    const kind = text(entry.kind);
    const display = text(entry.display) ?? text(entry.command);
    if (!project || !kind || !display) return [];
    const duration = entry.durationMs;
    return [{ project, kind, display, durationMs: typeof duration === 'number' && Number.isFinite(duration) && duration >= 0 ? duration : undefined }];
  });
}
function configPaths(raw: string | null): string[] {
  const projects = parse(raw)?.projects;
  return Array.isArray(projects)
    ? projects.flatMap(project => { const value = text(record(project)?.path); return value === null ? [] : [value]; })
    : [];
}
function configCommands(raw: string | null): string[] {
  const verification = record(parse(raw)?.verification);
  return verification ? [...new Set(Object.values(verification).flatMap(value =>
    Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
  ))] : [];
}
function protectedPaths(raw: string | null): string[] {
  const values = record(parse(raw)?.safety)?.protectedPaths;
  return Array.isArray(values) ? values.filter((value): value is string => typeof value === 'string') : [];
}
export function diffLines(before: string, after: string): FileEvidence['diff'] {
  if (before === after) return [];
  const a = before.split('\n'), b = after.split('\n');
  // Very large comparisons stay readable as separate complete sources.
  if (a.length * b.length > 500000) return null;
  const matrix = Array.from({ length: a.length + 1 }, () => new Uint32Array(b.length + 1));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      matrix[i][j] = a[i] === b[j] ? matrix[i + 1][j + 1] + 1 : Math.max(matrix[i + 1][j], matrix[i][j + 1]);
    }
  }
  const lines: NonNullable<FileEvidence['diff']> = [];
  let i = 0, j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      lines.push({ kind: 'same', text: a[i++] }); j++;
    } else if (j < b.length && (i === a.length || matrix[i][j + 1] >= matrix[i + 1][j])) {
      lines.push({ kind: 'added', text: b[j++] });
    } else {
      lines.push({ kind: 'removed', text: a[i++] });
    }
  }
  return lines;
}
function customContent(raw: string): string | null {
  const start = '<!-- repotwin:start -->', end = '<!-- repotwin:end -->';
  if (raw.split(start).length !== 2 || raw.split(end).length !== 2 || raw.indexOf(start) > raw.indexOf(end)) return null;
  return raw.slice(raw.indexOf(end) + end.length);
}
export function readLocalEvidence(repoPath: string, projects: SubprojectInfo[]): LocalEvidence {
  const generatedAt = new Date().toISOString();
  const snapshotFile = path.join(repoPath, '.repotwin', 'reports', 'repotwin-certificate-latest.json');
  const snapshot = parse(readText(repoPath, snapshotFile));
  const rawBackup = text(snapshot?.backupDir);
  let backupDir: string | null = null;
  try {
    if (rawBackup) {
      const base = fs.realpathSync(path.join(repoPath, '.repotwin', 'backups'));
      const target = fs.realpathSync(rawBackup);
      if (target.startsWith(base + path.sep) && fs.statSync(target).isDirectory()) backupDir = target;
    }
  } catch {}
  const files: FileEvidence[] = ['AGENTS.md', 'agent-ready.json'].map(name => {
    const before = backupDir ? readText(backupDir, path.join(backupDir, name)) : null;
    const current = readText(repoPath, path.join(repoPath, name));
    return { name, before, current, diff: before !== null && current !== null ? diffLines(before, current) : null };
  });
  const agents = files[0], config = files[1];
  let customRules: LocalEvidence['customRules'] = 'unknown';
  if (agents.before !== null && agents.current !== null) {
    const original = customContent(agents.before), current = customContent(agents.current);
    if (original !== null && current !== null) customRules = original === current ? 'same' : 'different';
    else if (agents.before.length > 0 && current !== null && agents.current.endsWith(agents.before)) customRules = 'same';
  }
  const beforePaths = new Set(configPaths(config.before));
  const beforeCommands = new Set(configCommands(config.before));
  const addedProjects = config.before !== null && config.current !== null
    ? configPaths(config.current).filter(value => !beforePaths.has(value)) : [];
  const addedCommands = config.before !== null && config.current !== null
    ? configCommands(config.current).filter(value => !beforeCommands.has(value)) : [];
  const originalProtected = new Set(protectedPaths(config.before));
  const addedProtectedPaths = config.before !== null && config.current !== null
    ? protectedPaths(config.current).filter(value => !originalProtected.has(value)) : [];
  const configurationCompared = parse(config.before) !== null && parse(config.current) !== null;
  const currentChecks = projects.flatMap(project =>
    (['test', 'lint', 'build'] as const).flatMap(kind => {
      const display = project[kind === 'test' ? 'testScript' : kind === 'lint' ? 'lintScript' : 'buildScript'];
      return display ? [{ project: project.name, directory: project.relPath, kind, display }] : [];
    })
  );
  const legacyCommands = commands(record(snapshot?.commands)?.results);
  const setups = [...new Map(legacyCommands.filter(cmd => cmd.kind === 'install').map(cmd =>
    [JSON.stringify([cmd.project, cmd.kind, cmd.display]), cmd]
  )).values()];
  const log = parse(readText(repoPath, path.join(repoPath, '.repotwin', 'reports', 'mcp-checks-report.json')));
  const logRepo = text(log?.repoPath);
  const checksDate = date(log?.timestamp);
  const validLog = checksDate !== null && (!logRepo || path.resolve(logRepo) === path.resolve(repoPath));
  const archivedChecks = validLog ? [...new Map(commands(log?.passedCommands).filter(cmd => cmd.kind !== 'install').map(cmd =>
    [JSON.stringify([cmd.project, cmd.kind, cmd.display]), cmd]
  )).values()] : [];
  let head: string | null = null, instructionFilesDirty: boolean | null = null;
  try {
    head = execFileSync('git', ['-C', repoPath, 'rev-parse', '--verify', 'HEAD'], { encoding: 'utf8', timeout: 3000, stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    instructionFilesDirty = execFileSync('git', ['-C', repoPath, 'status', '--porcelain', '--untracked-files=normal', '--', 'AGENTS.md', 'agent-ready.json'], { encoding: 'utf8', timeout: 3000, stdio: ['ignore', 'pipe', 'ignore'] }).trim().length > 0;
  } catch {}
  const history = new Map<string, LocalEvidence['history'][number]>();
  try {
    const registryFile = path.join(os.homedir(), '.repotwin', 'registry.json');
    const raw = fs.readFileSync(registryFile, 'utf8');
    const entries: unknown = JSON.parse(raw);
    if (Array.isArray(entries)) for (const value of entries) {
      const entry = record(value);
      const repo = text(entry?.repoPath), time = date(entry?.timestamp);
      if (!entry || !repo || path.resolve(repo) !== path.resolve(repoPath) || !time) continue;
      const git = text(entry.git);
      const id = text(entry.id) || time + '|' + (git ?? '');
      if (!history.has(id)) history.set(id, { id, date: time, git });
    }
  } catch {}
  const baseCommit = text(snapshot?.baseCommit);
  return {
    generatedAt, head, instructionFilesDirty,
    snapshot: { id: text(snapshot?.id), date: date(snapshot?.appliedAt), commit: baseCommit && /^[a-f0-9]{7,40}$/i.test(baseCommit) ? baseCommit : null },
    backupDir, files, customRules, addedProjects, addedCommands, addedProtectedPaths, configurationCompared, currentChecks, setups,
    archivedChecks, checksDate: validLog ? checksDate : null,
    history: [...history.values()].sort((a, b) => a.date.localeCompare(b.date))
  };
}

