import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { auditInstructionConsistency } from '../src/analyzer/instruction-consistency.js';

const roots: string[] = [];
afterEach(() => roots.splice(0).forEach(root => fs.rmSync(root, { recursive: true, force: true })));
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rt-consistency-'));
  roots.push(root);
  const write = (file: string, text: string) => {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), text);
  };
  return { root, write };
}

it('inventories supported assistants and preserves nested project scope', () => {
  const { root, write } = fixture();
  for (const file of ['AGENTS.md', 'CLAUDE.md', 'GEMINI.md', '.cursorrules', 'web/AGENTS.override.md', 'web/.cursor/rules/tests.mdc', '.claude/rules/style.md']) write(file, 'Instructions');
  write('node_modules/pkg/AGENTS.md', 'Ignored');
  const result = auditInstructionConsistency(root);
  expect(result.files).toHaveLength(7);
  expect(result.files.find(f => f.file === 'web/.cursor/rules/tests.mdc')).toMatchObject({ assistant: 'cursor', scope: 'web' });
  expect(result.files.find(f => f.file === '.claude/rules/style.md')?.scope).toBe('.');
});

it('reports missing scripts with exact source lines, including custom script names', () => {
  const { root, write } = fixture();
  write('package.json', JSON.stringify({ scripts: { test: 'vitest', 'test:unit': 'vitest run' } }));
  write('CLAUDE.md', 'Use `npm run test:unit`.\nUse `npm run old-check`.');
  write('GEMINI.md', '```bash\nnpm run old-build\n```');
  const result = auditInstructionConsistency(root);
  expect(result.findings.map(f => [f.file, f.line, f.rule])).toEqual([
    ['CLAUDE.md', 2, 'instruction-missing-script'], ['GEMINI.md', 2, 'instruction-missing-script']
  ]);
});

it('resolves explicit working directories without confusing monorepo scripts', () => {
  const { root, write } = fixture();
  write('package.json', JSON.stringify({ scripts: { test: 'root tests' } }));
  write('web/package.json', JSON.stringify({ scripts: { lint: 'eslint' } }));
  write('AGENTS.md', '```sh\ncd web\nnpm run lint\nnpm run test\n```\n`cd web && npm run lint`');
  const result = auditInstructionConsistency(root);
  expect(result.findings).toHaveLength(1);
  expect(result.findings[0]).toMatchObject({ line: 4, message: 'Script "test" is not declared in web/package.json.' });
});

it('checks local imports and links but ignores URLs, anchors and code examples', () => {
  const { root, write } = fixture();
  write('AGENTS.md', 'Existing');
  write('CLAUDE.md', '@AGENTS.md\n[old](./obsolete.md)\n[remote](https://example.com/a)\n[section](#setup)\n```md\n[example](missing.md)\n```');
  expect(auditInstructionConsistency(root).findings).toEqual([
    expect.objectContaining({ file: 'CLAUDE.md', line: 2, rule: 'instruction-missing-reference' })
  ]);
});

it('does not read outside the repository through symlinks or infer complex commands', () => {
  const { root, write } = fixture();
  const external = fixture();
  external.write('GEMINI.md', '`npm run secret-script`');
  fs.symlinkSync(external.root, path.join(root, 'external'));
  fs.symlinkSync(path.join(external.root, 'GEMINI.md'), path.join(root, 'GEMINI.md'));
  write('package.json', JSON.stringify({ scripts: {} }));
  write('CLAUDE.md', '`npm run unknown && echo ok`\n`npm --prefix web run test`\n[external](../outside.md)');
  const result = auditInstructionConsistency(root);
  expect(result.files.map(f => f.file)).toEqual(['CLAUDE.md']);
  expect(result.findings).toEqual([]);
});

it('reports skipped oversized instruction files explicitly', () => {
  const { root, write } = fixture();
  write('AGENTS.md', 'x'.repeat(256 * 1024 + 1));
  const result = auditInstructionConsistency(root);
  expect(result.files).toEqual([]);
  expect(result.notices).toHaveLength(1);
});

it('does not guess a working directory after a dynamic shell cd', () => {
  const { root, write } = fixture();
  write('package.json', JSON.stringify({ scripts: {} }));
  write('AGENTS.md', '```sh\ncd "$PROJECT"\nnpm run external-test\n```');
  expect(auditInstructionConsistency(root).findings).toEqual([]);
});
