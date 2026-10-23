import { ProcessedFinding } from '../types/index.js';

export interface ScoreBreakdown {
  rawScore: number;
  rawGrade: string;
  correctedScore: number;
  correctedGrade: string;
  projectedScore: number;
  projectedGrade: string;
  falsePenaltyRestored: number;
  remainingPenalties: number;
}

function gradeFromScore(score: number): string {
  if (score >= 90) return 'A';
  if (score >= 80) return 'B';
  if (score >= 65) return 'C';
  if (score >= 50) return 'D';
  return 'F';
}

/**
 * Renders an ASCII / Unicode progress bar for scores.
 */
export function renderProgressBar(score: number, total = 100, width = 12): string {
  const filledCount = Math.round((Math.max(0, Math.min(score, total)) / total) * width);
  const emptyCount = width - filledCount;
  return `[${'█'.repeat(filledCount)}${'░'.repeat(emptyCount)}]`;
}

/**
 * Calculates raw, corrected (excluding false positives), and projected (post-twin) readiness scores.
 */
export function calculateScores(
  findings: ProcessedFinding[]
): ScoreBreakdown {
  const penaltyFor = (finding: ProcessedFinding): number => {
    switch (finding.raw.rule) {
      case 'stale-path-reference': return 5;
      case 'missing-test-command': return 20;
      case 'missing-lint-command': return 10;
      case 'missing-safety-section':
      case 'missing-verification-section': return 2;
      case 'drift-prone-agent-doc': return 1;
      default:
        return finding.raw.severity === 'error' ? 10 : finding.raw.severity === 'warning' ? 5 : 1;
    }
  };

  const rawPenalties = findings.reduce((total, finding) => total + penaltyFor(finding), 0);
  const correctedPenalties = findings
    .filter(finding => !finding.isFalsePositive)
    .reduce((total, finding) => total + penaltyFor(finding), 0);
  const rawScore = Math.max(0, 100 - rawPenalties);
  const correctedScore = Math.max(0, 100 - correctedPenalties);
  const falsePenaltyRestored = rawScore === 0
    ? Math.min(rawPenalties - correctedPenalties, 100)
    : correctedScore - rawScore;

  // RepoTwin does not promise a score before the user reviews and applies a diff.
  const projectedScore = correctedScore;

  return {
    rawScore,
    rawGrade: gradeFromScore(rawScore),
    correctedScore: Math.round(correctedScore),
    correctedGrade: gradeFromScore(correctedScore),
    projectedScore,
    projectedGrade: gradeFromScore(projectedScore),
    falsePenaltyRestored,
    remainingPenalties: correctedPenalties
  };
}
