import fs from 'node:fs';
import path from 'node:path';
import { SubprojectInfo } from '../types/index.js';

/**
 * Discovers all subprojects and submodules in a repository.
 */
export function discoverSubprojects(repoPath: string): SubprojectInfo[] {
  const subprojects: SubprojectInfo[] = [];

  // 1. Check .gitmodules
  const gitmodulesPath = path.join(repoPath, '.gitmodules');
  const submoduleNames = new Set<string>();

  if (fs.existsSync(gitmodulesPath)) {
    const gitmodulesContent = fs.readFileSync(gitmodulesPath, 'utf-8');
    const pathMatches = gitmodulesContent.matchAll(/path\s*=\s*(.+)/g);
    for (const match of pathMatches) {
      if (match[1]) {
        submoduleNames.add(match[1].trim());
      }
    }
  }

  // 2. Discover root entries and subdirectories (depth 1 to 2)
  const entries = fs.readdirSync(repoPath, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (['.git', 'node_modules', '.cache', 'dist', 'build', '.idea'].includes(entry.name)) continue;

    const relPath = entry.name;
    const absPath = path.join(repoPath, relPath);
    const isSubmodule = submoduleNames.has(relPath);

    // Check for package.json
    const pkgPath = path.join(absPath, 'package.json');
    if (fs.existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
        subprojects.push({
          name: pkg.name || entry.name,
          relPath,
          absPath,
          kind: 'node',
          isSubmodule,
          testScript: pkg.scripts?.test,
          buildScript: pkg.scripts?.build,
          lintScript: pkg.scripts?.lint
        });
        continue;
      } catch {
        // fallback
      }
    }

    // Check for pubspec.yaml (Flutter / Dart)
    const pubspecPath = path.join(absPath, 'pubspec.yaml');
    if (fs.existsSync(pubspecPath)) {
      subprojects.push({
        name: entry.name,
        relPath,
        absPath,
        kind: 'flutter',
        isSubmodule,
        testScript: 'flutter test',
        buildScript: 'flutter build'
      });
      continue;
    }

    // If it's a known submodule without explicit config found yet
    if (isSubmodule) {
      subprojects.push({
        name: entry.name,
        relPath,
        absPath,
        kind: 'unknown',
        isSubmodule
      });
    }
  }

  return subprojects;
}

/**
 * Builds a fast lookup index of all tracked files in the repository
 * including files in submodules.
 */
export function buildFileIndex(repoPath: string, subprojects: SubprojectInfo[]): Set<string> {
  const fileSet = new Set<string>();

  function walk(currentDir: string, relBase = '') {
    if (!fs.existsSync(currentDir)) return;
    const entries = fs.readdirSync(currentDir, { withFileTypes: true });

    for (const entry of entries) {
      if (['.git', 'node_modules', '.cache', 'dist', 'build', '.tmp', 'tmp'].includes(entry.name)) continue;

      const relPath = relBase ? `${relBase}/${entry.name}` : entry.name;
      const fullPath = path.join(currentDir, entry.name);

      if (entry.isDirectory()) {
        fileSet.add(relPath);
        fileSet.add(`${relPath}/`);
        walk(fullPath, relPath);
      } else {
        fileSet.add(relPath);
      }
    }
  }

  // Walk root
  walk(repoPath);

  return fileSet;
}
