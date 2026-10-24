import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { SubprojectInfo } from '../types/index.js';

const IGNORED_DIRECTORIES = new Set([
  '.git', '.cache', '.idea', '.next', '.turbo', '.venv', 'build', 'coverage',
  'dist', 'node_modules', 'target', 'tmp', '.tmp', 'vendor',
  'scratch', 'archive', 'output', 'outputs', 'fixtures', 'doc', 'docs',
  '.repotwin', '.dart_tool', '.yarn', '.pnpm-store', '.gradle', 'Pods', '.pub-cache', '.symlinks', '.vercel'
]);

/**
 * Discovers all subprojects and submodules in a repository.
 */
export function discoverSubprojects(repoPath: string): SubprojectInfo[] {
  return discoverProjectInventory(repoPath).projects;
}

export function discoverProjectInventory(repoPath: string): { projects: SubprojectInfo[]; notices: string[] } {
  const subprojects: SubprojectInfo[] = [];
  const notices: string[] = [];
  let directories = 0;
  const notice = (message: string) => { if (!notices.includes(message)) notices.push(message); };

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

  const seen = new Set<string>();
  const inspect = (absPath: string, relPath: string): boolean => {
    if (seen.has(relPath)) return false;
    const name = relPath === '.' ? path.basename(repoPath) : path.basename(relPath);
    const isSubmodule = submoduleNames.has(relPath);
    const packagePath = path.join(absPath, 'package.json');

    if (fs.existsSync(packagePath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf-8'));
        subprojects.push({
          name: pkg.name || name,
          relPath,
          absPath,
          kind: 'node',
          isSubmodule,
          testScript: pkg.scripts?.test ? 'npm run test' : undefined,
          buildScript: pkg.scripts?.build ? 'npm run build' : undefined,
          lintScript: pkg.scripts?.lint ? 'npm run lint' : undefined
        });
        seen.add(relPath);
        return true;
      } catch {
        // Continue with other manifest types.
      }
    }

    const knownManifests: Array<[string, SubprojectInfo['kind'], string | undefined, string | undefined, string | undefined]> = [
      ['pubspec.yaml', 'flutter', 'flutter test', undefined, 'flutter analyze'],
      ['pyproject.toml', 'python', 'pytest', undefined, undefined],
      ['Cargo.toml', 'rust', 'cargo test', 'cargo build', undefined],
      ['go.mod', 'go', 'go test ./...', 'go build ./...', undefined]
    ];
    for (const [manifest, kind, testScript, buildScript, lintScript] of knownManifests) {
      if (fs.existsSync(path.join(absPath, manifest))) {
        subprojects.push({ name, relPath, absPath, kind, isSubmodule, testScript, buildScript, lintScript });
        seen.add(relPath);
        return true;
      }
    }

    if (isSubmodule) {
      subprojects.push({ name, relPath, absPath, kind: 'unknown', isSubmodule });
      seen.add(relPath);
      return true;
    }

    return false;
  };

  const walk = (currentPath: string, relPath: string, depth: number): void => {
    if (++directories > 2500 || subprojects.length >= 200) {
      notice('Project discovery limit reached; some directories were not inspected.');
      return;
    }
    inspect(currentPath, relPath);

    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(currentPath, { withFileTypes: true });
    } catch {
      notice(`Cannot inspect project directory: ${relPath}`);
      return;
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.isSymbolicLink() || IGNORED_DIRECTORIES.has(entry.name)) continue;
      if (depth >= 8) {
        notice('Project discovery depth limit reached; some directories were not inspected.');
        continue;
      }
      const nextRelPath = relPath === '.' ? entry.name : path.join(relPath, entry.name);
      walk(path.join(currentPath, entry.name), nextRelPath, depth + 1);
    }
  };

  walk(repoPath, '.', 0);

  return { projects: subprojects, notices };
}

/**
 * Builds a fast lookup index of all tracked files in the repository
 * including files in submodules.
 */
export function buildFileIndex(repoPath: string, subprojects: SubprojectInfo[]): Set<string> {
  const fileSet = new Set<string>();

  let files: string[] = [];
  try {
    const trackedWithSubmodules = execFileSync('git', ['-C', repoPath, 'ls-files', '--cached', '--recurse-submodules'], {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 128 * 1024 * 1024,
    }).split('\n').filter(Boolean);
    files.push(...trackedWithSubmodules);

    const untracked = execFileSync('git', ['-C', repoPath, 'ls-files', '--others', '--exclude-standard'], {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 128 * 1024 * 1024,
    }).split('\n').filter(Boolean);
    files.push(...untracked);
  } catch {
    // A non-Git directory can still be inspected, but only within conservative bounds.
    const walk = (currentDir: string, relative = '', depth = 0): void => {
      if (depth > 8) return;
      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(currentDir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        if (IGNORED_DIRECTORIES.has(entry.name) || entry.isSymbolicLink()) continue;
        const next = relative ? `${relative}/${entry.name}` : entry.name;
        if (entry.isDirectory()) walk(path.join(currentDir, entry.name), next, depth + 1);
        else files.push(next);
      }
    };
    walk(repoPath);
  }

  for (const file of files) {
    fileSet.add(file);
    const segments = file.split('/');
    for (let index = 1; index < segments.length; index++) {
      const directory = segments.slice(0, index).join('/');
      fileSet.add(directory);
      fileSet.add(`${directory}/`);
    }
  }

  return fileSet;
}

/**
 * Builds a conservative schema index from tracked SQL migrations. A table is
 * recognized only when it is explicitly declared in a migration file.
 */
export function discoverKnownTables(repoPath: string, fileSet: Set<string>): Set<string> {
  const tables = new Set<string>();
  for (const file of fileSet) {
    if (!file.endsWith('.sql') || file.endsWith('/')) continue;
    const absolutePath = path.join(repoPath, file);
    let content: string;
    try {
      const stat = fs.statSync(absolutePath);
      if (stat.size > 1_000_000) continue;
      content = fs.readFileSync(absolutePath, 'utf-8');
    } catch {
      continue;
    }
    const matches = content.matchAll(/\b(?:create|alter)\s+table\s+(?:if\s+not\s+exists\s+)?(?:["`]?public["`]?\.)?["`]?([a-zA-Z_][a-zA-Z0-9_]*)["`]?/gi);
    for (const match of matches) {
      if (match[1]) tables.add(match[1].toLowerCase());
    }
  }
  return tables;
}
