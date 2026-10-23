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

  for (const line of lines) {
    const [key, ...valParts] = line.split(':');
    if (!key || valParts.length === 0) continue;

    const k = key.trim();
    const v = valParts.join(':').trim();

    if (k === 'globs') {
      meta.globs = v.split(',').map(g => g.trim()).filter(Boolean);
    } else if (k === 'alwaysApply') {
      meta.alwaysApply = v === 'true';
    } else if (k === 'description') {
      meta.description = v;
    }
  }

  return meta;
}
