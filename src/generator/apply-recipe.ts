import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { GeneratedRecipe } from './recipe-agents-md.js';

export function applyRecipe(repoPath: string, recipe: GeneratedRecipe): string {
  const root = fs.realpathSync(repoPath);
  const entries = [['AGENTS.md', recipe.agentsMdContent], ['agent-ready.json', recipe.agentReadyJsonContent]];
  const assertRegular = (target: string, directory = false) => {
    if (!fs.existsSync(target) && !fs.lstatSync(target, { throwIfNoEntry: false })) return;
    const stat = fs.lstatSync(target);
    if (stat.isSymbolicLink() || (directory ? !stat.isDirectory() : !stat.isFile())) {
      throw new Error(`Unsafe file or directory: ${target}`);
    }
  };
  for (const [name] of entries) assertRegular(path.join(root, name));
  for (const name of ['.repotwin', '.repotwin/backups']) assertRegular(path.join(root, name), true);
  const backupDir = path.join(root, '.repotwin', 'backups', crypto.randomUUID());
  fs.mkdirSync(backupDir, { recursive: true, mode: 0o700 });
  const originals = entries.map(([name]) => {
    const target = path.join(root, name);
    const original = fs.existsSync(target) ? fs.readFileSync(target) : undefined;
    if (original) fs.writeFileSync(path.join(backupDir, name), original, { mode: 0o600, flag: 'wx' });
    return { target, original };
  });
  const replace = (target: string, content: string | Buffer) => {
    const temporary = path.join(root, `.repotwin-${crypto.randomUUID()}.tmp`);
    try {
      fs.writeFileSync(temporary, content, { mode: 0o600, flag: 'wx' });
      fs.renameSync(temporary, target);
    } finally {
      fs.rmSync(temporary, { force: true });
    }
  };
  try {
    entries.forEach(([name, content]) => replace(path.join(root, name), content));
  } catch (error) {
    for (const { target, original } of originals) {
      if (original) replace(target, original);
      else fs.rmSync(target, { force: true });
    }
    throw error;
  }
  return backupDir;
}

export function rollbackBackup(repoPath: string, backupId?: string): { backupId: string; filesRestored: string[] } {
  const root = fs.realpathSync(repoPath);
  const backupsBase = path.join(root, '.repotwin', 'backups');
  if (!fs.existsSync(backupsBase)) {
    throw new Error('No backups directory found. Nothing to rollback.');
  }

  const entries = fs.readdirSync(backupsBase, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => ({
      name: d.name,
      path: path.join(backupsBase, d.name),
      mtime: fs.statSync(path.join(backupsBase, d.name)).mtimeMs
    }))
    .sort((a, b) => b.mtime - a.mtime);

  if (entries.length === 0) {
    throw new Error('No previous backups found to rollback.');
  }

  const targetBackup = backupId
    ? entries.find(e => e.name === backupId)
    : entries[0];

  if (!targetBackup) {
    throw new Error(`Backup "${backupId}" not found.`);
  }

  const backupFiles = fs.readdirSync(targetBackup.path, { withFileTypes: true })
    .filter(f => f.isFile());

  const filesRestored: string[] = [];
  for (const file of backupFiles) {
    const src = path.join(targetBackup.path, file.name);
    const dest = path.join(root, file.name);
    const content = fs.readFileSync(src);
    const temporary = path.join(root, `.repotwin-rollback-${crypto.randomUUID()}.tmp`);
    fs.writeFileSync(temporary, content, { mode: 0o600 });
    fs.renameSync(temporary, dest);
    filesRestored.push(file.name);
  }

  return { backupId: targetBackup.name, filesRestored };
}

