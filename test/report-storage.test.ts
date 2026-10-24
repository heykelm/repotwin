import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { prepareReportStorage, writeReportAtomically } from '../src/report/safe-storage.js';
import { collectApplicationGains, generateCertificateHtml, ApplicationSnapshot, saveApplicationSnapshot } from '../src/report/application-snapshot.js';

const directories: string[] = [];
function fixture() { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rt-report-')); directories.push(dir); return dir; }
afterEach(() => directories.splice(0).forEach(dir => fs.rmSync(dir, { recursive: true, force: true })));
it('rejects report aliases pointing outside and preserves the external file', () => {
  const dir = fixture();
  const outside = path.join(fixture(), 'keep.txt');
  fs.writeFileSync(outside, 'private');
  const reports = prepareReportStorage(dir);
  const alias = path.join(reports, 'repotwin-certificate-latest.json');
  fs.symlinkSync(outside, alias);
  expect(() => prepareReportStorage(dir)).toThrow('Unsafe report file');
  expect(() => writeReportAtomically(alias, 'overwrite')).toThrow('Unsafe report file');
  expect(() => saveApplicationSnapshot(dir, {} as ApplicationSnapshot)).toThrow('Unsafe report file');
  expect(fs.readFileSync(outside, 'utf8')).toBe('private');
});
it('rejects report directories pointing outside', () => {
  const dir = fixture();
  const outside = fixture();
  fs.mkdirSync(path.join(dir, '.repotwin'));
  fs.symlinkSync(outside, path.join(dir, '.repotwin', 'reports'));
  expect(() => prepareReportStorage(dir)).toThrow('Unsafe report directory');
  expect(fs.readdirSync(outside)).toEqual([]);
});
it('replaces regular report files with restricted permissions', () => {
  const dir = fixture();
  const target = path.join(prepareReportStorage(dir), 'report.json');
  writeReportAtomically(target, 'first');
  writeReportAtomically(target, 'second');
  expect(fs.readFileSync(target, 'utf8')).toBe('second');
  if (process.platform !== 'win32') expect(fs.statSync(target).mode & 0o777).toBe(0o600);
});
it('does not certify unmeasured AI savings or a perfect score', () => {
  const snapshot: ApplicationSnapshot = {
    id: 'fixture', appliedAt: new Date().toISOString(), appliedAtFormatted: 'now', repoPath: '/fixture', repoName: 'fixture', backupDir: '/backup',
    scores: { before: { score: 55, grade: 'D' }, after: { score: 80, grade: 'B' } },
    findings: { resolvedCount: 1, resolved: [], remainingCount: 2 }, commands: { total: 0, passed: 0, results: [] }, filesApplied: [], diff: ''
  };
  const html = generateCertificateHtml(snapshot);
  expect(html).not.toContain('100/100 A');
  expect(html).not.toContain('0 failed runs');
  expect(html).not.toContain('Architecture 100%');
});

it('reports file-level gains from the actual backup and separates expected benefits from passed checks', () => {
  const dir = fixture();
  const backupDir = path.join(dir, '.repotwin', 'backups', 'before');
  fs.mkdirSync(backupDir, { recursive: true });
  fs.writeFileSync(path.join(backupDir, 'AGENTS.md'), '# Existing instructions\n');
  fs.writeFileSync(path.join(dir, 'AGENTS.md'), '# Existing instructions\n## 🔒 Safety Boundaries\n## 🧪 Verification & Test Commands\nnpm run test\n## 🧩 Shared Components & Contract Stability\n');
  fs.writeFileSync(path.join(dir, 'agent-ready.json'), '{}');
  const snapshot: ApplicationSnapshot = {
    id: 'gain-test', appliedAt: new Date().toISOString(), appliedAtFormatted: 'now', repoPath: dir, repoName: 'shared', backupDir,
    scores: { before: { score: 86, grade: 'B' }, after: { score: 100, grade: 'A' } },
    findings: { resolvedCount: 1, resolved: [], remainingCount: 0 },
    commands: { total: 1, passed: 1, results: [{ id: 'test', project: 'shared', display: 'npm run test', kind: 'test', status: 'passed', durationMs: 10 }] },
    filesApplied: ['AGENTS.md', 'agent-ready.json'], diff: ''
  };
  const gains = collectApplicationGains(snapshot);
  expect(gains.map(gain => gain.title.en)).toEqual([
    'Safer agent instructions', 'Verification commands available', 'Shared library contract documented', 'Machine-readable project configuration'
  ]);
  expect(gains[1].change.en).toContain('1 command(s)');
  expect(gains[1].evidence.en).toContain('1/1 recorded checks passed');
  const html = generateCertificateHtml({ ...snapshot, gains });
  expect(html).toContain('Concrete gains');
  expect(html).toContain('Gains concrets');
  expect(html).toContain('Expected benefit:');
  expect(html).toContain('Bénéfice attendu');
  expect(html).toContain('data-gain-lang="fr"');

  fs.writeFileSync(path.join(backupDir, 'AGENTS.md'), fs.readFileSync(path.join(dir, 'AGENTS.md')));
  fs.writeFileSync(path.join(backupDir, 'agent-ready.json'), '{}');
  expect(collectApplicationGains(snapshot)).toEqual([]);
});
