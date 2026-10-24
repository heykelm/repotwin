import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { prepareReportStorage, writeReportAtomically } from '../src/report/safe-storage.js';
import { generateCertificateHtml, ApplicationSnapshot, saveApplicationSnapshot } from '../src/report/application-snapshot.js';

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
