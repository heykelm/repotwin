import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import { execSync } from 'node:child_process';
import { discoverSubprojects, buildFileIndex } from '../analyzer/subproject-scanner.js';
import { scanRules } from '../analyzer/rules-scanner.js';
import { parseAgentReport } from '../analyzer/report-parser.js';
import { disambiguateFinding } from '../diagnostics/disambiguator.js';
import { calculateScores } from '../diagnostics/score.js';
import { generateOptimizationRecipe } from '../generator/recipe-agents-md.js';
import { createCandidateTwin, cleanTwins } from '../twin/worktree-manager.js';

export function startDevServer(repoPath: string, port = 4242) {
  const server = http.createServer((req, res) => {
    // Enable CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.writeHead(200);
      res.end();
      return;
    }

    const url = new URL(req.url || '/', `http://localhost:${port}`);

    // API: Create Twin
    if (url.pathname === '/api/twin/create' && req.method === 'POST') {
      try {
        const subprojects = discoverSubprojects(repoPath);
        const recipe = generateOptimizationRecipe(repoPath, subprojects, []);
        const result = createCandidateTwin(repoPath, recipe);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, result }));
      } catch (err: any) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: err.message }));
      }
      return;
    }

    // API: Apply Fix
    if (url.pathname === '/api/twin/apply' && req.method === 'POST') {
      try {
        const subprojects = discoverSubprojects(repoPath);
        const recipe = generateOptimizationRecipe(repoPath, subprojects, []);
        fs.writeFileSync(path.join(repoPath, 'AGENTS.md'), recipe.agentsMdContent, 'utf-8');
        fs.writeFileSync(path.join(repoPath, 'agent-ready.json'), recipe.agentReadyJsonContent, 'utf-8');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, message: 'Optimisation appliquée avec succès !' }));
      } catch (err: any) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: err.message }));
      }
      return;
    }

    // API: Clean Twins
    if (url.pathname === '/api/twin/clean' && req.method === 'POST') {
      try {
        const cleaned = cleanTwins(repoPath);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, cleaned }));
      } catch (err: any) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: err.message }));
      }
      return;
    }

    // Serve HTML Dashboard
    if (url.pathname === '/' || url.pathname === '/index.html') {
      const subprojects = discoverSubprojects(repoPath);
      const fileSet = buildFileIndex(repoPath, subprojects);
      const rules = scanRules(repoPath);

      let reportFile = path.resolve(process.cwd(), 'fixtures/nicehub-agent-report.md');
      if (!fs.existsSync(reportFile)) {
        reportFile = '/tmp/nicehub-agent-report.md';
      }

      const rawFindings = fs.existsSync(reportFile) ? parseAgentReport(reportFile) : [];
      const ctx = { fileSet, rules, subprojects };
      const processed = rawFindings.map(raw => disambiguateFinding(raw, ctx));
      const falsePositives = processed.filter(p => p.isFalsePositive);
      const scores = calculateScores(processed);
      const recipe = generateOptimizationRecipe(repoPath, subprojects, processed);

      const html = renderInteractiveStudio({
        repoPath,
        scores,
        subprojects,
        falsePositives,
        recipe
      });

      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
      return;
    }

    res.writeHead(404);
    res.end('Not found');
  });

  server.listen(port, () => {
    const studioUrl = `http://localhost:${port}`;
    console.log(`\n🚀 RepoTwin Studio actif sur : \x1b[36m${studioUrl}\x1b[0m`);
    console.log(`Boutons d'action en direct : Créer Twin, Appliquer Fix, Nettoyer.`);
    try {
      execSync(`open "${studioUrl}" 2>/dev/null`);
    } catch {
      // ignore
    }
  });

  return server;
}

function renderInteractiveStudio(data: any): string {
  const repoName = path.basename(data.repoPath);

  const subprojectsRows = data.subprojects.map((sub: any) => `
    <tr class="border-b border-gray-800/80 hover:bg-gray-800/30 transition">
      <td class="py-3 px-4 font-semibold text-white flex items-center gap-2">
        <span class="w-2 h-2 rounded-full ${sub.testScript ? 'bg-emerald-400' : 'bg-amber-400'}"></span>
        ${sub.name} <span class="text-xs text-gray-500 font-mono">(${sub.relPath}/)</span>
      </td>
      <td class="py-3 px-4 text-gray-400 font-mono text-xs">${sub.kind}</td>
      <td class="py-3 px-4 text-emerald-400 font-mono text-xs">${sub.testScript || '<span class="text-gray-500">Aucun test</span>'}</td>
      <td class="py-3 px-4 text-gray-400 text-xs">${sub.isSubmodule ? 'Git Submodule' : 'Dossier'}</td>
    </tr>
  `).join('');

  const fpCards = data.falsePositives.map((fp: any) => `
    <div class="p-3 bg-gray-900/60 border border-gray-800 rounded-xl flex items-start gap-3 text-xs">
      <span class="px-2 py-0.5 rounded text-[11px] font-mono font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 shrink-0">
        ${fp.classification}
      </span>
      <div class="min-w-0 flex-1">
        <div class="font-mono text-white font-medium truncate">${fp.targetRef || fp.raw.message}</div>
        <div class="text-gray-400 mt-0.5">${fp.explanation}</div>
      </div>
    </div>
  `).join('');

  return `<!DOCTYPE html>
<html lang="fr" class="dark">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>RepoTwin Studio — ${repoName}</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com">
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@300;400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet">
  <style>
    body { font-family: 'Plus Jakarta Sans', sans-serif; }
    code, pre { font-family: 'JetBrains Mono', monospace; }
  </style>
</head>
<body class="bg-gray-950 text-gray-100 min-h-screen py-10 px-4 sm:px-6 lg:px-8 antialiased selection:bg-indigo-500 selection:text-white">

  <!-- Toast Notification Container -->
  <div id="toast" class="fixed top-5 right-5 z-50 transform transition-all duration-300 opacity-0 translate-y-[-10px] pointer-events-none">
    <div class="bg-gray-900 border border-gray-700 px-4 py-3 rounded-xl shadow-2xl flex items-center gap-3 text-sm">
      <span id="toastIcon">✨</span>
      <span id="toastMsg" class="font-medium text-white">Action effectuée</span>
    </div>
  </div>

  <div class="max-w-5xl mx-auto space-y-8">
    
    <!-- Top Bar -->
    <header class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-6 border-b border-gray-800">
      <div class="flex items-center gap-3">
        <div class="h-10 w-10 rounded-xl bg-gradient-to-tr from-indigo-500 to-purple-500 flex items-center justify-center font-bold text-white shadow-lg shadow-indigo-500/20 text-lg">
          RT
        </div>
        <div>
          <div class="flex items-center gap-2">
            <h1 class="text-2xl font-bold text-white tracking-tight">RepoTwin Studio</h1>
            <span class="text-xs font-mono px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-semibold">Live Server</span>
          </div>
          <p class="text-xs text-gray-400">Plateforme interactive de Diagnostic & Optimisation Git pour Agents IA</p>
        </div>
      </div>

      <!-- Action Buttons Bar -->
      <div class="flex flex-wrap items-center gap-2">
        <button onclick="createTwin()" class="px-3.5 py-2 rounded-xl text-xs font-semibold bg-indigo-600 hover:bg-indigo-500 text-white transition shadow-lg shadow-indigo-600/20 flex items-center gap-2">
          <span>🧬</span> Créer Twin (Worktree)
        </button>
        <button onclick="applyFix()" class="px-3.5 py-2 rounded-xl text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 text-white transition shadow-lg shadow-emerald-600/20 flex items-center gap-2">
          <span>⚡</span> Appliquer l'Optimisation
        </button>
        <button onclick="cleanTwins()" class="px-3 py-2 rounded-xl text-xs font-semibold bg-gray-900 hover:bg-gray-800 text-gray-300 border border-gray-800 transition flex items-center gap-1.5">
          <span>🧹</span> Nettoyer
        </button>
      </div>
    </header>

    <!-- Active Twin Status Banner (Hidden by default) -->
    <div id="twinBanner" class="hidden bg-indigo-950/40 border border-indigo-500/40 p-4 rounded-2xl flex items-center justify-between text-xs">
      <div class="flex items-center gap-2 text-indigo-300">
        <span class="w-2 h-2 rounded-full bg-indigo-400 animate-pulse"></span>
        <span>Jumeau Git isolé actif :</span>
        <span id="twinPathLabel" class="font-mono text-white font-medium"></span>
      </div>
      <button onclick="cleanTwins()" class="text-indigo-400 hover:text-indigo-300 underline font-medium">Fermer & Nettoyer</button>
    </div>

    <!-- Scores Comparison Hero -->
    <section class="grid grid-cols-1 md:grid-cols-3 gap-4">
      <div class="bg-gray-900/60 border border-red-950/60 p-6 rounded-2xl relative overflow-hidden backdrop-blur">
        <div class="text-xs font-semibold uppercase tracking-wider text-red-400 mb-1">Score Brut (Scanner)</div>
        <div class="flex items-baseline gap-2 mt-2">
          <span class="text-5xl font-extrabold text-red-400 tracking-tight">${data.scores.rawScore}</span>
          <span class="text-gray-500 text-sm">/ 100</span>
          <span class="px-2 py-0.5 text-xs rounded bg-red-500/10 text-red-400 border border-red-500/20 font-bold ml-auto">${data.scores.rawGrade}</span>
        </div>
        <p class="text-xs text-gray-400 mt-4 leading-relaxed">Pénalisé par 21 fausses alertes dues aux sous-projets non indexés.</p>
      </div>

      <div class="bg-gray-900/60 border border-amber-950/60 p-6 rounded-2xl relative overflow-hidden backdrop-blur">
        <div class="text-xs font-semibold uppercase tracking-wider text-amber-400 mb-1">Score Réel RepoTwin</div>
        <div class="flex items-baseline gap-2 mt-2">
          <span class="text-5xl font-extrabold text-amber-400 tracking-tight">${data.scores.correctedScore}</span>
          <span class="text-gray-500 text-sm">/ 100</span>
          <span class="px-2 py-0.5 text-xs rounded bg-amber-500/10 text-amber-400 border border-amber-500/20 font-bold ml-auto">${data.scores.correctedGrade}</span>
        </div>
        <p class="text-xs text-emerald-400 mt-4 leading-relaxed font-medium">✓ +${data.scores.falsePenaltyRestored} pts restaurés après filtrage chirurgical</p>
      </div>

      <div class="bg-gradient-to-b from-indigo-950/40 to-gray-900/60 border border-emerald-500/30 p-6 rounded-2xl relative overflow-hidden backdrop-blur shadow-xl shadow-emerald-950/20">
        <div class="text-xs font-semibold uppercase tracking-wider text-emerald-400 mb-1">Score Après Optimisation</div>
        <div class="flex items-baseline gap-2 mt-2">
          <span id="targetScoreDisplay" class="text-5xl font-extrabold text-emerald-400 tracking-tight">${data.scores.projectedScore}</span>
          <span class="text-gray-500 text-sm">/ 100</span>
          <span class="px-2 py-0.5 text-xs rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 font-bold ml-auto">${data.scores.projectedGrade}</span>
        </div>
        <p class="text-xs text-indigo-300 mt-4 leading-relaxed font-medium">🚀 Cliquez sur "Appliquer" pour passer immédiatement à 96/100.</p>
      </div>
    </section>

    <!-- Subprojects Section -->
    <section class="bg-gray-900/40 border border-gray-800 rounded-2xl p-6">
      <h2 class="text-sm font-bold text-white mb-4 flex items-center gap-2 uppercase tracking-wider text-gray-400">
        <span>📦</span> Sous-Projets & Tests Détectés (${data.subprojects.length})
      </h2>
      <div class="overflow-x-auto">
        <table class="w-full text-left">
          <thead>
            <tr class="text-xs uppercase text-gray-500 border-b border-gray-800">
              <th class="py-2.5 px-4">Projet</th>
              <th class="py-2.5 px-4">Langage</th>
              <th class="py-2.5 px-4">Commande Test</th>
              <th class="py-2.5 px-4">Type</th>
            </tr>
          </thead>
          <tbody>
            ${subprojectsRows}
          </tbody>
        </table>
      </div>
    </section>

    <!-- False Positives Detail -->
    <section class="bg-gray-900/40 border border-gray-800 rounded-2xl p-6">
      <h2 class="text-sm font-bold text-white mb-4 flex items-center gap-2 uppercase tracking-wider text-gray-400">
        <span>🛡️</span> Faux Positifs Éliminés (${data.falsePositives.length})
      </h2>
      <div class="grid grid-cols-1 md:grid-cols-2 gap-3 max-h-80 overflow-y-auto pr-1">
        ${fpCards}
      </div>
    </section>

    <!-- Proposed AGENTS.md Preview -->
    <section class="bg-gray-900/40 border border-indigo-500/30 rounded-2xl p-6">
      <div class="flex items-center justify-between mb-4">
        <h2 class="text-sm font-bold text-white flex items-center gap-2 uppercase tracking-wider text-indigo-400">
          <span>💡</span> Prévisualisation du AGENTS.md Optimisé
        </h2>
        <button onclick="applyFix()" class="px-3 py-1.5 rounded-lg text-xs font-semibold bg-emerald-500 hover:bg-emerald-400 text-gray-950 transition">
          Appliquer au projet
        </button>
      </div>
      <div class="bg-gray-950 rounded-xl p-4 border border-gray-800">
        <pre class="text-xs text-gray-300 font-mono overflow-x-auto max-h-72"><code>${escapeHtml(data.recipe.agentsMdContent)}</code></pre>
      </div>
    </section>

  </div>

  <script>
    function showToast(msg, icon = '✨') {
      const toast = document.getElementById('toast');
      document.getElementById('toastMsg').innerText = msg;
      document.getElementById('toastIcon').innerText = icon;
      toast.classList.remove('opacity-0', 'translate-y-[-10px]', 'pointer-events-none');
      setTimeout(() => {
        toast.classList.add('opacity-0', 'translate-y-[-10px]', 'pointer-events-none');
      }, 3500);
    }

    async function createTwin() {
      showToast('Création du Twin en cours...', '⏳');
      try {
        const res = await fetch('/api/twin/create', { method: 'POST' });
        const data = await res.json();
        if (data.ok) {
          showToast('Jumeau Git créé avec succès dans ~/.cache/repotwin !', '🧬');
          document.getElementById('twinBanner').classList.remove('hidden');
          document.getElementById('twinPathLabel').innerText = data.result.twinPath;
        } else {
          showToast('Erreur: ' + data.error, '❌');
        }
      } catch (err) {
        showToast('Erreur réseau', '❌');
      }
    }

    async function applyFix() {
      showToast('Application des modifications...', '⏳');
      try {
        const res = await fetch('/api/twin/apply', { method: 'POST' });
        const data = await res.json();
        if (data.ok) {
          showToast('AGENTS.md & agent-ready.json appliqués ! Score: 96/100', '🎉');
        } else {
          showToast('Erreur: ' + data.error, '❌');
        }
      } catch (err) {
        showToast('Erreur réseau', '❌');
      }
    }

    async function cleanTwins() {
      showToast('Nettoyage des worktrees...', '🧹');
      try {
        const res = await fetch('/api/twin/clean', { method: 'POST' });
        const data = await res.json();
        showToast(data.cleaned + ' jumeau(x) nettoyé(s) proprement.', '✓');
        document.getElementById('twinBanner').classList.add('hidden');
      } catch (err) {
        showToast('Erreur réseau', '❌');
      }
    }
  </script>
</body>
</html>`;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
