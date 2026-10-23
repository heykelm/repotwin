import fs from 'node:fs';
import path from 'node:path';
import { RuleMeta } from '../types/index.js';

/**
 * Scans and parses Cursor rules (.cursor/rules/*.mdc) and AGENTS / CLAUDE instructions.
 */
export function scanRules(repoPath: string): Map<string, RuleMeta> {
  const rules = new Map<string, RuleMeta>();

  const cursorRulesDir = path.join(repoPath, '.cursor', 'rules');
  if (fs.existsSync(cursorRulesDir)) {
    const files = fs.readdirSync(cursorRulesDir);
    for (const file of files) {
      if (!file.endsWith('.mdc') && !file.endsWith('.md')) continue;

      const fullPath = path.join(cursorRulesDir, file);
      const content = fs.readFileSync(fullPath, 'utf-8');
      const relFile = `.cursor/rules/${file}`;

      const meta = parseRuleFrontmatter(relFile, content);
      rules.set(relFile, meta);
    }
  }

  return rules;
}

function parseRuleFrontmatter(file: string, content: string): RuleMeta {
  const meta: RuleMeta = { file };

  // Frontmatter check: starts with ---
  if (!content.startsWith('---')) {
    return meta;
  }

  const endIdx = content.indexOf('---', 3);
  if (endIdx === -1) return meta;

  const yamlBlock = content.substring(3, endIdx);
  const lines = yamlBlock.split('\n');

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index] ?? '';
    const [key, ...valParts] = line.split(':');
    if (!key || valParts.length === 0) continue;

    const k = key.trim();
    const v = valParts.join(':').trim();

    if (k === 'globs') {
      if (v) {
        meta.globs = parseGlobValue(v);
      } else {
        const globs: string[] = [];
        while (index + 1 < lines.length && /^\s*-\s+/.test(lines[index + 1] ?? '')) {
          index++;
          globs.push(unquote((lines[index] ?? '').replace(/^\s*-\s+/, '').trim()));
        }
        meta.globs = globs;
      }
    } else if (k === 'alwaysApply') {
      meta.alwaysApply = v.replace(/\s+#.*$/, '') === 'true';
    } else if (k === 'description') {
      meta.description = unquote(v);
    }
  }

  return meta;
}

function parseGlobValue(value: string): string[] {
  const normalized = value.trim();
  if (normalized.startsWith('[') && normalized.endsWith(']')) {
    try {
      const parsed = JSON.parse(normalized);
      if (Array.isArray(parsed) && parsed.every(item => typeof item === 'string')) return parsed;
    } catch {
      // Fall back to a comma-separated list below.
    }
  }
  return normalized.split(',').map(glob => unquote(glob.trim())).filter(Boolean);
}

function unquote(value: string): string {
  return value.replace(/^['"]|['"]$/g, '');
}
