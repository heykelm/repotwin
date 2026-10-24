import fs from 'node:fs';
import path from 'node:path';
import { RawFinding } from '../types/index.js';

export interface InstructionFile {
  file: string;
  assistant: 'shared' | 'claude' | 'gemini' | 'cursor';
  scope: string;
  bytes: number;
}

const names = new Map<string, InstructionFile['assistant']>([
  ['AGENTS.md', 'shared'], ['AGENTS.override.md', 'shared'],
  ['CLAUDE.md', 'claude'], ['GEMINI.md', 'gemini'], ['.cursorrules', 'cursor']
]);
const excluded = new Set([
  '.git', 'node_modules', 'vendor', 'dist', 'build', 'coverage', 'target',
  '.next', '.venv', '.cache', 'scratch', 'archive', 'fixtures',
  '.dart_tool', 'Pods', '.gradle', '.pub-cache', '.symlinks', '.repotwin',
  '.vercel', '.turbo', '.yarn', '.pnpm-store', 'outputs', 'output'
]);

/** Audits repository instruction files only; never loads user-global configuration. */
export function auditInstructionConsistency(repoPath: string) {
  const root = fs.realpathSync(repoPath);
  const files: InstructionFile[] = [];
  const findings: RawFinding[] = [];
  const contents = new Map<string, string>();
  const notices: string[] = [];
  let visited = 0;
  const inside = (target: string) => target === root || target.startsWith(root + path.sep);
  const add = (file: string, line: number, rule: string, message: string, fix: string) => {
    findings.push({ file, line, severity: 'warning', rule, message, fix });
  };
  const walk = (directory: string, depth: number) => {
    if (++visited > 2500 || depth > 8) {
      if (!notices.includes('Inventory limit reached; some instruction files were not inspected.')) notices.push('Inventory limit reached; some instruction files were not inspected.');
      return;
    }
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)); }
    catch { notices.push(`Cannot inspect ${path.relative(root, directory) || '.'}.`); return; }
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (!excluded.has(entry.name)) walk(absolute, depth + 1);
        continue;
      }
      const relative = path.relative(root, absolute).split(path.sep).join('/');
      const ruleMatch = /(?:^|\/)\.cursor\/rules\/.+\.(?:mdc|md)$/.test(relative);
      const claudeRule = /(?:^|\/)\.claude\/rules\/.+\.md$/.test(relative);
      const assistant = names.get(entry.name) ?? (ruleMatch ? 'cursor' : claudeRule ? 'claude' : undefined);
      if (!entry.isFile() || !assistant) continue;
      try {
        const bytes = fs.statSync(absolute).size;
        if (bytes > 256 * 1024 || files.length >= 200) {
          notices.push(`Skipped ${relative}: instruction size or count limit reached.`);
          continue;
        }
        const marker = ruleMatch ? '/.cursor/' : claudeRule ? '/.claude/' : undefined;
        const padded = '/' + relative;
        const scope = marker ? padded.slice(1, padded.indexOf(marker)) || '.' : path.posix.dirname(relative);
        files.push({ file: relative, assistant, scope, bytes });
        contents.set(relative, fs.readFileSync(absolute, 'utf8'));
      } catch { notices.push(`Cannot read ${relative}.`); }
    }
  };
  walk(root, 0);

  for (const file of files) {
    const lines = contents.get(file.file)!.split(/\r?\n/);
    let fence: string | undefined;
    let shell = false;
    let cwd: string | undefined = path.resolve(root, file.scope);
    for (let index = 0; index < lines.length; index++) {
      const line = lines[index];
      const delimiter = /^\s*(`{3,}|~{3,})(.*)$/.exec(line);
      if (delimiter) {
        if (!fence) {
          fence = delimiter[1][0];
          shell = /^(?:bash|sh|shell|zsh|console)?\s*$/.test(delimiter[2]);
          cwd = path.resolve(root, file.scope);
        } else if (delimiter[1][0] === fence) { fence = undefined; shell = false; }
        continue;
      }
      // Only explicit Markdown links and whole-line imports are path assertions.
      if (!fence) {
        const refs = [...line.matchAll(/\[[^\]]*\]\(([^\s)]+)(?:\s+"[^"]*")?\)/g)].map(m => m[1]);
        const imported = /^\s*@((?:\.?\.?\/)?[\w./-]+\.(?:md|mdc))\s*$/.exec(line);
        if (imported) refs.push(imported[1]);
        for (const ref of refs) {
          if (/^(?:[a-z][\w+.-]*:|\/|#)/i.test(ref) || /[<>*${}]/.test(ref)) continue;
          const local = ref.split('#')[0];
          if (!local) continue;
          const target = path.resolve(root, path.dirname(file.file), local);
          if (!inside(target)) continue;
          let exists = false;
          try { exists = inside(fs.realpathSync(target)); } catch { /* Missing local reference. */ }
          if (!exists) add(file.file, index + 1, 'instruction-missing-reference', `Local instruction reference does not resolve: ${ref}`, 'Correct the relative path or remove the obsolete reference.');
        }
      }
      if (fence && !shell) continue;
      const snippets = fence ? [line.replace(/^\s*\$\s*/, '')] : [...line.matchAll(/`([^`]+)`/g)].map(m => m[1]);
      for (const snippet of snippets) {
        const cd = /^\s*cd\s+(?:'([^']+)'|"([^"]+)"|([\w./-]+))\s*(?:&&\s*(.*))?$/.exec(snippet);
        let command = snippet.trim();
        let commandCwd = fence ? cwd : path.resolve(root, file.scope);
        if (cd) {
          commandCwd = commandCwd ? path.resolve(commandCwd, cd[1] ?? cd[2] ?? cd[3]) : undefined;
          if (fence) cwd = commandCwd;
          command = cd[4] ?? '';
        } else if (/^cd\b/.test(command)) {
          if (fence) cwd = undefined;
          continue;
        }
        // Avoid inferring working directories or evaluating arbitrary shell syntax.
        const run = /^(?:npm\s+run(?:-script)?|pnpm\s+run|yarn\s+run)\s+([\w:.-]+)(?:\s+--(?:\s|$).*)?$/.exec(command);
        if (!run || !commandCwd || !inside(commandCwd)) continue;
        const manifest = path.join(commandCwd, 'package.json');
        try {
          if (!inside(fs.realpathSync(manifest))) continue;
          const pkg = JSON.parse(fs.readFileSync(manifest, 'utf8'));
          if (typeof pkg.scripts?.[run[1]] !== 'string') {
            const available = Object.keys(pkg.scripts ?? {}).filter(key => typeof pkg.scripts[key] === 'string').sort();
            add(file.file, index + 1, 'instruction-missing-script', `Script "${run[1]}" is not declared in ${path.relative(root, manifest).split(path.sep).join('/')}.`, `Check ${path.relative(root, manifest)}. Available scripts: ${available.join(', ') || '(none)'}. Select the intended script before changing this instruction.`);
          }
        } catch { /* An ambiguous or unavailable manifest is not proof of a stale command. */ }
      }
    }
  }
  return { files, findings, notices, scope: 'repository-instruction-references-and-scripts' as const };
}
