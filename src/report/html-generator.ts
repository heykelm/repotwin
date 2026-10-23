import fs from 'node:fs';
import path from 'node:path';
import { SubprojectInfo, ProcessedFinding } from '../types/index.js';
import { ScoreBreakdown } from '../diagnostics/score.js';

export interface HtmlReportOptions {
  repoPath: string;
  scores: ScoreBreakdown;
  subprojects: SubprojectInfo[];
  falsePositives: ProcessedFinding[];
  trueIssues: ProcessedFinding[];
  proposedFixes: string[];
  newAgentsMd: string;
}

export function generateHtmlReport(options: HtmlReportOptions, outputPath: string): string {
  const repoName = path.basename(options.repoPath);

  const subprojectsHtml = options.subprojects.map(sub => `
    <tr class="border-b border-gray-800 hover:bg-gray-800/40 transition">
      <td class="py-3 px-4 font-semibold text-white flex items-center gap-2">
        <span class="w-2 h-2 rounded-full ${sub.testScript ? 'bg-emerald-400' : 'bg-amber-400'}"></span>
        ${escapeHtml(sub.name)} <span class="text-xs text-gray-500 font-mono">(${escapeHtml(sub.relPath)}/)</span>
      </td>
      <td class="py-3 px-4 text-gray-400 font-mono text-sm">${escapeHtml(sub.kind)}</td>
      <td class="py-3 px-4 text-emerald-400 font-mono text-xs">${sub.testScript ? escapeHtml(sub.testScript) : '<span class="text-gray-500">Aucun test</span>'}</td>
      <td class="py-3 px-4 text-gray-400 text-xs">${sub.isSubmodule ? 'Git Submodule' : 'Dossier'}</td>
    </tr>
  `).join('');

  const fpItemsHtml = options.falsePositives.map(fp => `
    <div class="p-3 bg-gray-900/60 border border-gray-800 rounded-lg flex items-start gap-3 text-sm">
      <span class="px-2 py-0.5 rounded text-xs font-mono font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
        ${escapeHtml(fp.classification)}
      </span>
      <div class="flex-1 min-w-0">
        <div class="font-mono text-white text-xs font-medium truncate">${escapeHtml(fp.targetRef || fp.raw.message)}</div>
        <div class="text-gray-400 text-xs mt-0.5">${escapeHtml(fp.explanation)}</div>
      </div>
    </div>
  `).join('');

  const html = `<!DOCTYPE html>
<html lang="fr" class="dark">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>RepoTwin Audit — ${escapeHtml(repoName)}</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@300;400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet">
  <style>
    body { font-family: 'Plus Jakarta Sans', sans-serif; }
    code, pre { font-family: 'JetBrains Mono', monospace; }
  </style>
</head>
<body class="bg-gray-950 text-gray-100 min-h-screen py-10 px-4 sm:px-6 lg:px-8 antialiased selection:bg-indigo-500 selection:text-white">

  <div class="max-w-5xl mx-auto space-y-8">
    
    <!-- Top Header -->
    <header class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-6 border-b border-gray-800/80">
      <div>
        <div class="flex items-center gap-3">
          <div class="h-9 w-9 rounded-xl bg-gradient-to-tr from-indigo-500 to-purple-500 flex items-center justify-center font-bold text-white shadow-lg shadow-indigo-500/20">
            RT
          </div>
          <div>
            <h1 class="text-2xl font-bold text-white tracking-tight flex items-center gap-2">
              RepoTwin <span class="text-xs font-mono font-normal px-2 py-0.5 rounded-full bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">v0.1.0</span>
            </h1>
            <p class="text-xs text-gray-400">Rapport d'Audit d'Efficacité pour Agents IA</p>
          </div>
        </div>
      </div>
      <div class="flex items-center gap-2 font-mono text-xs text-gray-400 bg-gray-900 px-3 py-1.5 rounded-lg border border-gray-800">
        <span class="text-gray-500">Cible:</span>
        <span class="text-white font-medium truncate max-w-xs">${escapeHtml(options.repoPath)}</span>
      </div>
    </header>

    <!-- Score Hero Cards -->
    <section class="grid grid-cols-1 md:grid-cols-3 gap-4">
      
      <!-- Card 1: Raw Score -->
      <div class="bg-gray-900/60 border border-red-950/60 p-6 rounded-2xl relative overflow-hidden backdrop-blur">
        <div class="absolute -right-4 -bottom-4 w-24 h-24 bg-red-500/10 rounded-full blur-2xl"></div>
        <div class="text-xs font-semibold uppercase tracking-wider text-red-400 mb-1">Score Brut (Scanner Externe)</div>
        <div class="flex items-baseline gap-2 mt-2">
          <span class="text-5xl font-extrabold text-red-400 tracking-tight">${options.scores.evaluated === false ? 'Non évalué' : options.scores.rawScore}</span>
          <span class="text-gray-500 text-sm">/ 100</span>
          <span class="px-2 py-0.5 text-xs rounded bg-red-500/10 text-red-400 border border-red-500/20 font-bold ml-auto">${options.scores.rawGrade}</span>
        </div>
        <p class="text-xs text-gray-400 mt-4 leading-relaxed">
          Score calculé à partir des constats importés, avant désambiguïsation.
        </p>
      </div>

      <!-- Card 2: Real Corrected Score -->
      <div class="bg-gray-900/60 border border-amber-950/60 p-6 rounded-2xl relative overflow-hidden backdrop-blur">
        <div class="absolute -right-4 -bottom-4 w-24 h-24 bg-amber-500/10 rounded-full blur-2xl"></div>
        <div class="text-xs font-semibold uppercase tracking-wider text-amber-400 mb-1">Score Réel RepoTwin</div>
        <div class="flex items-baseline gap-2 mt-2">
          <span class="text-5xl font-extrabold text-amber-400 tracking-tight">${options.scores.evaluated === false ? 'Non évalué' : options.scores.correctedScore}</span>
          <span class="text-gray-500 text-sm">/ 100</span>
          <span class="px-2 py-0.5 text-xs rounded bg-amber-500/10 text-amber-400 border border-amber-500/20 font-bold ml-auto">${options.scores.correctedGrade}</span>
        </div>
        <p class="text-xs text-emerald-400 mt-4 leading-relaxed flex items-center gap-1.5 font-medium">
          <span>✓</span> +${options.scores.falsePenaltyRestored} pts restaurés après filtrage chirurgical
        </p>
      </div>

      <!-- Card 3: Projected Post-Twin -->
      <div class="bg-gradient-to-b from-indigo-950/40 to-gray-900/60 border border-emerald-500/30 p-6 rounded-2xl relative overflow-hidden backdrop-blur shadow-xl shadow-emerald-950/20">
        <div class="absolute -right-4 -bottom-4 w-24 h-24 bg-emerald-500/20 rounded-full blur-2xl"></div>
        <div class="text-xs font-semibold uppercase tracking-wider text-emerald-400 mb-1">Potentiel Post-Twin</div>
        <div class="flex items-baseline gap-2 mt-2">
          <span class="text-5xl font-extrabold text-emerald-400 tracking-tight">${options.scores.evaluated === false ? 'Non évalué' : options.scores.projectedScore}</span>
          <span class="text-gray-500 text-sm">/ 100</span>
          <span class="px-2 py-0.5 text-xs rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 font-bold ml-auto">${options.scores.projectedGrade}</span>
        </div>
        <p class="text-xs text-indigo-300 mt-4 leading-relaxed font-medium">
          Projection neutre : aucun gain n'est annoncé avant validation des changements.
        </p>
      </div>

    </section>

    <!-- Subprojects Table -->
    <section class="bg-gray-900/40 border border-gray-800/80 rounded-2xl p-6">
      <h2 class="text-base font-bold text-white mb-4 flex items-center gap-2">
        <span>📦</span> Cartographie des Sous-Projets Détectés (${options.subprojects.length})
      </h2>
      <div class="overflow-x-auto">
        <table class="w-full text-left">
          <thead>
            <tr class="text-xs uppercase text-gray-500 border-b border-gray-800">
              <th class="py-2.5 px-4">Projet</th>
              <th class="py-2.5 px-4">Langage</th>
              <th class="py-2.5 px-4">Commande Test</th>
              <th class="py-2.5 px-4">Nature</th>
            </tr>
          </thead>
          <tbody>
            ${subprojectsHtml}
          </tbody>
        </table>
      </div>
    </section>

    <!-- False Positives Eliminated -->
    <section class="bg-gray-900/40 border border-gray-800/80 rounded-2xl p-6">
      <div class="flex items-center justify-between mb-4">
        <h2 class="text-base font-bold text-white flex items-center gap-2">
          <span>🛡️</span> Faux Positifs Éliminés par RepoTwin (${options.falsePositives.length})
        </h2>
        <span class="text-xs text-emerald-400 font-mono font-medium">Résultats vérifiés par classification</span>
      </div>
      <div class="grid grid-cols-1 md:grid-cols-2 gap-3 max-h-96 overflow-y-auto pr-1">
        ${fpItemsHtml}
      </div>
    </section>

    <!-- Action Plan & Diff -->
    <section class="bg-gray-900/40 border border-indigo-500/30 rounded-2xl p-6 relative overflow-hidden">
      <div class="flex items-center justify-between mb-4">
        <h2 class="text-base font-bold text-white flex items-center gap-2">
          <span>💡</span> Amélioration Recommandée : Le Nouveau AGENTS.md
        </h2>
        <span class="px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
          À prévisualiser avant application
        </span>
      </div>
      <ul class="space-y-1.5 mb-6 text-xs text-gray-300">
        ${options.proposedFixes.map(f => `<li class="flex items-center gap-2"><span class="text-indigo-400">✦</span> ${escapeHtml(f)}</li>`).join('')}
      </ul>

      <div class="bg-gray-950 rounded-xl p-4 border border-gray-800">
        <pre class="text-xs text-gray-300 font-mono overflow-x-auto max-h-72"><code>${escapeHtml(options.newAgentsMd)}</code></pre>
      </div>

      <div class="mt-6 flex flex-col sm:flex-row gap-3">
        <div class="text-xs text-gray-400 flex items-center">
          Pour appliquer ces modifications en 1 clic dans votre terminal :
        </div>
        <div class="bg-gray-950 px-3 py-1.5 rounded-lg border border-gray-800 text-xs font-mono text-emerald-400 font-bold ml-auto">
          repotwin fix --apply
        </div>
      </div>
    </section>

    <!-- Footer -->
    <footer class="text-center text-xs text-gray-600 pt-6 border-t border-gray-900">
      RepoTwin — Measure. Optimize. Prove. · Conçu pour les agents IA (Cursor, Claude Code, Codex, Gemini CLI)
    </footer>

  </div>

</body>
</html>`;

  fs.writeFileSync(outputPath, html, 'utf-8');
  return outputPath;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
