import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import { SubprojectInfo } from '../types/index.js';

export type ValidationKind = 'install' | 'test' | 'lint' | 'build';
export type ValidationStatus = 'passed' | 'failed' | 'timed-out' | 'unavailable';

export interface ValidationCommand {
  id: string;
  project: string;
  relPath: string;
  kind: ValidationKind;
  executable: string;
  args: string[];
  display: string;
}

export interface ValidationResult extends ValidationCommand {
  status: ValidationStatus;
  exitCode: number | null;
  durationMs: number;
  output: string;
  outputTruncated: boolean;
}

const ALLOWED_COMMANDS = new Map<string, { executable: string; args: string[] }>([
  ['npm ci', { executable: 'npm', args: ['ci', '--no-audit', '--no-fund'] }],
  ['pnpm install --frozen-lockfile', { executable: 'pnpm', args: ['install', '--frozen-lockfile'] }],
  ['yarn install --frozen-lockfile', { executable: 'yarn', args: ['install', '--frozen-lockfile'] }],
  ['npm run test', { executable: 'npm', args: ['run', 'test'] }],
  ['npm run lint', { executable: 'npm', args: ['run', 'lint'] }],
  ['npm run build', { executable: 'npm', args: ['run', 'build'] }],
  ['flutter test', { executable: 'flutter', args: ['test'] }],
  ['flutter analyze', { executable: 'flutter', args: ['analyze'] }],
  ['pytest', { executable: 'pytest', args: [] }],
  ['cargo test', { executable: 'cargo', args: ['test'] }],
  ['cargo build', { executable: 'cargo', args: ['build'] }],
  ['go test ./...', { executable: 'go', args: ['test', './...'] }],
  ['go build ./...', { executable: 'go', args: ['build', './...'] }]
]);

function addCommand(plan: ValidationCommand[], project: SubprojectInfo, kind: ValidationKind, display?: string): void {
  if (!display) return;
  const allowed = ALLOWED_COMMANDS.get(display);
  if (!allowed) return;
  const fingerprint = `${project.relPath}\0${kind}\0${allowed.executable}\0${allowed.args.join('\0')}`;
  plan.push({
    id: crypto.createHash('sha256').update(fingerprint).digest('hex').slice(0, 16),
    project: project.name,
    relPath: project.relPath,
    kind,
    executable: allowed.executable,
    args: [...allowed.args],
    display
  });
}

/** Reproducible install command, only when a lockfile pins dependencies. */
export function detectInstallCommand(project: SubprojectInfo): string | undefined {
  if (project.kind !== 'node') return undefined;
  const has = (file: string) => fs.existsSync(path.join(project.absPath, file));
  if (has('package-lock.json') || has('npm-shrinkwrap.json')) return 'npm ci';
  if (has('pnpm-lock.yaml')) return 'pnpm install --frozen-lockfile';
  if (has('yarn.lock')) return 'yarn install --frozen-lockfile';
  return undefined;
}

export function buildValidationPlan(projects: SubprojectInfo[]): ValidationCommand[] {
  const plan: ValidationCommand[] = [];
  for (const project of projects) {
    const hasCommands = Boolean(project.testScript || project.lintScript || project.buildScript);
    if (hasCommands) addCommand(plan, project, 'install', detectInstallCommand(project));
    addCommand(plan, project, 'test', project.testScript);
    addCommand(plan, project, 'lint', project.lintScript);
    addCommand(plan, project, 'build', project.buildScript);
  }
  return plan;
}

export function validationConsentToken(commands: ValidationCommand[], sessionToken: string): string {
  const payload = commands.map(command => command.id).join(':');
  return crypto.createHmac('sha256', sessionToken).update(payload).digest('hex');
}

function executionEnvironment(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    USERPROFILE: process.env.USERPROFILE,
    SYSTEMROOT: process.env.SYSTEMROOT,
    TMPDIR: process.env.TMPDIR,
    TEMP: process.env.TEMP,
    TMP: process.env.TMP,
    LANG: process.env.LANG,
    CI: 'true',
    NO_COLOR: '1',
    npm_config_audit: 'false',
    npm_config_fund: 'false'
  };
  return Object.fromEntries(Object.entries(env).filter((entry): entry is [string, string] => typeof entry[1] === 'string'));
}

function assertWorkingDirectory(root: string, relPath: string): string {
  const resolvedRoot = path.resolve(root);
  const cwd = path.resolve(resolvedRoot, relPath);
  const relative = path.relative(resolvedRoot, cwd);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`Validation path escapes the twin: ${relPath}`);
  }
  return cwd;
}

export async function runValidationCommand(
  twinPath: string,
  command: ValidationCommand,
  options: { timeoutMs?: number; maxOutputBytes?: number } = {}
): Promise<ValidationResult> {
  const timeoutMs = options.timeoutMs ?? (command.kind === 'install' ? 600_000 : 120_000);
  const maxOutputBytes = options.maxOutputBytes ?? 64 * 1024;
  const cwd = assertWorkingDirectory(twinPath, command.relPath);
  const startedAt = Date.now();

  return await new Promise(resolve => {
    let output = '';
    let outputBytes = 0;
    let outputTruncated = false;
    let timedOut = false;
    let settled = false;
    const child = spawn(command.executable, command.args, {
      cwd,
      env: executionEnvironment(),
      shell: false,
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe']
    });

    const append = (chunk: Buffer): void => {
      if (outputBytes >= maxOutputBytes) {
        outputTruncated = true;
        return;
      }
      const remaining = maxOutputBytes - outputBytes;
      const kept = chunk.subarray(0, remaining);
      output += kept.toString('utf8');
      outputBytes += kept.length;
      if (kept.length < chunk.length) outputTruncated = true;
    };
    child.stdout.on('data', append);
    child.stderr.on('data', append);

    const finish = (status: ValidationStatus, exitCode: number | null, message?: string): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (message) output += `${output ? '\n' : ''}${message}`;
      resolve({ ...command, status, exitCode, durationMs: Date.now() - startedAt, output: output.trim(), outputTruncated });
    };

    child.once('error', error => finish('unavailable', null, `Unable to start command: ${error.message}`));
    child.once('close', code => finish(timedOut ? 'timed-out' : code === 0 ? 'passed' : 'failed', code));

    const timer = setTimeout(() => {
      timedOut = true;
      if (process.platform !== 'win32' && child.pid) {
        try { process.kill(-child.pid, 'SIGTERM'); } catch { child.kill('SIGTERM'); }
      } else {
        child.kill('SIGTERM');
      }
      setTimeout(() => {
        if (!settled) {
          if (process.platform !== 'win32' && child.pid) {
            try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); }
          } else {
            child.kill('SIGKILL');
          }
        }
      }, 1_000).unref();
    }, timeoutMs);
    timer.unref();
  });
}

export async function runValidationPlan(
  twinPath: string,
  commands: ValidationCommand[],
  options: { timeoutMs?: number; maxOutputBytes?: number } = {}
): Promise<ValidationResult[]> {
  const results: ValidationResult[] = [];
  const failedInstalls = new Set<string>();
  for (const command of commands) {
    if (command.kind !== 'install' && failedInstalls.has(command.relPath)) {
      results.push({ ...command, status: 'unavailable', exitCode: null, durationMs: 0, output: 'Skipped: dependency install failed for this project.', outputTruncated: false });
      continue;
    }
    const result = await runValidationCommand(twinPath, command, options);
    if (command.kind === 'install' && result.status !== 'passed') failedInstalls.add(command.relPath);
    results.push(result);
  }
  return results;
}
