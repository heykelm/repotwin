import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { auditTokenEfficiency } from '../src/analysis/token-efficiency.js';

const dirs: string[] = [];
function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rt-token-eff-'));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('Token Efficiency Audit', () => {
  it('gives high score to lean repositories with concise instructions', () => {
    const dir = fixture();
    fs.writeFileSync(path.join(dir, 'AGENTS.md'), '# Concise Agent Instructions\nRun tests before commit.\n');
    fs.writeFileSync(path.join(dir, 'index.ts'), 'export const hello = () => "world";\n');

    const audit = auditTokenEfficiency(dir, [
      {
        name: 'root',
        relPath: '.',
        absPath: dir,
        kind: 'node',
        testScript: 'npm test --silent'
      }
    ]);

    expect(audit.score).toBeGreaterThanOrEqual(90);
    expect(audit.grade).toBe('A');
    expect(audit.instructionsStatus).toBe('optimal');
    expect(audit.totalInstructionTokens).toBeLessThan(100);
    expect(audit.contextHogs).toHaveLength(0);
  });

  it('detects context hogs (files > 500 lines) and applies proportional penalty', () => {
    const dir = fixture();
    fs.writeFileSync(path.join(dir, 'AGENTS.md'), '# Instructions\n');
    
    // Create a 700-line monolithic file
    const largeContent = Array.from({ length: 700 }, (_, i) => `export function fn${i}() { return ${i}; }`).join('\n');
    fs.writeFileSync(path.join(dir, 'MonolithService.ts'), largeContent);

    const audit = auditTokenEfficiency(dir, []);

    expect(audit.contextHogs.length).toBe(1);
    expect(audit.contextHogs[0].path).toBe('MonolithService.ts');
    expect(audit.contextHogs[0].lines).toBe(700);
    expect(audit.score).toBeLessThan(100);
    expect(audit.recommendations.some(r => r.includes('large source file'))).toBe(true);
  });

  it('detects verbose test commands and warns developer', () => {
    const dir = fixture();
    const audit = auditTokenEfficiency(dir, [
      {
        name: 'web',
        relPath: 'web',
        absPath: path.join(dir, 'web'),
        kind: 'node',
        testScript: 'vitest run' // verbose, lacks --silent
      }
    ]);

    const verboseEntry = audit.commandVerbosity.find(c => c.subproject === 'web');
    expect(verboseEntry).toBeDefined();
    expect(verboseEntry?.isVerbose).toBe(true);
    expect(verboseEntry?.recommendation).toContain('RepoTwin');
  });
});

