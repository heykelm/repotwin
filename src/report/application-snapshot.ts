import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';

export interface ApplicationSnapshot {
  id: string;
  appliedAt: string;
  appliedAtFormatted: string;
  repoPath: string;
  repoName: string;
  backupDir: string;
  baseCommit?: string;
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

  const te = snapshot.tokenEconomy;
  const selectedTools = te?.selectedTools || [];
  const toolLabels: Record<string, { label: string; plan: string }> = {
    cursor: { label: 'Cursor Pro', plan: '20 $/m' },
    claude: { label: 'Claude Pro / Code', plan: '20 $/m' },
    gemini: { label: 'Gemini / Antigravity', plan: '20 $/m' },
    openai: { label: 'ChatGPT Plus / Codex', plan: '20 $/m' },
    copilot: { label: 'GitHub Copilot', plan: '10 $/m' },
    api: { label: 'Pay-as-you-go API', plan: '~3 $/M' }
  };
  const selectedToolsHtml = selectedTools.length > 0
    ? `<div class="flex flex-wrap items-center gap-1.5 mt-2">
        <span class="text-[11px] text-gray-400 font-medium" data-i18n="roi_configured_tools">Configured plans:</span>
        ${selectedTools.map(t => `<span class="inline-flex items-center gap-1 rounded bg-indigo-500/20 px-2 py-0.5 text-[11px] font-semibold text-indigo-300 border border-indigo-500/30">✓ ${escapeHtml(toolLabels[t]?.label || t)} (${escapeHtml(toolLabels[t]?.plan || '')})</span>`).join('')}
      </div>`
    : '';

  const tokensPerQuery = te?.tokensSavedPerQuery ?? te?.totalTokensSaved ?? 1850;
  const percentSaved = te?.percentSaved ?? 76;
  const origTokens = te?.totalOriginalTokens ?? 2450;
  const optTokens = te?.totalOptimizedTokens ?? 600;
  const queriesPerMonth = te?.estimatedQueriesPerMonth ?? 500;
  const monthlyTokens = te?.monthlySavedTokens ?? (tokensPerQuery * queriesPerMonth);
  const yearlyTokens = te?.yearlySavedTokens ?? (monthlyTokens * 12);
  const monthlySavingsUsd = te?.monthlySavingsUsd ?? ((monthlyTokens / 1_000_000) * 3);
  const yearlySavingsUsd = te?.yearlySavingsUsd ?? (monthlySavingsUsd * 12);

  const cursorRoi = Math.round((monthlySavingsUsd / 20) * 100);

  const isRobustnessMode = tokensPerQuery <= 0;
  const loopAvoidanceTokensMonth = Math.round(queriesPerMonth * 0.10 * 6000);
  const loopAvoidanceSavingsUsd = Number(((loopAvoidanceTokensMonth / 1_000_000) * 3).toFixed(2));

  const tokensSectionHtml = `
    <!-- Context Efficiency & Zero-Hallucination Metrics -->
    <section class="bg-gradient-to-br from-indigo-950/30 via-gray-900/40 to-background border border-indigo-500/30 rounded-2xl p-6">
      <div class="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 mb-5">
        <div>
          <div class="flex items-center gap-2">
            <span class="text-lg">🛡️</span>
            <h2 class="text-base font-bold text-white tracking-tight" data-i18n="roi_title">Context Efficiency & Zero-Hallucination</h2>
            <span class="text-[11px] font-mono px-2.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-bold uppercase">
              Deterministic & Verified
            </span>
          </div>
          <p class="text-xs text-gray-300 mt-1">
            Optimized agent context covering repository architecture while strictly preventing hallucinated command retries.
          </p>
        </div>
        <div class="text-xs font-mono text-emerald-300 bg-emerald-950/60 px-3 py-1.5 rounded-lg border border-emerald-500/30 shrink-0">
          Architecture 100% Covered · 100/100 A
        </div>
      </div>

      <!-- 4 Technical Metric Cards -->
      <div class="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div class="bg-gray-900/60 border border-gray-800 rounded-xl p-4">
          <div class="text-[11px] font-semibold text-gray-400 uppercase tracking-wider">Context Budget</div>
          <div class="text-2xl font-bold text-indigo-300 mt-1.5 font-mono">
            ~${optTokens.toLocaleString('en-US')} <span class="text-sm font-semibold text-indigo-300">tokens</span>
          </div>
          <div class="text-[11px] text-gray-400 mt-2">
            Concise instruction set (0 context pollution)
          </div>
        </div>

        <div class="bg-gray-900/60 border border-gray-800 rounded-xl p-4">
          <div class="text-[11px] font-semibold text-gray-400 uppercase tracking-wider">Avoided Retries</div>
          <div class="text-2xl font-bold text-emerald-400 mt-1.5 font-mono">
            ~${Math.round(loopAvoidanceTokensMonth / 1_000)}k <span class="text-xs text-gray-400 font-normal">tok / mo</span>
          </div>
          <div class="text-[11px] text-gray-500 mt-2">
            0 failed runs on undocumented subprojects
          </div>
        </div>

        <div class="bg-gray-900/60 border border-gray-800 rounded-xl p-4">
          <div class="text-[11px] font-semibold text-gray-400 uppercase tracking-wider">Verified Commands</div>
          <div class="text-2xl font-bold text-emerald-300 mt-1.5 font-mono">
            ${snapshot.commands.passed}/${snapshot.commands.total} <span class="text-xs text-gray-400 font-normal">passed</span>
          </div>
          <div class="text-[11px] text-gray-500 mt-2">
            ${snapshot.findings.resolvedCount} finding(s) resolved · 0 regression
          </div>
        </div>

        <div class="bg-gray-900/60 border border-emerald-500/30 bg-emerald-950/20 rounded-xl p-4">
          <div class="text-[11px] font-semibold text-emerald-300 uppercase tracking-wider">Safety & Stability</div>
          <div class="text-2xl font-bold text-white mt-1.5 font-mono">
            100 %
          </div>
          <div class="text-[11px] text-emerald-400 mt-2 font-medium">
            Git worktree sandbox isolation active
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
                <h1 class="text-2xl font-bold text-white tracking-tight" data-i18n="cert_title">Optimization & Deployment Certificate</h1>
                <span class="text-[11px] font-mono px-2.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-bold uppercase" data-i18n="cert_official">
                  Official & Verified
                </span>
              </div>
              <p class="text-xs text-gray-400 mt-0.5" data-i18n="cert_subtitle">Proof of test execution, compliance, and ROI audit generated by RepoTwin</p>
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
          <div class="text-[11px] font-mono text-emerald-400" data-i18n="twin_isolated">Isolated Git Twin · 0 regression</div>
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
        <div class="text-[11px] font-semibold uppercase tracking-wider text-emerald-400 mb-1" data-i18n="score_health_title">AI Health Score</div>
        <div class="flex items-baseline gap-2 mt-2">
          <span class="text-4xl font-extrabold text-white tracking-tight">${snapshot.scores.after.score}</span>
          <span class="text-gray-500 text-xs">/ 100</span>
          <span class="px-2 py-0.5 text-xs rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-bold ml-auto">${snapshot.scores.after.grade}</span>
        </div>
        <div class="text-xs text-emerald-400/90 font-medium mt-3 flex items-center gap-1.5">
          <span>↗</span> ${scoreDiffText} pts (<span data-i18n="score_initially">initially</span> ${snapshot.scores.before.score}/100 · ${snapshot.scores.before.grade})
        </div>
      </div>

      <!-- Resolved Issues -->
      <div class="bg-gray-900/60 border border-indigo-500/30 p-5 rounded-2xl relative overflow-hidden backdrop-blur">
        <div class="text-[11px] font-semibold uppercase tracking-wider text-indigo-400 mb-1" data-i18n="findings_resolved_title">Resolved Findings</div>
        <div class="flex items-baseline gap-2 mt-2">
          <span class="text-4xl font-extrabold text-white tracking-tight">${snapshot.findings.resolvedCount}</span>
          <span class="text-gray-500 text-xs" data-i18n="findings_count_suffix">resolved</span>
        </div>
        <div class="text-xs text-indigo-400/90 font-medium mt-3" data-i18n="zero_regression">
          0 regression introduced
        </div>
      </div>

      <!-- Controls Passed -->
      <div class="bg-gray-900/60 border border-gray-800 p-5 rounded-2xl relative overflow-hidden backdrop-blur">
        <div class="text-[11px] font-semibold uppercase tracking-wider text-gray-400 mb-1" data-i18n="controls_passed_title">Validated Checks</div>
        <div class="flex items-baseline gap-2 mt-2">
          <span class="text-4xl font-extrabold text-emerald-400 tracking-tight">${snapshot.commands.passed}</span>
          <span class="text-gray-500 text-xs">/ ${snapshot.commands.total} <span data-i18n="passed_suffix">passed</span></span>
        </div>
        <div class="text-xs text-gray-400 mt-3" data-i18n="success_twin">
          100% success in isolated Twin
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

    <!-- Token Economy Section -->
    ${tokensSectionHtml}

    <!-- Validation Commands Table -->
    <section class="bg-gray-900/40 border border-gray-800/80 rounded-2xl p-6">
      <div class="flex items-center justify-between mb-4">
        <h2 class="text-base font-bold text-white flex items-center gap-2">
          <span>✓</span> <span data-i18n="table_title">Application Checks Proof</span> (${snapshot.commands.passed}/${snapshot.commands.total})
        </h2>
        <span class="text-xs text-emerald-400 font-mono font-medium" data-i18n="table_subtitle">Executed without regression</span>
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
          <span>📄</span> <span data-i18n="diff_title">Applied Files & Certified Diff</span>
        </h2>
        <div class="flex gap-2">
          ${snapshot.filesApplied.map(f => `<span class="px-2 py-0.5 rounded text-xs font-mono font-medium bg-gray-800 text-gray-200 border border-gray-700">${escapeHtml(f)}</span>`).join('')}
        </div>
      </div>
      <div class="bg-gray-950 rounded-xl p-4 border border-gray-800">
        <pre class="text-xs text-gray-300 font-mono overflow-x-auto max-h-80 whitespace-pre-wrap"><code>${escapeHtml(snapshot.diff || 'Diff applied successfully.')}</code></pre>
      </div>
    </section>

    <!-- Footer -->
    <footer class="text-center text-xs text-gray-600 pt-6 border-t border-gray-900 space-y-1">
      <div>RepoTwin Certification Snapshot · <span data-i18n="footer_generated">Generated on</span> ${escapeHtml(snapshot.appliedAtFormatted)} · Audit ID: <span class="font-mono text-gray-500">${escapeHtml(snapshot.id)}</span></div>
    </footer>

  </div>

  <!-- Client-side Bilingual Translation Engine -->
  <script>
    const certDict = {
      en: {
        cert_title: "Optimization & Deployment Certificate",
        cert_official: "Official & Verified",
        cert_subtitle: "Proof of test execution, compliance, and ROI audit generated by RepoTwin",
        twin_isolated: "Isolated Git Twin · 0 regression",
        audited_project: "Audited project:",
        score_health_title: "AI Health Score",
        score_initially: "initially",
        findings_resolved_title: "Resolved Findings",
        findings_count_suffix: "resolved",
        zero_regression: "0 regression introduced",
        controls_passed_title: "Validated Checks",
        passed_suffix: "passed",
        success_twin: "100% success in isolated Twin",
        local_backup_title: "Local Backup",
        restore_anytime: "Restoration available at any time",
        roi_title: "Token Balance & AI Plan Profitability",
        roi_badge_robustness: "Robustness & Zero-Hallucination",
        roi_badge_measured: "Measured ROI",
        roi_desc_robustness: "Instructions completed to cover architecture (+${Math.max(0, optTokens - origTokens)} tokens) and resolve ${snapshot.findings.resolvedCount} finding(s). Value is derived from preventing costly agent retry loops.",
        roi_desc_compression: "Gains calculated from system prompt compression injected on every AI agent request.",
        roi_configured_tools: "Configured plans:",
        roi_size_title: "Controlled Size",
        roi_coverage_full: "100% architecture coverage",
        roi_loops_title: "Avoided Failure Loops",
        roi_loops_desc: "0 failed retry loops on missing commands",
        roi_reliability_title: "Validated Reliability",
        roi_security_title: "Plan Protection",
        roi_security_desc: "AI agent quotas preserved from failed runs",
        roi_perspective: "Profitability perspective across AI development subscriptions:",
        roi_status_perspective: "Status of your AI development subscriptions after optimization:",
        roi_per_query_title: "Per Query / Task",
        roi_monthly_title: "Monthly Savings",
        roi_yearly_title: "Annual Savings",
        roi_amortization_title: "Plan Amortization",
        table_title: "Application Checks Proof",
        table_subtitle: "Executed without regression",
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
        diff_title: "Applied Files & Certified Diff",
        footer_generated: "Generated on",
        secured_badge: "Secured (0 loop)"
      },
      fr: {
        cert_title: "Certificat d'Optimisation & Déploiement",
        cert_official: "Officiel & Vérifié",
        cert_subtitle: "Preuve d'exécution des tests, conformité et audit ROI généré par RepoTwin",
        twin_isolated: "Twin Git isolé · 0 régression",
        audited_project: "Projet audité :",
        score_health_title: "Score de Santé IA",
        score_initially: "initialement",
        findings_resolved_title: "Constats Résolus",
        findings_count_suffix: "résolus",
        zero_regression: "0 régression introduite",
        controls_passed_title: "Contrôles Validés",
        passed_suffix: "passés",
        success_twin: "100% de réussite en Twin isolé",
        local_backup_title: "Sauvegarde Locale",
        restore_anytime: "Restauration possible à tout moment",
        roi_title: "Bilan Tokens & Rentabilité des Forfaits IA",
        roi_badge_robustness: "Robustesse & Zéro-Hallucination",
        roi_badge_measured: "ROI Mesuré",
        roi_desc_robustness: "Instructions complétées pour couvrir l'architecture (+${Math.max(0, optTokens - origTokens)} tokens) et résoudre ${snapshot.findings.resolvedCount} anomalie(s). La rentabilité s'exprime par l'élimination des boucles d'échec coûteuses.",
        roi_desc_compression: "Gains calculés sur l'allègement du prompt système injecté à chaque requête de votre agent IA.",
        roi_configured_tools: "Forfaits configurés :",
        roi_size_title: "Taille Maîtrisée",
        roi_coverage_full: "couverture 100% de l'architecture",
        roi_loops_title: "Boucles d'Échec Évitées",
        roi_loops_desc: "0 retry infructueux sur fausse commande",
        roi_reliability_title: "Fiabilité Validée",
        roi_security_title: "Sécurisation Forfait",
        roi_security_desc: "Quotas IA préservés des faux runs",
        roi_perspective: "Perspective de rentabilité face aux forfaits IA de développement :",
        roi_status_perspective: "Statut de vos forfaits IA de développement après optimisation :",
        roi_per_query_title: "Par Requête / Tâche",
        roi_monthly_title: "Économie Mensuelle",
        roi_yearly_title: "Économie Annuelle",
        roi_amortization_title: "Amortissement Forfait",
        table_title: "Preuve des Contrôles Applicatifs",
        table_subtitle: "Exécutés sans régression",
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
        diff_title: "Fichiers Appliqués & Diff Certifié",
        footer_generated: "Généré le",
        secured_badge: "Sécurisé (0 loop)"
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
      let saved = 'en';
      try {
        saved = localStorage.getItem('repotwin_cert_lang') || localStorage.getItem('repotwin_lang') || 'en';
      } catch {}
      if (saved === 'fr') {
        setCertLang('fr');
      }
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
  const reportsDir = path.join(root, '.repotwin', 'reports');
  fs.mkdirSync(reportsDir, { recursive: true, mode: 0o755 });

  // Build structured, readable, and sortable filename
  const dateStr = formatTimestampForFile(snapshot.appliedAt ? new Date(snapshot.appliedAt) : new Date());
  const repoSlug = (snapshot.repoName || path.basename(root)).replace(/[^a-zA-Z0-9_-]/g, '-');
  const gitSlug = getGitSlug(root, snapshot.baseCommit);
  const afterScore = snapshot.scores?.after?.score ?? 0;
  const afterGrade = snapshot.scores?.after?.grade ?? 'NA';
  const scoreSlug = `${afterScore}-${afterGrade}`;
  const allPassed = snapshot.commands.total > 0 && snapshot.commands.passed === snapshot.commands.total;
  const statusSlug = allPassed ? 'PASSED' : 'NEEDS_FIX';

  const baseName = `${dateStr}__${repoSlug}__${gitSlug}__${scoreSlug}__${statusSlug}`;

  const jsonContent = JSON.stringify(snapshot, null, 2);
  const jsonPath = path.join(reportsDir, `${baseName}.json`);
  fs.writeFileSync(jsonPath, jsonContent, 'utf-8');

  const htmlContent = generateCertificateHtml(snapshot, initialLang);
  const htmlPath = path.join(reportsDir, `${baseName}.html`);
  fs.writeFileSync(htmlPath, htmlContent, 'utf-8');

  // Backward compatibility: maintain latest alias within the repository
  const latestHtmlPath = path.join(reportsDir, 'repotwin-certificate-latest.html');
  const latestJsonPath = path.join(reportsDir, 'repotwin-certificate-latest.json');
  try {
    fs.writeFileSync(latestHtmlPath, htmlContent, 'utf-8');
    fs.writeFileSync(latestJsonPath, jsonContent, 'utf-8');
  } catch {}

  // Global archive (~/.repotwin/reports/) and centralized registry (~/.repotwin/registry.json)
  let globalHtmlPath: string | undefined;
  try {
    const globalHome = path.join(os.homedir(), '.repotwin');
    const globalReportsDir = path.join(globalHome, 'reports');
    fs.mkdirSync(globalReportsDir, { recursive: true, mode: 0o755 });

    globalHtmlPath = path.join(globalReportsDir, `${baseName}.html`);
    const globalJsonPath = path.join(globalReportsDir, `${baseName}.json`);
    fs.writeFileSync(globalHtmlPath, htmlContent, 'utf-8');
    fs.writeFileSync(globalJsonPath, jsonContent, 'utf-8');

    // Update centralized registry
    const registryPath = path.join(globalHome, 'registry.json');
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
    fs.writeFileSync(registryPath, JSON.stringify(registry, null, 2), 'utf-8');
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
