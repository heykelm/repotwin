import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export function ensureSafeDirectory(root: string, relative: string): string {
  let current = fs.realpathSync(root);
  for (const segment of relative.split('/')) {
    if (!segment || segment === '.' || segment === '..') throw new Error('Invalid report directory');
    current = path.join(current, segment);
    const stat = fs.lstatSync(current, { throwIfNoEntry: false });
    if (stat && (stat.isSymbolicLink() || !stat.isDirectory())) throw new Error(`Unsafe report directory: ${current}`);
    if (!stat) fs.mkdirSync(current, { mode: 0o700 });
  }
  return current;
}

export function assertSafeReportFile(target: string): void {
  const stat = fs.lstatSync(target, { throwIfNoEntry: false });
  if (stat && (stat.isSymbolicLink() || !stat.isFile() || stat.nlink > 1)) throw new Error(`Unsafe report file: ${target}`);
}

export function writeReportAtomically(target: string, content: string): void {
  assertSafeReportFile(target);
  const temporary = path.join(path.dirname(target), `.repotwin-${crypto.randomUUID()}.tmp`);
  try {
    fs.writeFileSync(temporary, content, { mode: 0o600, flag: 'wx' });
    assertSafeReportFile(target);
    fs.renameSync(temporary, target);
  } finally {
    fs.rmSync(temporary, { force: true });
  }
}

export function prepareReportStorage(repo: string): string {
  const directory = ensureSafeDirectory(repo, '.repotwin/reports');
  for (const name of ['repotwin-certificate-latest.json', 'repotwin-certificate-latest.html']) assertSafeReportFile(path.join(directory, name));
  return directory;
}
