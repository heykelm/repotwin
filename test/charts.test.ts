import { describe, it, expect } from 'vitest';
import {
  renderTokenComparisonChart,
  renderExecutionTimeChart,
  renderSuccessRateChart,
  renderNavigationEfficiencyChart,
  renderVariabilityChart,
  renderEvolutionChart
} from '../src/report/charts.js';
import { generateHtmlReport } from '../src/report/html-generator.js';
import { compareVariants } from '../src/metrics/comparator.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

describe('Reporting Visual Charts (Complément RFC-002)', () => {
  it('renders Chart 1: Token Consumption with numbers and reduction percentage', () => {
    const html = renderTokenComparisonChart(30000, 14000, 0.533);
    expect(html).toContain('30,000');
    expect(html).toContain('14,000');
    expect(html).toContain('53.3%');
    expect(html).toContain('rect');
  });

  it('handles missing token metrics by displaying N/A without inventing numbers', () => {
    const html = renderTokenComparisonChart(undefined, undefined);
    expect(html).toContain('N/A');
    expect(html).toContain('Données de tokens non disponibles');
  });

  it('renders Chart 2: Execution Time with seconds difference', () => {
    const html = renderExecutionTimeChart(14200, 4100);
    expect(html).toContain('14.20s');
    expect(html).toContain('4.10s');
    expect(html).toContain('10.10s');
  });

  it('renders Chart 3: Success Rate with regression guard styling', () => {
    const passHtml = renderSuccessRateChart(1.0, 1.0, 2, 2);
    expect(passHtml).toContain('100%');
    expect(passHtml).toContain('AUCUNE RÉGRESSION');

    const regHtml = renderSuccessRateChart(1.0, 0.5, 2, 2);
    expect(regHtml).toContain('RÉGRESSION DÉTECTÉE');
  });

  it('renders Chart 4: Context & Navigation Efficiency with tool calls and files', () => {
    const html = renderNavigationEfficiencyChart(22, 8, 12, 4);
    expect(html).toContain('22');
    expect(html).toContain('8');
    expect(html).toContain('12');
    expect(html).toContain('4');
  });

  it('renders Chart 5: Benchmark Variability across trial runs', () => {
    const html = renderVariabilityChart([30000, 32000, 29000], [14000, 15000, 13500]);
    expect(html).toContain('3 Essais');
    expect(html).toContain('circle');
    expect(html).toContain('path');
  });

  it('renders Chart 6: Repository Evolution or N/A when history is insufficient', () => {
    const naHtml = renderEvolutionChart([]);
    expect(naHtml).toContain('Pas assez d’analyses');

    const evolHtml = renderEvolutionChart([
      { date: '2026-10-20', score: 65 },
      { date: '2026-10-25', score: 92 }
    ]);
    expect(evolHtml).toContain('2 analyses');
    expect(evolHtml).toContain('65%');
    expect(evolHtml).toContain('92%');
  });

  it('does not label an aggregate comparison without source traces as measured effectiveness', () => {
    const tmp = path.join(os.tmpdir(), `repotwin-charts-test-${Date.now()}.html`);

    const comparison = compareVariants('exp-test', [
      {
        schemaVersion: '1', runId: 'r1', taskId: 't1', repositoryFingerprint: 'fp', commitSha: 'sha', variant: 'baseline',
        agentName: 'mock', modelId: 'mock-v1', adapterVersion: '1.0', startedAt: new Date().toISOString(), status: 'success',
        tokens: { total: 30000, source: 'provider' }, toolCalls: 20, durationMs: 12000, filesRead: ['f1.ts', 'f2.ts'],
        validation: { commands: ['npm test'], passed: true }, traceCompleteness: 'complete', artifacts: {}
      }
    ], [
      {
        schemaVersion: '1', runId: 'r2', taskId: 't1', repositoryFingerprint: 'fp', commitSha: 'sha', variant: 'candidate',
        agentName: 'mock', modelId: 'mock-v1', adapterVersion: '1.0', startedAt: new Date().toISOString(), status: 'success',
        tokens: { total: 14000, source: 'provider' }, toolCalls: 8, durationMs: 4000, filesRead: ['f1.ts'],
        validation: { commands: ['npm test'], passed: true }, traceCompleteness: 'complete', artifacts: {}
      }
    ]);

    generateHtmlReport({
      repoPath: process.cwd(),
      syncRootReport: false,
      scores: { rawScore: 80, rawGrade: 'B', correctedScore: 90, correctedGrade: 'A', projectedScore: 95, projectedGrade: 'A', falsePenaltyRestored: 10, remainingPenalties: 5 },
      subprojects: [],
      falsePositives: [],
      trueIssues: [],
      proposedFixes: [],
      newAgentsMd: '# rules',
      benchmarkComparison: comparison
    }, tmp);

    const content = fs.readFileSync(tmp, 'utf-8');
    expect(content).toContain('résultats agrégés');
    expect(content).not.toContain('Efficience Mesurée des Agents IA');
    expect(content).not.toContain('30,000');
    expect(content).toContain('Non mesuré');

    fs.rmSync(tmp, { force: true });
  });
});
