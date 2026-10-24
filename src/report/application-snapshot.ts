import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { ensureSafeDirectory, prepareReportStorage, assertSafeReportFile, writeReportAtomically } from './safe-storage.js';

export interface ApplicationGain {
  title: { en: string; fr: string };
  change: { en: string; fr: string };
  benefit: { en: string; fr: string };
  evidence: { en: string; fr: string };
}

export interface ApplicationSnapshot {
  id: string;
  appliedAt: string;
  appliedAtFormatted: string;
  repoPath: string;
  repoName: string;
  backupDir: string;
  baseCommit?: string;
  sourceFingerprint?: string;
  scores: {
    before: { score: number; grade: string };
    after: { score: number; grade: string };
  };
  findings: {
    resolvedCount: number;
    resolved: Array<{ message: string; classification?: string }>;
    remainingCount: number;
  };
  commands: {
    total: number;
    passed: number;
    results: Array<{
      id: string;
      project: string;
      display: string;
      kind: string;
      status: string;
      durationMs: number;
    }>;
  };
  tokenEconomy?: {
    measurement?: 'instruction-size-estimate';
    usageMeasured?: boolean;
    selectedTools?: string[];
    tokensSavedPerQuery?: number;
    totalTokensSaved?: number;
    percentSaved?: number;
    totalOriginalTokens?: number;
    totalOptimizedTokens?: number;
    estimatedQueriesPerMonth?: number;
    monthlySavedTokens?: number;
    yearlySavedTokens?: number;
    monthlySavingsUsd?: number;
    yearlySavingsUsd?: number;
  };
  filesApplied: string[];
  diff: string;
  gains?: ApplicationGain[];
}

function readRegularText(filePath: string): string | null {
  try {
    return fs.lstatSync(filePath).isFile() ? fs.readFileSync(filePath, 'utf-8') : null;
  } catch {
    return null;
  }
}

export function collectApplicationGains(snapshot: ApplicationSnapshot): ApplicationGain[] {
  const originalAgents = readRegularText(path.join(snapshot.backupDir, 'AGENTS.md')) ?? '';
  const appliedAgents = snapshot.filesApplied.includes('AGENTS.md')
    ? readRegularText(path.join(snapshot.repoPath, 'AGENTS.md')) ?? '' : originalAgents;
  const originalConfig = readRegularText(path.join(snapshot.backupDir, 'agent-ready.json'));
  const appliedConfig = snapshot.filesApplied.includes('agent-ready.json')
    ? readRegularText(path.join(snapshot.repoPath, 'agent-ready.json')) : originalConfig;
  const gains: ApplicationGain[] = [];
  const added = (fragment: string) => !originalAgents.includes(fragment) && appliedAgents.includes(fragment);

  if (added('## 🔒 Safety Boundaries')) gains.push({
    title: { en: 'Safer agent instructions', fr: 'Consignes de sécurité explicites' },
    change: { en: 'Secret handling, destructive commands and production isolation are now documented.', fr: 'La gestion des secrets, les commandes destructives et l’isolement de la production sont désormais documentés.' },
    benefit: { en: 'Expected benefit: agents have clear limits before acting on this repository.', fr: 'Bénéfice attendu : les agents disposent de limites claires avant d’agir sur ce dépôt.' },
    evidence: { en: 'Observed in the applied AGENTS.md safety section.', fr: 'Constaté dans la section sécurité du fichier AGENTS.md appliqué.' }
  });

  if (added('## 🧪 Verification & Test Commands')) {
    const documented = snapshot.commands.results
      .filter(command => appliedAgents.includes(command.display) && !originalAgents.includes(command.display));
    const passed = snapshot.commands.results.filter(command => command.status === 'passed').length;
    gains.push({
      title: { en: 'Verification commands available', fr: 'Commandes de vérification disponibles' },
      change: { en: `${documented.length} command(s) newly documented for agents.`, fr: `${documented.length} commande(s) nouvellement documentée(s) pour les agents.` },
      benefit: { en: 'Expected benefit: the next agent can find the project checks without searching package scripts.', fr: 'Bénéfice attendu : le prochain agent peut trouver les contrôles du projet sans chercher dans les scripts.' },
      evidence: { en: `${passed}/${snapshot.commands.total} recorded checks passed; documentation is in AGENTS.md.`, fr: `${passed}/${snapshot.commands.total} contrôles enregistrés ont réussi ; commandes dans AGENTS.md.` }
    });
  }

  if (added('## 🧩 Shared Components & Contract Stability')) gains.push({
    title: { en: 'Shared library contract documented', fr: 'Contrat de la bibliothèque partagée documenté' },
    change: { en: 'The instructions now call out compatibility of exported interfaces and consumers.', fr: 'Les consignes rappellent la compatibilité des exports et des projets consommateurs.' },
    benefit: { en: 'Expected benefit: agents can consider downstream compatibility when editing this library.', fr: 'Bénéfice attendu : les agents peuvent tenir compte des projets consommateurs lors des modifications.' },
    evidence: { en: 'Observed in the applied AGENTS.md shared-components section.', fr: 'Constaté dans la section composants partagés du fichier AGENTS.md appliqué.' }
  });

  if (appliedConfig !== null && appliedConfig !== originalConfig) gains.push({
    title: { en: 'Machine-readable project configuration', fr: 'Configuration de projet lisible par les outils' },
    change: { en: originalConfig === null ? 'agent-ready.json was created.' : 'agent-ready.json was updated.', fr: originalConfig === null ? 'Le fichier agent-ready.json a été créé.' : 'Le fichier agent-ready.json a été mis à jour.' },
    benefit: { en: 'Expected benefit: compatible tools can discover project commands and protected paths.', fr: 'Bénéfice attendu : les outils compatibles peuvent repérer les commandes et les chemins protégés.' },
    evidence: { en: 'Observed in the applied agent-ready.json file.', fr: 'Constaté dans le fichier agent-ready.json appliqué.' }
  });

  return gains;
}

export function generateCertificateHtml(snapshot: ApplicationSnapshot, initialLang: 'en' | 'fr' = 'en'): string {
  const scoreDiff = snapshot.scores.after.score - snapshot.scores.before.score;
  const scoreDiffText = scoreDiff >= 0 ? `+${scoreDiff}` : `${scoreDiff}`;

  const commandsHtml = snapshot.commands.results.map(cmd => `
    <tr class="border-b border-gray-800/60 hover:bg-gray-800/30 transition text-xs font-mono">
      <td class="py-2.5 px-4 text-white font-semibold flex items-center gap-2">
        <span class="inline-block w-2 h-2 rounded-full ${cmd.status === 'passed' ? 'bg-emerald-400' : 'bg-rose-500'}"></span>
        ${escapeHtml(cmd.project)}
      </td>
      <td class="py-2.5 px-4 text-indigo-300 font-bold uppercase tracking-wider text-[11px]">${escapeHtml(cmd.kind)}</td>
      <td class="py-2.5 px-4 text-emerald-300 font-medium">${escapeHtml(cmd.display)}</td>
      <td class="py-2.5 px-4 text-right text-gray-400">${(cmd.durationMs / 1000).toFixed(2)} s</td>
      <td class="py-2.5 px-4 text-right">
        <span class="px-2 py-0.5 rounded text-[11px] font-bold ${cmd.status === 'passed' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-rose-500/10 text-rose-400 border border-rose-500/20'}">
          ${cmd.status === 'passed' ? '<span data-i18n="status_passed">PASSED</span>' : escapeHtml(cmd.status)}
        </span>
      </td>
    </tr>
  `).join('');

  const resolvedHtml = snapshot.findings.resolved.length > 0
    ? snapshot.findings.resolved.map(r => `
      <div class="p-3 bg-gray-900/60 border border-gray-800 rounded-xl flex items-start gap-3 text-xs">
        <span class="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 shrink-0">
          <span data-i18n="badge_resolved">RESOLVED</span>
        </span>
        <div class="text-gray-200">${escapeHtml(r.message)}</div>
      </div>
    `).join('')
    : '<p class="text-xs text-gray-500 italic" data-i18n="no_findings">No prior anomalies.</p>';

  const localizedGain = (value: { en: string; fr: string }, className: string) =>
    `<span class="${className}${initialLang === 'fr' ? ' hidden' : ''}" data-gain-lang="en">${escapeHtml(value.en)}</span>` +
    `<span class="${className}${initialLang === 'en' ? ' hidden' : ''}" data-gain-lang="fr">${escapeHtml(value.fr)}</span>`;
  const gainsHtml = snapshot.gains?.length
    ? snapshot.gains.map(gain => `
      <article class="border-t border-gray-800 py-4 first:border-t-0 first:pt-0 last:pb-0">
        <h3 class="text-sm font-semibold text-white mb-2">${localizedGain(gain.title, '')}</h3>
        <p class="text-sm text-gray-200">${localizedGain(gain.change, '')}</p>
        <p class="text-xs text-gray-400 mt-1">${localizedGain(gain.benefit, '')}</p>
        <p class="text-xs text-emerald-300 mt-2">${localizedGain(gain.evidence, '')}</p>
      </article>
    `).join('')
    : `<p class="text-sm text-gray-400" data-i18n="gains_empty">No file-level gain recorded for this application.</p>`;

  const origTokens = snapshot.tokenEconomy?.totalOriginalTokens;
  const optTokens = snapshot.tokenEconomy?.totalOptimizedTokens;
  const formatTokens = (value: number | undefined) =>
    value !== undefined && Number.isFinite(value) && value >= 0
      ? `~${value.toLocaleString('en-US')}`
      : '<span data-i18n="not_recorded">Not recorded</span>';
  const verificationKey = snapshot.commands.total === 0
    ? 'verification_not_run'
    : snapshot.commands.results.length === snapshot.commands.total && snapshot.commands.results.every(cmd => cmd.status === 'passed') && snapshot.commands.passed === snapshot.commands.total
      ? 'verification_passed'
      : 'verification_incomplete';
  const verificationLabels = {
    en: { verification_not_run: 'No commands recorded', verification_passed: 'All recorded commands passed', verification_incomplete: 'Failed or incomplete checks' },
    fr: { verification_not_run: 'Aucune commande enregistrée', verification_passed: 'Toutes les commandes enregistrées ont réussi', verification_incomplete: 'Contrôles échoués ou incomplets' }
  };
  const verificationHtml = `<span data-i18n="${verificationKey}">${verificationLabels[initialLang][verificationKey]}</span>`;

  const tokensSectionHtml = `
    <!-- Recorded instruction sizes and findings -->
    <section class="bg-gradient-to-br from-indigo-950/30 via-gray-900/40 to-background border border-indigo-500/30 rounded-2xl p-6">
      <div class="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 mb-5">
        <div>
          <div class="flex items-center gap-2">
            <span class="text-lg">🛡️</span>
            <h2 class="text-base font-bold text-white tracking-tight" data-i18n="roi_title">Instructions and measured results</h2>
            <span class="text-[11px] font-mono px-2.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-bold uppercase">
              <span data-i18n="recorded_metrics">Recorded metrics</span>
            </span>
          </div>
          <p class="text-xs text-gray-300 mt-1" data-i18n="measurement_limits">
            Sizes are token estimates, not measured API usage. No monthly savings or guarantees of security or AI behavior.
          </p>
        </div>
        <div class="text-xs font-mono text-emerald-300 bg-emerald-950/60 px-3 py-1.5 rounded-lg border border-emerald-500/30 shrink-0">
          ${verificationHtml}
        </div>
      </div>

      <!-- 4 Technical Metric Cards -->
      <div class="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div class="bg-gray-900/60 border border-gray-800 rounded-xl p-4">
          <div class="text-[11px] font-semibold text-gray-400 uppercase tracking-wider" data-i18n="instructions_before">Instructions before</div>
          <div class="text-2xl font-bold text-indigo-300 mt-1.5 font-mono">
            ${formatTokens(origTokens)}
          </div>
          <div class="text-[11px] text-gray-400 mt-2" data-i18n="estimated_tokens">
            Estimated tokens
          </div>
        </div>

        <div class="bg-gray-900/60 border border-gray-800 rounded-xl p-4">
          <div class="text-[11px] font-semibold text-gray-400 uppercase tracking-wider" data-i18n="instructions_after">Instructions after</div>
          <div class="text-2xl font-bold text-emerald-400 mt-1.5 font-mono">
            ${formatTokens(optTokens)}
          </div>
          <div class="text-[11px] text-gray-500 mt-2" data-i18n="estimated_tokens">
            Estimated tokens
          </div>
        </div>

        <div class="bg-gray-900/60 border border-gray-800 rounded-xl p-4">
          <div class="text-[11px] font-semibold text-gray-400 uppercase tracking-wider" data-i18n="controls_passed_title">Recorded Checks</div>
          <div class="text-2xl font-bold text-emerald-300 mt-1.5 font-mono">
            ${snapshot.commands.passed}/${snapshot.commands.total} <span class="text-xs text-gray-400 font-normal" data-i18n="passed_suffix">passed</span>
          </div>
          <div class="text-[11px] text-gray-500 mt-2">
            ${verificationHtml}
          </div>
        </div>

        <div class="bg-gray-900/60 border border-emerald-500/30 bg-emerald-950/20 rounded-xl p-4">
          <div class="text-[11px] font-semibold text-emerald-300 uppercase tracking-wider" data-i18n="remaining_findings">Remaining findings</div>
          <div class="text-2xl font-bold text-white mt-1.5 font-mono">
            ${snapshot.findings.remainingCount}
          </div>
          <div class="text-[11px] text-emerald-400 mt-2 font-medium" data-i18n="findings_scope">
            Findings-based score; not a security certification
          </div>
        </div>
      </div>
    </section>
  `;

  return `<!DOCTYPE html>
<html lang="${initialLang}" class="dark">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>RepoTwin Certificate — ${escapeHtml(snapshot.repoName)}</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@300;400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet">
  <style>
    body { font-family: 'Plus Jakarta Sans', sans-serif; }
    code, pre { font-family: 'JetBrains Mono', monospace; }
  </style>
</head>
<body class="bg-gray-950 text-gray-100 min-h-screen py-10 px-4 sm:px-6 lg:px-8 antialiased selection:bg-emerald-500 selection:text-white">

  <div class="max-w-5xl mx-auto space-y-8">
    
    <!-- Top Header -->
    <header class="pb-6 border-b border-gray-800/80 space-y-4">
      <div class="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div>
          <div class="flex items-center gap-3">
            <div class="h-11 w-11 rounded-xl bg-gradient-to-tr from-emerald-500 to-indigo-500 flex items-center justify-center font-extrabold text-white shadow-lg shadow-emerald-500/20 text-base">
              RT
            </div>
            <div>
              <div class="flex items-center gap-2">
                <h1 class="text-2xl font-bold text-white tracking-tight" data-i18n="cert_title">Application Report</h1>
                <span class="text-[11px] font-mono px-2.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-bold uppercase" data-i18n="cert_official">
                  Recorded snapshot
                </span>
              </div>
              <p class="text-xs text-gray-400 mt-0.5" data-i18n="cert_subtitle">Recorded findings, instruction sizes and command results generated by RepoTwin</p>
            </div>
          </div>
        </div>
        <div class="flex flex-col sm:items-end gap-2">
          <!-- Bilingual Language Switcher -->
          <div class="flex items-center gap-1 rounded-lg border border-gray-800 bg-gray-900/90 p-1 text-xs font-mono">
            <button id="btn-en" type="button" onclick="setCertLang('en')" class="px-2.5 py-1 rounded transition-all font-semibold bg-emerald-600 text-white shadow-sm">EN</button>
            <button id="btn-fr" type="button" onclick="setCertLang('fr')" class="px-2.5 py-1 rounded transition-all text-gray-400 hover:text-white">FR</button>
          </div>
          <div class="text-xs font-mono text-gray-300 font-semibold">${escapeHtml(snapshot.appliedAtFormatted)}</div>
          <div class="text-[11px] font-mono text-emerald-400">${verificationHtml}</div>
        </div>
      </div>

      <!-- Project Highlight Banner -->
      <div class="flex flex-wrap items-center justify-between gap-3 p-4 rounded-xl bg-gray-900/80 border border-gray-800">
        <div class="flex items-center gap-3">
          <span class="text-xs uppercase font-mono font-bold tracking-wider text-gray-400" data-i18n="audited_project">Audited project:</span>
          <span class="text-xl font-extrabold text-white font-mono bg-emerald-500/15 text-emerald-300 px-3.5 py-1 rounded-lg border border-emerald-500/30 flex items-center gap-2">
            <span>📦</span> ${escapeHtml(snapshot.repoName)}
          </span>
          ${snapshot.baseCommit ? `<span class="hidden sm:inline text-xs font-mono text-gray-400 bg-gray-950 px-2.5 py-1 rounded border border-gray-800">Commit: ${escapeHtml(snapshot.baseCommit.slice(0, 8))}</span>` : ''}
        </div>
        <div class="text-xs font-mono text-gray-400 truncate max-w-md">
          ${escapeHtml(snapshot.repoPath)}
        </div>
      </div>
    </header>

    <!-- Key Metrics Cards -->
    <section class="grid grid-cols-1 md:grid-cols-4 gap-4">
      
      <!-- Score Evolution -->
      <div class="bg-gray-900/60 border border-emerald-500/30 p-5 rounded-2xl relative overflow-hidden backdrop-blur">
        <div class="text-[11px] font-semibold uppercase tracking-wider text-emerald-400 mb-1" data-i18n="score_health_title">Findings Score</div>
        <div class="flex items-baseline gap-2 mt-2">
          <span class="text-4xl font-extrabold text-white tracking-tight">${snapshot.scores.after.score}</span>
          <span class="text-gray-500 text-xs">/ 100</span>
          <span class="px-2 py-0.5 text-xs rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-bold ml-auto">${escapeHtml(snapshot.scores.after.grade)}</span>
        </div>
        <div class="text-xs text-emerald-400/90 font-medium mt-3 flex items-center gap-1.5">
          ${scoreDiffText} pts (<span data-i18n="score_initially">initially</span> ${snapshot.scores.before.score}/100 · ${escapeHtml(snapshot.scores.before.grade)})
        </div>
      </div>

      <!-- Resolved Issues -->
      <div class="bg-gray-900/60 border border-indigo-500/30 p-5 rounded-2xl relative overflow-hidden backdrop-blur">
        <div class="text-[11px] font-semibold uppercase tracking-wider text-indigo-400 mb-1" data-i18n="findings_resolved_title">Resolved Findings</div>
        <div class="flex items-baseline gap-2 mt-2">
          <span class="text-4xl font-extrabold text-white tracking-tight">${snapshot.findings.resolvedCount}</span>
          <span class="text-gray-500 text-xs" data-i18n="findings_count_suffix">resolved</span>
        </div>
        <div class="text-xs text-indigo-400/90 font-medium mt-3">
          ${snapshot.findings.remainingCount} <span data-i18n="remaining_findings">Remaining findings</span>
        </div>
      </div>

      <!-- Controls Passed -->
      <div class="bg-gray-900/60 border border-gray-800 p-5 rounded-2xl relative overflow-hidden backdrop-blur">
        <div class="text-[11px] font-semibold uppercase tracking-wider text-gray-400 mb-1" data-i18n="controls_passed_title">Validated Checks</div>
        <div class="flex items-baseline gap-2 mt-2">
          <span class="text-4xl font-extrabold text-emerald-400 tracking-tight">${snapshot.commands.passed}</span>
          <span class="text-gray-500 text-xs">/ ${snapshot.commands.total} <span data-i18n="passed_suffix">passed</span></span>
        </div>
        <div class="text-xs text-gray-400 mt-3">
          ${verificationHtml}
        </div>
      </div>

      <!-- Backup Directory -->
      <div class="bg-gray-900/60 border border-gray-800 p-5 rounded-2xl relative overflow-hidden backdrop-blur">
        <div class="text-[11px] font-semibold uppercase tracking-wider text-gray-400 mb-1" data-i18n="local_backup_title">Local Backup</div>
        <div class="text-xs font-mono text-emerald-300 break-all mt-2">
          ${escapeHtml(snapshot.backupDir.split('/').slice(-2).join('/'))}
        </div>
        <div class="text-[11px] text-gray-500 mt-3 truncate" data-i18n="restore_anytime">
          Restoration available at any time
        </div>
      </div>

    </section>

    <!-- Actual file changes and expected benefits -->
    <section class="border-t border-gray-800 pt-6">
      <h2 class="text-base font-bold text-white mb-1" data-i18n="gains_title">Concrete gains</h2>
      <p class="text-xs text-gray-400 mb-4" data-i18n="gains_subtitle">Changes are compared with the backed-up files. Expected benefits are not measured outcomes.</p>
      <div>${gainsHtml}</div>
    </section>

    <!-- Token Economy Section -->
    ${tokensSectionHtml}

    <!-- Validation Commands Table -->
    <section class="bg-gray-900/40 border border-gray-800/80 rounded-2xl p-6">
      <div class="flex items-center justify-between mb-4">
        <h2 class="text-base font-bold text-white flex items-center gap-2">
          <span>✓</span> <span data-i18n="table_title">Application Checks Proof</span> (${snapshot.commands.passed}/${snapshot.commands.total})
        </h2>
        <span class="text-xs text-emerald-400 font-mono font-medium" data-i18n="table_subtitle">Recorded execution results</span>
      </div>
      <div class="overflow-x-auto rounded-xl border border-gray-800">
        <table class="w-full text-left border-collapse">
          <thead>
            <tr class="bg-gray-900 text-gray-400 text-[11px] uppercase tracking-wider font-mono border-b border-gray-800">
              <th class="py-2.5 px-4 font-semibold" data-i18n="col_subproject">Subproject</th>
              <th class="py-2.5 px-4 font-semibold" data-i18n="col_type">Type</th>
              <th class="py-2.5 px-4 font-semibold" data-i18n="col_command">Command</th>
              <th class="py-2.5 px-4 font-semibold text-right" data-i18n="col_duration">Duration</th>
              <th class="py-2.5 px-4 font-semibold text-right" data-i18n="col_status">Status</th>
            </tr>
          </thead>
          <tbody>
            ${commandsHtml}
          </tbody>
        </table>
      </div>
    </section>

    <!-- Resolved Findings Details -->
    <section class="bg-gray-900/40 border border-gray-800/80 rounded-2xl p-6">
      <div class="flex items-center justify-between mb-4">
        <h2 class="text-base font-bold text-white flex items-center gap-2">
          <span>🛡️</span> <span data-i18n="findings_title">Resolved Anomalies</span> (${snapshot.findings.resolvedCount})
        </h2>
        <span class="text-xs text-gray-400" data-i18n="findings_subtitle">Cleaned up in AGENTS.md</span>
      </div>
      <div class="space-y-2">
        ${resolvedHtml}
      </div>
    </section>

    <!-- Applied Diff -->
    <section class="bg-gray-900/40 border border-gray-800/80 rounded-2xl p-6">
      <div class="flex items-center justify-between mb-4">
        <h2 class="text-base font-bold text-white flex items-center gap-2">
          <span>📄</span> <span data-i18n="diff_title">Applied Files & Recorded Diff</span>
        </h2>
        <div class="flex gap-2">
          ${snapshot.filesApplied.map(f => `<span class="px-2 py-0.5 rounded text-xs font-mono font-medium bg-gray-800 text-gray-200 border border-gray-700">${escapeHtml(f)}</span>`).join('')}
        </div>
      </div>
      <div class="bg-gray-950 rounded-xl p-4 border border-gray-800">
        <pre class="text-xs text-gray-300 font-mono overflow-x-auto max-h-80 whitespace-pre-wrap"><code>${escapeHtml(snapshot.diff)}</code></pre>
      </div>
    </section>

    <!-- Footer -->
    <footer class="text-center text-xs text-gray-600 pt-6 border-t border-gray-900 space-y-1">
      <div>RepoTwin Snapshot · <span data-i18n="footer_generated">Generated on</span> ${escapeHtml(snapshot.appliedAtFormatted)} · Audit ID: <span class="font-mono text-gray-500">${escapeHtml(snapshot.id)}</span></div>
    </footer>

  </div>

  <!-- Client-side Bilingual Translation Engine -->
  <script>
    const certDict = {
      en: {
        cert_title: "Application Report",
        cert_official: "Recorded snapshot",
        cert_subtitle: "Recorded findings, instruction sizes and command results generated by RepoTwin",
        audited_project: "Audited project:",
        score_health_title: "Findings Score",
        score_initially: "initially",
        findings_resolved_title: "Resolved Findings",
        findings_count_suffix: "resolved",
        controls_passed_title: "Recorded Checks",
        passed_suffix: "passed",
        local_backup_title: "Local Backup",
        restore_anytime: "Restoration available at any time",
        gains_title: "Concrete gains",
        gains_subtitle: "Changes are compared with the backed-up files. Expected benefits are not measured outcomes.",
        gains_empty: "No file-level gain recorded for this application.",
        roi_title: "Instructions and measured results",
        recorded_metrics: "Recorded metrics",
        measurement_limits: "Sizes are token estimates, not measured API usage. No monthly savings or guarantees of security or AI behavior.",
        instructions_before: "Instructions before",
        instructions_after: "Instructions after",
        estimated_tokens: "Estimated tokens",
        not_recorded: "Not recorded",
        remaining_findings: "Remaining findings",
        findings_scope: "Findings-based score; not a security certification",
        ...${JSON.stringify(verificationLabels.en)},
        table_title: "Application Checks Proof",
        table_subtitle: "Recorded execution results",
        col_subproject: "Subproject",
        col_type: "Type",
        col_command: "Command",
        col_duration: "Duration",
        col_status: "Status",
        status_passed: "PASSED",
        badge_resolved: "RESOLVED",
        findings_title: "Resolved Anomalies",
        findings_subtitle: "Cleaned up in AGENTS.md",
        no_findings: "No prior anomalies.",
        diff_title: "Applied Files & Recorded Diff",
        footer_generated: "Generated on"
      },
      fr: {
        cert_title: "Rapport d'application",
        cert_official: "Instantané enregistré",
        cert_subtitle: "Constats, tailles des instructions et résultats des commandes enregistrés par RepoTwin",
        audited_project: "Projet audité :",
        score_health_title: "Score des constats",
        score_initially: "initialement",
        findings_resolved_title: "Constats Résolus",
        findings_count_suffix: "résolus",
        controls_passed_title: "Contrôles enregistrés",
        passed_suffix: "passés",
        local_backup_title: "Sauvegarde Locale",
        restore_anytime: "Restauration possible à tout moment",
        gains_title: "Gains concrets",
        gains_subtitle: "Les changements sont comparés aux fichiers sauvegardés. Les bénéfices attendus ne sont pas des résultats mesurés.",
        gains_empty: "Aucun gain sur les fichiers n’a été enregistré pour cette application.",
        roi_title: "Instructions et résultats mesurés",
        recorded_metrics: "Mesures enregistrées",
        measurement_limits: "Les tailles sont des estimations de tokens, pas une consommation API mesurée. Aucune économie mensuelle ni garantie de sécurité ou de comportement IA.",
        instructions_before: "Instructions avant",
        instructions_after: "Instructions après",
        estimated_tokens: "Tokens estimés",
        not_recorded: "Non enregistré",
        remaining_findings: "Constats restants",
        findings_scope: "Score fondé sur les constats ; pas une certification de sécurité",
        ...${JSON.stringify(verificationLabels.fr)},
        table_title: "Preuve des Contrôles Applicatifs",
        table_subtitle: "Résultats d'exécution enregistrés",
        col_subproject: "Sous-projet",
        col_type: "Type",
        col_command: "Commande",
        col_duration: "Durée",
        col_status: "Statut",
        status_passed: "VALIDE",
        badge_resolved: "RÉSOLU",
        findings_title: "Anomalies Corrigées",
        findings_subtitle: "Nettoyage validé dans AGENTS.md",
        no_findings: "Aucune anomalie préalable.",
        diff_title: "Fichiers appliqués et diff enregistré",
        footer_generated: "Généré le"
      }
    };

    function setCertLang(lang) {
      try {
        localStorage.setItem('repotwin_cert_lang', lang);
      } catch {}
      document.documentElement.lang = lang;

      const current = certDict[lang] || certDict.en;
      document.querySelectorAll('[data-i18n]').forEach(el => {
        const key = el.getAttribute('data-i18n');
        if (current[key]) {
          el.textContent = current[key];
        }
      });
      document.querySelectorAll('[data-gain-lang]').forEach(el => {
        el.classList.toggle('hidden', el.getAttribute('data-gain-lang') !== lang);
      });

      const btnEn = document.getElementById('btn-en');
      const btnFr = document.getElementById('btn-fr');
      if (btnEn && btnFr) {
        if (lang === 'en') {
          btnEn.className = "px-2.5 py-1 rounded transition-all font-semibold bg-emerald-600 text-white shadow-sm";
          btnFr.className = "px-2.5 py-1 rounded transition-all text-gray-400 hover:text-white";
        } else {
          btnFr.className = "px-2.5 py-1 rounded transition-all font-semibold bg-emerald-600 text-white shadow-sm";
          btnEn.className = "px-2.5 py-1 rounded transition-all text-gray-400 hover:text-white";
        }
      }
    }

    // Auto-detect preferred language on page load
    (function initLang() {
      let saved = '${initialLang}';
      try {
        saved = localStorage.getItem('repotwin_cert_lang') || localStorage.getItem('repotwin_lang') || '${initialLang}';
      } catch {}
      setCertLang(saved === 'fr' ? 'fr' : 'en');
    })();
  </script>

</body>
</html>`;
}

function formatTimestampForFile(date: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const year = date.getFullYear();
  const month = pad(date.getMonth() + 1);
  const day = pad(date.getDate());
  const hours = pad(date.getHours());
  const minutes = pad(date.getMinutes());
  const seconds = pad(date.getSeconds());
  return `${year}-${month}-${day}_${hours}-${minutes}-${seconds}`;
}

function getGitSlug(root: string, baseCommitFallback?: string): string {
  try {
    const branch = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
      cwd: root,
      encoding: 'utf-8',
      timeout: 2000,
      stdio: ['ignore', 'pipe', 'ignore']
    }).trim();
    const shortCommit = execFileSync('git', ['rev-parse', '--short', 'HEAD'], {
      cwd: root,
      encoding: 'utf-8',
      timeout: 2000,
      stdio: ['ignore', 'pipe', 'ignore']
    }).trim();

    if (branch && branch !== 'HEAD') {
      return `${branch.replace(/[^a-zA-Z0-9_-]/g, '-')}-${shortCommit}`;
    }
    return shortCommit || 'commit';
  } catch {
    if (baseCommitFallback) {
      return baseCommitFallback.replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 16);
    }
    return 'uncommitted';
  }
}

export function saveApplicationSnapshot(
  repoPath: string,
  snapshot: ApplicationSnapshot,
  initialLang: 'en' | 'fr' = 'en'
): { htmlPath: string; jsonPath: string; htmlContent: string; jsonContent: string; globalHtmlPath?: string } {
  const root = fs.realpathSync(repoPath);
  const reportsDir = prepareReportStorage(root);
  snapshot.gains ??= collectApplicationGains(snapshot);

  // Build structured, readable, and sortable filename
  const dateStr = formatTimestampForFile(snapshot.appliedAt ? new Date(snapshot.appliedAt) : new Date());
  const repoSlug = (snapshot.repoName || path.basename(root)).replace(/[^a-zA-Z0-9_-]/g, '-');
  const gitSlug = getGitSlug(root, snapshot.baseCommit);
  const afterScore = snapshot.scores?.after?.score ?? 0;
  const afterGrade = snapshot.scores?.after?.grade ?? 'NA';
  const scoreSlug = `${afterScore}-${afterGrade}`;
  const allPassed = snapshot.commands.total > 0 && snapshot.commands.passed === snapshot.commands.total;
  const statusSlug = allPassed ? 'PASSED' : 'NEEDS_FIX';

  const baseName = `${dateStr}__${repoSlug}__${gitSlug}__${scoreSlug}__${statusSlug}__${crypto.randomUUID().slice(0, 8)}`;

  const jsonContent = JSON.stringify(snapshot, null, 2);
  const jsonPath = path.join(reportsDir, `${baseName}.json`);
  writeReportAtomically(jsonPath, jsonContent);

  const htmlContent = generateCertificateHtml(snapshot, initialLang);
  const htmlPath = path.join(reportsDir, `${baseName}.html`);
  writeReportAtomically(htmlPath, htmlContent);

  // Backward compatibility: maintain latest alias within the repository
  const latestHtmlPath = path.join(reportsDir, 'repotwin-certificate-latest.html');
  const latestJsonPath = path.join(reportsDir, 'repotwin-certificate-latest.json');
  writeReportAtomically(latestHtmlPath, htmlContent);
  writeReportAtomically(latestJsonPath, jsonContent);

  // Global archive (~/.repotwin/reports/) and centralized registry (~/.repotwin/registry.json)
  let globalHtmlPath: string | undefined;
  try {
    const globalHome = ensureSafeDirectory(os.homedir(), '.repotwin');
    const globalReportsDir = ensureSafeDirectory(globalHome, 'reports');

    globalHtmlPath = path.join(globalReportsDir, `${baseName}.html`);
    const globalJsonPath = path.join(globalReportsDir, `${baseName}.json`);
    writeReportAtomically(globalHtmlPath, htmlContent);
    writeReportAtomically(globalJsonPath, jsonContent);

    // Update centralized registry
    const registryPath = path.join(globalHome, 'registry.json');
    assertSafeReportFile(registryPath);
    let registry: Array<Record<string, unknown>> = [];
    if (fs.existsSync(registryPath)) {
      try {
        const raw = fs.readFileSync(registryPath, 'utf-8');
        registry = JSON.parse(raw);
        if (!Array.isArray(registry)) registry = [];
      } catch {
        registry = [];
      }
    }

    const registryEntry = {
      id: snapshot.id,
      timestamp: snapshot.appliedAt || new Date().toISOString(),
      dateFormatted: dateStr,
      repoName: snapshot.repoName,
      repoPath: root,
      git: gitSlug,
      scoreBefore: snapshot.scores.before.score,
      scoreAfter: snapshot.scores.after.score,
      gradeAfter: snapshot.scores.after.grade,
      commandsPassed: snapshot.commands.passed,
      commandsTotal: snapshot.commands.total,
      status: statusSlug,
      localHtmlPath: htmlPath,
      globalHtmlPath
    };

    // Prepend to display most recent audits first
    registry.unshift(registryEntry);
    writeReportAtomically(registryPath, JSON.stringify(registry, null, 2));
  } catch {}

  return { htmlPath, jsonPath, htmlContent, jsonContent, globalHtmlPath };
}

function escapeHtml(str: string): string {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
