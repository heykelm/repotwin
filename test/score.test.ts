import { describe, expect, it } from 'vitest';
import { calculateScores } from '../src/diagnostics/score.js';
import { ProcessedFinding } from '../src/types/index.js';

function finding(rule: string, isFalsePositive: boolean): ProcessedFinding {
  return {
    raw: { severity: 'warning', rule, message: rule, file: '', fix: '' },
    classification: isFalsePositive ? 'EXISTS_ROOT' : 'GENUINE_STALE_PATH',
    isFalsePositive,
    confidence: 1,
    explanation: ''
  };
}

describe('score calculation', () => {
  it('distinguishes missing evaluation from an explicitly empty report', () => {
    expect(calculateScores([]).evaluated).toBe(false);
    expect(calculateScores([], true).evaluated).toBe(true);
  });
  it('keeps unknown findings in the projection', () => {
    const score = calculateScores([finding('unrecognized-defect', false)]);
    expect(score.projectedScore).toBe(score.correctedScore);
  });
  it('derives scores from actual findings without a fixed projection', () => {
    const result = calculateScores([
      finding('stale-path-reference', false),
      finding('missing-test-command', false),
      finding('stale-path-reference', true)
    ]);

    expect(result.rawScore).toBe(70);
    expect(result.correctedScore).toBe(75);
    // 96 baseline minus 5 for the unresolvable genuine stale path = 91
    expect(result.projectedScore).toBe(75);
    expect(result.falsePenaltyRestored).toBe(5);
  });
});
