import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { generateOptimizationRecipe } from '../src/generator/recipe-agents-md.js';
import { applyRecipe } from '../src/generator/apply-recipe.js';
import { discoverSubprojects } from '../src/analyzer/subproject-scanner.js';

const dirs: string[] = [];
function fixture() { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rt-recipe-')); dirs.push(dir); return dir; }
afterEach(() => { dirs.splice(0).forEach(dir => fs.rmSync(dir, { recursive: true, force: true })); });

it('preserves directives and configuration and generates an identical recipe on rerun', () => {
  const dir = fixture();
  fs.writeFileSync(path.join(dir, 'AGENTS.md'), '# Existing directives\nDo not deploy.\n');
  fs.writeFileSync(path.join(dir, 'agent-ready.json'), JSON.stringify({ custom: { preserve: true } }));
  const first = generateOptimizationRecipe(dir, [], []);
  applyRecipe(dir, first);
  const second = generateOptimizationRecipe(dir, [], []);
  expect(second.agentsMdContent).toBe(first.agentsMdContent);
  expect(second.agentReadyJsonContent).toBe(first.agentReadyJsonContent);
  expect(JSON.parse(second.agentReadyJsonContent).custom).toEqual({ preserve: true });
  expect(first.agentReadyJsonContent).not.toContain('cd backend');
});

it('rejects symlink targets before writing either file', () => {
  const dir = fixture();
  const outside = path.join(fixture(), 'external');
  fs.writeFileSync(outside, 'private');
  fs.symlinkSync(outside, path.join(dir, 'agent-ready.json'));
  expect(() => applyRecipe(dir, { agentsMdContent: 'new', agentReadyJsonContent: '{}', summaryChanges: [] })).toThrow('Unsafe');
  expect(fs.readFileSync(outside, 'utf8')).toBe('private');
  expect(fs.existsSync(path.join(dir, 'AGENTS.md'))).toBe(false);
});

it('retains ordinary projects alongside declared submodules', () => {
  const dir = fixture();
  fs.writeFileSync(path.join(dir, '.gitmodules'), '[submodule "library"]\n path = library\n');
  fs.writeFileSync(path.join(dir, 'package.json'), '{"name":"root"}');
  for (const name of ['app', 'library']) {
    fs.mkdirSync(path.join(dir, name));
    fs.writeFileSync(path.join(dir, name, 'package.json'), JSON.stringify({ name }));
  }
  expect(discoverSubprojects(dir).map(project => project.relPath).sort()).toEqual(['.', 'app', 'library']);
});

it('refreshes managed configuration while preserving custom values and safety paths', () => {
  const dir = fixture();
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'current', scripts: { test: 'node check.cjs' } }));
  fs.writeFileSync(path.join(dir, 'agent-ready.json'), JSON.stringify({
    custom: { keep: true }, projects: [{ name: 'removed', path: 'deleted' }],
    verification: { deleted: ['npm run nonexistent'] }, safety: { custom: true, protectedPaths: ['private/'] }
  }));
  const recipe = generateOptimizationRecipe(dir, discoverSubprojects(dir), []);
  const config = JSON.parse(recipe.agentReadyJsonContent);
  expect(config.projects).toEqual([expect.objectContaining({ name: 'current', path: '.' })]);
  expect(config.verification).toEqual({ '.': ["cd '.' && npm run test"] });
  expect(config.custom).toEqual({ keep: true });
  expect(config.safety.protectedPaths).toContain('private/');
  expect(config.safety.protectedPaths).toContain('*.key');
  expect(config.safety.custom).toBe(true);
});

it('discovers nested projects even below a package boundary', () => {
  const dir = fixture();
  for (const relative of ['domains/payments', 'domains/payments/api']) {
    fs.mkdirSync(path.join(dir, relative), { recursive: true });
    fs.writeFileSync(path.join(dir, relative, 'package.json'), JSON.stringify({ name: relative }));
  }
  expect(discoverSubprojects(dir).map(project => project.relPath)).toEqual(['domains/payments', 'domains/payments/api']);
});
