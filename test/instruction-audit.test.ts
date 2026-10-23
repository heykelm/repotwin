import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, it } from 'vitest';
import { auditInstructions } from '../src/analyzer/instruction-audit.js';
import { generateOptimizationRecipe } from '../src/generator/recipe-agents-md.js';
import { applyRecipe } from '../src/generator/apply-recipe.js';

it('rescans actual instruction contents and keeps missing tests as an unresolved finding', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rt-audit-'));
  try {
    const before = auditInstructions(dir, []);
    applyRecipe(dir, generateOptimizationRecipe(dir, [], []));
    const after = auditInstructions(dir, []);
    expect(after.scores.correctedScore).toBeGreaterThan(before.scores.correctedScore);
    expect(after.findings.map(f => f.rule)).toEqual(['missing-test-command']);
    expect(after.testsExecuted).toBe(false);
    fs.writeFileSync(path.join(dir, 'AGENTS.md'), 'broken instructions');
    expect(auditInstructions(dir, []).scores.correctedScore).toBeLessThan(after.scores.correctedScore);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
