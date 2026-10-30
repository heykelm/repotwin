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
  /** Session-scoped raw output for paginated MCP retrieval (bounded separately from output). */
  fullOutput?: string;
  fullOutputTruncated?: boolean;
}

export const MAX_RETRIEVABLE_LOG_BYTES = 8 * 1024 * 1024;

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
  const resolvedRoot = fs.realpathSync(root);
  const cwd = fs.realpathSync(path.resolve(resolvedRoot, relPath));
  const relative = path.relative(resolvedRoot, cwd);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`Validation path escapes the twin: ${relPath}`);
  }
  return cwd;
}

export async function runValidationCommand(
  twinPath: string,
  command: ValidationCommand,
  options: { timeoutMs?: number; maxOutputBytes?: number; retainFullOutput?: boolean } = {}
): Promise<ValidationResult> {
  const timeoutMs = options.timeoutMs ?? (command.kind === 'install' ? 600_000 : 120_000);
  const maxOutputBytes = options.maxOutputBytes ?? 64 * 1024;
  const cwd = assertWorkingDirectory(twinPath, command.relPath);
  const startedAt = Date.now();

  return await new Promise(resolve => {
    let output = '';
    let outputBytes = 0;
    let outputTruncated = false;
    const logChunks: Buffer[] = [];
    let logBytes = 0;
    let fullOutputTruncated = false;
    let timedOut = false;
    let settled = false;
    const isWin = process.platform === 'win32';
    const executable = isWin && ['npm', 'pnpm', 'yarn', 'npx'].includes(command.executable)
      ? `${command.executable}.cmd`
      : command.executable;
    const child = spawn(executable, command.args, {
      cwd,
      env: executionEnvironment(),
      shell: false,
      detached: !isWin,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    const append = (chunk: Buffer): void => {
      if (options.retainFullOutput) {
        const logRemaining = MAX_RETRIEVABLE_LOG_BYTES - logBytes;
        if (logRemaining > 0) {
          const keptLog = chunk.subarray(0, logRemaining);
          logChunks.push(keptLog);
          logBytes += keptLog.length;
        }
        if (chunk.length > logRemaining) fullOutputTruncated = true;
      }
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
      const fullOutput = options.retainFullOutput
        ? Buffer.concat(logChunks).toString('utf8') + (message ? `${logBytes ? '\n' : ''}${message}` : '')
        : undefined;
      resolve({ ...command, status, exitCode, durationMs: Date.now() - startedAt, output: output.trim(), outputTruncated, fullOutput, fullOutputTruncated: options.retainFullOutput ? fullOutputTruncated : undefined });
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

export interface ValidationProgressEvent {
  type: 'command_start' | 'command_done';
  index: number;
  total: number;
  command: ValidationCommand;
  result?: ValidationResult;
}

export async function runValidationPlan(
  twinPath: string,
  commands: ValidationCommand[],
  options: {
    timeoutMs?: number;
    maxOutputBytes?: number;
    retainFullOutput?: boolean;
    concurrency?: number;
    onProgress?: (event: ValidationProgressEvent) => void;
  } = {}
): Promise<ValidationResult[]> {
  if (commands.length === 0) return [];

  const results: ValidationResult[] = new Array(commands.length);

  // Group commands by subproject directory (relPath).
  // Inside each subproject, commands must run sequentially (install -> test -> lint -> build).
  // Distinct subprojects run concurrently up to the concurrency limit.
  interface IndexedCommand {
    command: ValidationCommand;
    index: number;
  }
  const groups = new Map<string, IndexedCommand[]>();
  for (let index = 0; index < commands.length; index++) {
    const command = commands[index];
    const list = groups.get(command.relPath) || [];
    list.push({ command, index });
    groups.set(command.relPath, list);
  }

  const defaultConcurrency = process.env.REPOTWIN_CONCURRENCY
    ? parseInt(process.env.REPOTWIN_CONCURRENCY, 10) || 3
    : 3;
  const concurrencyLimit = Math.max(1, options.concurrency ?? defaultConcurrency);

  const groupQueue = Array.from(groups.values());
  let nextGroupIdx = 0;

  async function runGroupWorker(): Promise<void> {
    while (nextGroupIdx < groupQueue.length) {
      const currentGroup = groupQueue[nextGroupIdx++];
      let installFailed = false;

      for (const { command, index } of currentGroup) {
        if (command.kind !== 'install' && installFailed) {
          const skipped: ValidationResult = {
            ...command,
            status: 'unavailable',
            exitCode: null,
            durationMs: 0,
            output: 'Skipped: dependency install failed for this project.',
            outputTruncated: false
          };
          results[index] = skipped;
          options.onProgress?.({
            type: 'command_done',
            index,
            total: commands.length,
            command,
            result: skipped
          });
          continue;
        }

        options.onProgress?.({
          type: 'command_start',
          index,
          total: commands.length,
          command
        });

        const result = await runValidationCommand(twinPath, command, options);
        if (command.kind === 'install' && result.status !== 'passed') {
          installFailed = true;
        }

        results[index] = result;
        options.onProgress?.({
          type: 'command_done',
          index,
          total: commands.length,
          command,
          result
        });
      }
    }
  }

  const workerCount = Math.min(concurrencyLimit, groupQueue.length);
  await Promise.all(Array.from({ length: workerCount }, () => runGroupWorker()));
  return results;
}
