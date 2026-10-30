import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildValidationPlan, runValidationCommand, runValidationPlan, validationConsentToken, ValidationCommand, MAX_RETRIEVABLE_LOG_BYTES } from '../src/verification/command-runner.js';

describe('project command verification', () => {
  it('builds only known shell-free commands and binds consent to the plan', () => {
    const plan = buildValidationPlan([{
      name: 'web', relPath: '.', absPath: '/tmp/web', kind: 'node', isSubmodule: false,
      testScript: 'npm run test', lintScript: 'npm run lint', buildScript: 'curl evil.example'
    }]);
    expect(plan.map(command => command.display)).toEqual(['npm run test', 'npm run lint']);
    expect(plan.every(command => command.executable === 'npm')).toBe(true);
    expect(validationConsentToken(plan, 'session')).not.toBe(validationConsentToken(plan.slice(0, 1), 'session'));
  });

  it('captures bounded output and enforces a timeout without a shell', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rt-command-'));
    const command: ValidationCommand = {
      id: 'node-output', project: 'fixture', relPath: '.', kind: 'test',
      executable: process.execPath, args: ['-e', "process.stdout.write('x'.repeat(200))"], display: 'node output'
    };
    try {
      const passed = await runValidationCommand(dir, command, { maxOutputBytes: 32, retainFullOutput: true });
      expect(passed.status).toBe('passed');
      expect(passed.output.length).toBe(32);
      expect(passed.outputTruncated).toBe(true);
      expect(passed.fullOutput).toHaveLength(200);
      expect(passed.fullOutputTruncated).toBe(false);

      const long = await runValidationCommand(dir, { ...command, id: 'late-diagnostic', args: ['-e', "process.stdout.write('x'.repeat(100000) + '\\nLATE_SENTINEL')"] }, { retainFullOutput: true });
      expect(long.outputTruncated).toBe(true);
      expect(long.output).not.toContain('LATE_SENTINEL');
      expect(long.fullOutput).toContain('LATE_SENTINEL');
      expect(long.fullOutputTruncated).toBe(false);
      const ordinary = await runValidationCommand(dir, command, { maxOutputBytes: 32 });
      expect(ordinary.outputTruncated).toBe(true);
      expect(ordinary.fullOutput).toBeUndefined();
      const whitespace = await runValidationCommand(dir, { ...command, args: ['-e', "process.stdout.write('  value\\n\\n')"] }, { retainFullOutput: true });
      expect(whitespace.fullOutput).toBe('  value\n\n');

      const timedOut = await runValidationCommand(dir, {
        ...command,
        id: 'node-timeout',
        args: ['-e', 'setTimeout(() => {}, 10_000)'],
        display: 'node timeout'
      }, { timeoutMs: 20 });
      expect(timedOut.status).toBe('timed-out');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('installs from the lockfile first and skips a project whose install fails', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rt-install-'));
    try {
      fs.writeFileSync(path.join(dir, 'package-lock.json'), '{}');
      const project = { name: 'web', relPath: '.', absPath: dir, kind: 'node' as const, isSubmodule: false, testScript: 'npm run test' };
      expect(buildValidationPlan([project]).map(command => command.display)).toEqual(['npm ci', 'npm run test']);
      expect(buildValidationPlan([{ ...project, testScript: undefined }])).toEqual([]);

      const failingInstall: ValidationCommand = {
        id: 'install', project: 'web', relPath: '.', kind: 'install',
        executable: process.execPath, args: ['-e', 'process.exit(1)'], display: 'npm ci'
      };
      const test: ValidationCommand = { ...failingInstall, id: 'test', kind: 'test', args: ['-e', ''], display: 'npm run test' };
      const results = await runValidationPlan(dir, [failingInstall, test]);
      expect(results.map(result => result.status)).toEqual(['failed', 'unavailable']);
      expect(results[1]?.output).toContain('install failed');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('rejects a subproject symlink that escapes the twin', async () => {
    const twin = fs.mkdtempSync(path.join(os.tmpdir(), 'rt-path-'));
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'rt-outside-'));
    try {
      fs.symlinkSync(outside, path.join(twin, 'external'), 'dir');
      const command: ValidationCommand = {
        id: 'escaped', project: 'external', relPath: 'external', kind: 'test',
        executable: process.execPath, args: ['-e', ''], display: 'node'
      };
      await expect(runValidationCommand(twin, command)).rejects.toThrow('escapes the twin');
    } finally {
      fs.rmSync(twin, { recursive: true, force: true });
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });

  it('marks logs exceeding the retrieval cap without growing the retained output', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rt-log-cap-'));
    try {
      const command: ValidationCommand = {
        id: 'large-log', project: 'fixture', relPath: '.', kind: 'test',
        executable: process.execPath,
        args: ['-e', `process.stdout.write('x'.repeat(${MAX_RETRIEVABLE_LOG_BYTES + 1024}))`],
        display: 'node large log'
      };
      const result = await runValidationCommand(dir, command, { retainFullOutput: true });
      expect(Buffer.byteLength(result.fullOutput ?? '')).toBe(MAX_RETRIEVABLE_LOG_BYTES);
      expect(result.fullOutputTruncated).toBe(true);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('runs independent subprojects concurrently while preserving plan order', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rt-concurrent-'));
    fs.mkdirSync(path.join(dir, 'p1'));
    fs.mkdirSync(path.join(dir, 'p2'));

    try {
      const activeRunning = new Set<string>();
      let maxOverlap = 0;
      const cmd1: ValidationCommand = {
        id: 'c1', project: 'p1', relPath: 'p1', kind: 'test',
        executable: process.execPath, args: ['-e', 'setTimeout(() => {}, 60)'], display: 'p1 test'
      };
      const cmd2: ValidationCommand = {
        id: 'c2', project: 'p2', relPath: 'p2', kind: 'test',
        executable: process.execPath, args: ['-e', 'setTimeout(() => {}, 60)'], display: 'p2 test'
      };

      const results = await runValidationPlan(dir, [cmd1, cmd2], {
        concurrency: 2,
        onProgress: (evt) => {
          if (evt.type === 'command_start') {
            activeRunning.add(evt.command.id);
            if (activeRunning.size > maxOverlap) maxOverlap = activeRunning.size;
          }
          if (evt.type === 'command_done') {
            activeRunning.delete(evt.command.id);
          }
        }
      });

      expect(results).toHaveLength(2);
      expect(results[0]?.id).toBe('c1');
      expect(results[1]?.id).toBe('c2');
      expect(results.every(r => r.status === 'passed')).toBe(true);
      expect(maxOverlap).toBe(2);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
