import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { afterEach, expect, it } from 'vitest';
import { classifyChecks, compareRevisions, ComparisonPlan, prepareComparison } from '../src/verification/revision-comparison.js';
import { ValidationResult } from '../src/verification/command-runner.js';

const fixtures: string[] = [];
afterEach(() => {
  for (const root of fixtures.splice(0)) {
    const trees = execFileSync('git', ['-C', root, 'worktree', 'list', '--porcelain'], { encoding: 'utf8' });
    for (const line of trees.split('\n')) {
      if (!line.startsWith('worktree ')) continue;
      const target = line.slice(9);
      if (target === root || !path.basename(path.dirname(target)).startsWith('repotwin-compare-')) continue;
      execFileSync('git', ['-C', root, 'worktree', 'remove', '--force', target]);
      fs.rmdirSync(path.dirname(target));
    }
    fs.rmSync(root, { recursive: true, force: true });
  }
});
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rt-comparison-test-'));
  fixtures.push(root);
  const git = (...args: string[]) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: 'pipe' }).trim();
  git('init'); git('config', 'user.email', 'test@example.com'); git('config', 'user.name', 'test');
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'fixture', scripts: { test: 'node check.cjs test', lint: 'node check.cjs lint', build: 'node check.cjs build' } }));
  fs.writeFileSync(path.join(root, 'check.cjs'), "const states = require('./states.json'); process.exit(states[process.argv[2]]);\n");
  fs.writeFileSync(path.join(root, 'states.json'), JSON.stringify({ test: 0, lint: 1, build: 1 }));
  git('add', '.'); git('commit', '-m', 'base');
  fs.writeFileSync(path.join(root, 'states.json'), JSON.stringify({ test: 1, lint: 1, build: 0 }));
  git('add', '.'); git('commit', '-m', 'target');
  return { root, git };
}

it('compares real checks and preserves dirty user work without leaving clean snapshots', async () => {
  const { root, git } = fixture();
  fs.writeFileSync(path.join(root, 'states.json'), 'user changes');
  const progress: string[] = [];
  const plan = prepareComparison(root, 'HEAD~1', 'HEAD');
  expect(plan.baseCommit).not.toBe(plan.targetCommit);
  const report = await compareRevisions(root, plan, { onProgress: (side, event) => progress.push(side + ':' + event.type) });
  expect(report.counts).toMatchObject({ regression: 1, fixed: 1, 'failing-both': 1, 'not-verified': 0 });
  expect(report.verdict).toBe('regressions');
  expect(progress).toContain('before:command_start');
  expect(progress).toContain('after:command_done');
  expect(fs.readFileSync(path.join(root, 'states.json'), 'utf8')).toBe('user changes');
  expect(git('worktree', 'list', '--porcelain').match(/^worktree /gm)).toHaveLength(1);
}, 20000);

it('treats changed definitions, timeouts, missing controls and mutated sources as unverified', () => {
  const command = { id: 'test', project: 'fixture', relPath: '.', kind: 'test' as const, executable: 'npm', args: ['run', 'test'], display: 'npm run test' };
  const result: ValidationResult = { ...command, status: 'passed', exitCode: 0, durationMs: 1, output: '', outputTruncated: false };
  const plan: ComparisonPlan = { baseCommit: 'a', targetCommit: 'b', before: [command], after: [command], definitions: { before: { test: 'a' }, after: { test: 'a' } }, fingerprint: '', warnings: [] };
  expect(classifyChecks(plan, [result], [result])[0].outcome).toBe('passing-both');
  expect(classifyChecks(plan, [result], [{ ...result, status: 'timed-out' }])[0].outcome).toBe('not-verified');
  expect(classifyChecks(plan, [result], [])[0].outcome).toBe('not-verified');
  expect(classifyChecks(plan, [result], [result], false)[0].outcome).toBe('not-verified');
  plan.definitions.after.test = 'different command';
  expect(classifyChecks(plan, [result], [result])[0].outcome).toBe('not-verified');
});

it('rejects option-like revisions and rejects an altered approved plan', async () => {
  const { root } = fixture();
  expect(() => prepareComparison(root, '--help', 'HEAD')).toThrow('Invalid revision');
  const plan = prepareComparison(root, 'HEAD~1', 'HEAD');
  plan.fingerprint = 'tampered';
  await expect(compareRevisions(root, plan)).rejects.toThrow('plan changed');
});

it('reports empty control coverage honestly', async () => {
  const { root, git } = fixture();
  fs.writeFileSync(path.join(root, 'package.json'), '{"name":"empty"}');
  git('add', '.'); git('commit', '-m', 'no checks');
  const report = await compareRevisions(root, prepareComparison(root, 'HEAD', 'HEAD'));
  expect(report.verdict).toBe('incomplete');
  expect(report.checks).toEqual([]);
});

it('preserves source changes made by scripts and invalidates the comparison', async () => {
  const { root, git } = fixture();
  fs.writeFileSync(path.join(root, 'package.json'), '{"name":"mutating","scripts":{"test":"node check.cjs"}}');
  fs.writeFileSync(path.join(root, 'check.cjs'), "require('node:fs').writeFileSync('states.json', '{}');");
  git('add', '.'); git('commit', '-m', 'mutating test');
  const report = await compareRevisions(root, prepareComparison(root, 'HEAD', 'HEAD'));
  expect(report.verdict).toBe('incomplete');
  expect(report.checks[0].outcome).toBe('not-verified');
  expect(report.warnings.some(warning => warning.includes('preserved for inspection'))).toBe(true);
}, 20000);
