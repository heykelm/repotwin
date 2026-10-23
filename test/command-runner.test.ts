import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildValidationPlan, runValidationCommand, runValidationPlan, validationConsentToken, ValidationCommand } from '../src/verification/command-runner.js';

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
      const passed = await runValidationCommand(dir, command, { maxOutputBytes: 32 });
      expect(passed.status).toBe('passed');
      expect(passed.output.length).toBe(32);
      expect(passed.outputTruncated).toBe(true);

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
});
