import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { generateHtmlReport } from '../src/report/html-generator.js';

const files: string[] = [];

afterEach(() => {
  for (const file of files.splice(0)) fs.rmSync(file, { force: true });
});

describe('HTML report generation', () => {
  it('escapes content originating from an imported report', () => {
    const target = path.join(os.tmpdir(), `repotwin-html-${Date.now()}.html`);
    files.push(target);
    generateHtmlReport({
      repoPath: '/tmp/<script>alert(1)</script>',
      scores: {
        rawScore: 90, rawGrade: 'A', correctedScore: 95, correctedGrade: 'A',
        projectedScore: 95, projectedGrade: 'A', falsePenaltyRestored: 5, remainingPenalties: 5
      },
      subprojects: [],
      falsePositives: [{
        raw: { severity: 'warning', rule: 'x', message: '<img src=x onerror=alert(1)>', file: '', fix: '' },
        classification: 'EXISTS_ROOT', isFalsePositive: true, confidence: 1,
        explanation: '<script>alert(1)</script>'
      }],
      trueIssues: [],
      proposedFixes: ['<script>alert(1)</script>'],
      newAgentsMd: '# safe'
    }, target);

    const html = fs.readFileSync(target, 'utf-8');
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  });
});
