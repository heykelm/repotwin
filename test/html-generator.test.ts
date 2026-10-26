import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { generateHtmlReport, type HtmlReportOptions } from '../src/report/html-generator.js';
import type { AgentRun } from '../src/types/contracts.js';
import { REPOTWIN_VERSION } from '../src/version.js';

const directories: string[] = [];
afterEach(() => { for (const dir of directories.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'repotwin-report-'));
  directories.push(root);
  const reports = path.join(root, '.repotwin', 'reports');
  const backup = path.join(root, '.repotwin', 'backups', 'selected');
  fs.mkdirSync(reports, { recursive: true });
  fs.mkdirSync(backup, { recursive: true });
  return { root, reports, backup };
}
function options(root: string): HtmlReportOptions {
  return {
    repoPath: root, syncRootReport: false, timeZone: 'Europe/Paris',
    scores: { evaluated: false, rawScore: 100, rawGrade: 'A', correctedScore: 100, correctedGrade: 'A', projectedScore: 100, projectedGrade: 'A', falsePenaltyRestored: 0, remainingPenalties: 0 },
    subprojects: [{ name: 'app', relPath: '.', absPath: root, kind: 'node', isSubmodule: false, testScript: 'npm test' }],
    falsePositives: [], trueIssues: [], proposedFixes: [], newAgentsMd: '# instructions'
  };
}
function report(input: HtmlReportOptions): string {
  const target = path.join(input.repoPath, 'review.html');
  generateHtmlReport(input, target);
  return fs.readFileSync(target, 'utf8');
}
function run(variant: 'baseline' | 'candidate', simulated = false): AgentRun {
  return {
    schemaVersion: '1', runId: variant + '-1', taskId: 'same-task', repositoryFingerprint: 'fp',
    commitSha: 'abc1234', variant, agentName: simulated ? 'mock-agent' : 'real-agent', modelId: 'model-1',
    adapterVersion: '1', startedAt: '2026-10-24T01:20:19Z', status: 'success',
    tokens: { total: variant === 'baseline' ? 30000 : 14000, source: 'provider' },
    durationMs: variant === 'baseline' ? 12000 : 4000,
    validation: { commands: ['npm test'], passed: true }, traceCompleteness: 'complete', artifacts: {}
  };
}
describe('HTML report evidence and readability', () => {
  it('does not turn unexecuted commands or a legacy score into proof', () => {
    const { root, reports } = fixture();
    fs.writeFileSync(path.join(reports, 'repotwin-certificate-latest.json'), JSON.stringify({
      scores: { after: { score: 100, grade: 'A' } },
      tokenEconomy: { totalOriginalTokens: 100, totalOptimizedTokens: 75 },
      commands: { total: 2, passed: 2, results: [
        { project: 'app', kind: 'test', display: 'npm test', status: 'passed', durationMs: 0 },
        { project: 'app', kind: 'install', display: 'npm ci', status: 'passed', durationMs: 0 }
      ] }
    }));
    const html = report(options(root));
    expect(html).toContain('Aucune exécution documentée');
    expect(html).toContain('DÉCLARÉE');
    expect(html).toContain('Comparaison indisponible');
    expect(html).not.toContain('Grade A');
    expect(html).not.toContain('−25');
    expect(html).not.toContain('0.00 s');
    expect(html).not.toContain('Score du rapport d’analyse importé');
    expect(html).not.toContain('repotwin rollback');
  });
  it('shows archived results with their date without a mixed success ratio', () => {
    const { root, reports } = fixture();
    fs.writeFileSync(path.join(reports, 'mcp-checks-report.json'), JSON.stringify({
      repoPath: root, timestamp: '2026-10-24T01:20:19Z',
      passedCommands: [{ project: 'app', kind: 'test', command: 'npm test', durationMs: 3047 }]
    }));
    const html = report(options(root));
    expect(html).toContain('RÉUSSI (ARCHIVE)');
    expect(html).toContain('24 oct. 2026');
    expect(html).toContain('3,05 s');
    expect(html).toContain('Aucun contrôle actuel n’a été exécuté');
    expect(html).toContain('ne prouve pas que la version actuelle passe');
    expect(html).not.toMatch(/>100\s?%</);
  });
  it('compares real backup files and verifies custom instructions rather than their presence', () => {
    const { root, reports, backup } = fixture();
    const tail = '\n\n# Custom rules\nKeep the shared contract.\n';
    fs.writeFileSync(path.join(backup, 'AGENTS.md'), '<!-- repotwin:start -->\nold\n<!-- repotwin:end -->' + tail);
    fs.writeFileSync(path.join(root, 'AGENTS.md'), '<!-- repotwin:start -->\nnew\n<!-- repotwin:end -->' + tail);
    fs.writeFileSync(path.join(backup, 'agent-ready.json'), JSON.stringify({ projects: [{ path: '.' }], verification: {} }));
    fs.writeFileSync(path.join(root, 'agent-ready.json'), JSON.stringify({
      projects: [{ path: '.' }, { path: 'frontend' }], verification: { frontend: ['npm run lint'] }
    }));
    fs.writeFileSync(path.join(reports, 'repotwin-certificate-latest.json'), JSON.stringify({ backupDir: backup }));
    const html = report(options(root));
    expect(html).toContain('Texte strictement identique');
    expect(html).toContain('Voir les changements de AGENTS.md');
    expect(html).toContain('class="added">+ new');
    expect(html).toContain('class="removed">− old');
    expect(html).toContain('Chemins ajoutés à la configuration');
    expect(html).toContain('<code>frontend</code>');
    expect(html).toContain('2</strong>');
    expect(html).toContain('Ce que ces changements peuvent apporter');
    expect(html).toContain('Le poids des consignes devient visible');
    expect(html).not.toContain('data-scenario');
    expect(html).not.toContain('Explorer un scénario');
    expect(html).not.toContain('Explore a scenario');
    expect(html).toContain('repotwin rollback');
    expect(html).toContain('--backup &#039;selected&#039;');
    expect(html).toContain('Ce chargement n’a pas été vérifié');
    fs.appendFileSync(path.join(root, 'AGENTS.md'), 'A changed custom rule.');
    const changed = report(options(root));
    expect(changed).toContain('Le texte personnalisé a changé');
    expect(changed).not.toContain('Texte strictement identique');
  });
  it('excludes simulated data even when an old mock trace claims provider token counts', () => {
    const { root } = fixture();
    const html = report({ ...options(root), runs: [run('baseline', true), run('candidate', true)] });
    expect(html).toContain('Simulation détectée');
    expect(html).toContain('compteurs sont prédéfinis');
    expect(html).not.toContain('Tokens moyens par tâche réussie');
    expect(html).not.toContain('30,000');
    expect(html).not.toContain('Efficience Mesurée');
  });
  it('uses supplied real traces and hides token comparisons when provider usage is missing', () => {
    const { root } = fixture();
    const baseline = run('baseline'), candidate = run('candidate');
    const html = report({ ...options(root), runs: [baseline, candidate] });
    expect(html).toContain('Tokens moyens par tâche réussie');
    expect(html).toContain('30,000');
    expect(html).toContain('14,000');
    expect(html).toContain('attribution');
    const estimated = report({ ...options(root), runs: [{ ...baseline, tokens: { total: 999999, source: 'estimate' } }, candidate] });
    expect(estimated).not.toContain('999,999');
  });
  it('escapes supplied text and produces both language versions without external rendering dependencies', () => {
    const { root } = fixture();
    const html = report({ ...options(root), proposedFixes: ['<script>alert(1)</script>'], newAgentsMd: '<img src=x onerror=alert(1)>' });
    expect(html).toContain('v' + REPOTWIN_VERSION);
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).toContain('data-language="fr"');
    expect(html).toContain('data-language="en"');
    expect(html).toContain('What changed in the files');
    expect(html).not.toContain('cdn.tailwindcss.com');
  });
});

