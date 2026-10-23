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
