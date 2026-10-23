import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { analyzeRepository } from '../analyzer/analyze-repository.js';
import { applyRecipe } from '../generator/apply-recipe.js';
import { GeneratedRecipe } from '../generator/recipe-agents-md.js';
import { discoverSubprojects } from '../analyzer/subproject-scanner.js';
import { generateOptimizationRecipe } from '../generator/recipe-agents-md.js';
import { createCandidateTwin, cleanCandidateIgnoredArtifacts, cleanTwins } from '../twin/worktree-manager.js';
import { candidateIsIntact, TwinResult } from '../twin/worktree-manager.js';
import { auditInstructions } from '../analyzer/instruction-audit.js';
import { SubprojectInfo } from '../types/index.js';
import { buildValidationPlan, runValidationPlan, validationConsentToken, ValidationCommand, ValidationResult } from '../verification/command-runner.js';

export function startDevServer(repoPath: string, port = 4242, reportPath?: string) {
  const sessionToken = crypto.randomBytes(32).toString('hex');
  let candidate: {
    recipe: GeneratedRecipe;
    twin: TwinResult;
    projects: SubprojectInfo[];
    before: ReturnType<typeof auditInstructions>;
    validationPlan: ValidationCommand[];
    consentToken: string;
    commandResults: ValidationResult[];
    verified: boolean;
  } | undefined;
  let busy = false;
  const server = http.createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'nonce-" + sessionToken + "' https://cdn.tailwindcss.com; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
    const address = server.address();
    const boundPort = address && typeof address !== 'string' ? address.port : port;
    const hosts = [`127.0.0.1:${boundPort}`, `localhost:${boundPort}`];
    if (!req.headers.host || !hosts.includes(req.headers.host)) {
      res.writeHead(403); res.end('Forbidden host'); return;
    }
    if (req.method !== 'GET' && (req.method !== 'POST' ||
      req.headers['x-repotwin-token'] !== sessionToken ||
      req.headers.origin !== `http://${req.headers.host}`)) {
      res.writeHead(403); res.end('Forbidden request');
      return;
    }
    const isMutation = req.method === 'POST';
    if (isMutation && busy) {
      res.writeHead(409, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'Une autre action est en cours. Attendez sa fin.' }));
      return;
    }
    if (isMutation) busy = true;
    const pathname = (req.url || '/').split('?')[0] ?? '/';
    try {
    const url = new URL(req.url || '/', `http://localhost:${boundPort}`);

    // API: Create Twin
    if (url.pathname === '/api/twin/create' && req.method === 'POST') {
      try {
        candidate = undefined;
        const subprojects = discoverSubprojects(repoPath);
        const before = auditInstructions(repoPath, subprojects);
        const recipe = generateOptimizationRecipe(repoPath, subprojects, []);
        const result = createCandidateTwin(repoPath, recipe);
        const validationPlan = buildValidationPlan(subprojects);
        const consentToken = validationConsentToken(validationPlan, sessionToken);
        candidate = { recipe, twin: result, projects: subprojects, before, validationPlan, consentToken, commandResults: [], verified: false };

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          ok: true,
          result: {
            ...result,
            status: 'created',
            before,
            validationPlan,
            scriptBodies: describeScripts(result.twinPath, validationPlan),
            consentToken,
            testsExecuted: false
          }
        }));
      } catch (err: any) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: err.message }));
      }
      return;
    }

    if (url.pathname === '/api/twin/verify' && req.method === 'POST') {
      if (!candidate) { res.writeHead(409); res.end(JSON.stringify({ ok: false, error: 'Create a candidate first' })); return; }
      candidate.verified = false;
      if (!candidateIsIntact(repoPath, candidate.twin)) throw new Error('Candidate changed. Create a new candidate before verifying.');
      if (candidate.validationPlan.length > 0 && req.headers['x-repotwin-command-consent'] !== candidate.consentToken) {
        res.writeHead(409, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'Explicit consent for the displayed project commands is required.' }));
        return;
      }
      const after = auditInstructions(candidate.twin.twinPath, candidate.projects);
      const introduced = after.findings.filter(f => !candidate!.before.findings.some(old => old.rule === f.rule && old.message === f.message));
      const resolved = candidate.before.findings.filter(f => !after.findings.some(current => current.rule === f.rule && current.message === f.message));
      candidate.commandResults = await runValidationPlan(candidate.twin.twinPath, candidate.validationPlan);
      const commandsPassed = candidate.commandResults.every(result => result.status === 'passed');
      let cleanedArtifacts: string[] = [];
      let cleanupError: string | undefined;
      try {
        cleanedArtifacts = cleanCandidateIgnoredArtifacts(repoPath, candidate.twin);
      } catch (error) {
        cleanupError = error instanceof Error ? error.message : 'Candidate cleanup failed';
      }
      const candidateIntact = candidateIsIntact(repoPath, candidate.twin);
      candidate.verified = introduced.length === 0 && commandsPassed && candidateIntact && !cleanupError;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        ok: true,
        result: {
          passed: candidate.verified,
          scope: candidate.validationPlan.length ? 'instruction-files-and-project-commands' : 'instruction-files',
          before: candidate.before,
          after,
          introduced,
          resolved,
          commandResults: candidate.commandResults,
          commandsPassed,
          candidateIntact,
          cleanedArtifacts,
          cleanupError,
          testsExecuted: candidate.commandResults.some(result => result.kind === 'test' && result.status !== 'unavailable')
        }
      }));
      return;
    }

    // API: Apply Fix
    if (url.pathname === '/api/twin/apply' && req.method === 'POST') {
      try {
        if (!candidate) throw new Error('Create and review a candidate first');
        if (!candidate.verified) throw new Error('Run candidate verification first');
        if (!candidateIsIntact(repoPath, candidate.twin)) throw new Error('Candidate changed after verification');
        const recipe = generateOptimizationRecipe(repoPath, discoverSubprojects(repoPath), []);
        if (recipe.agentsMdContent !== candidate.recipe.agentsMdContent || recipe.agentReadyJsonContent !== candidate.recipe.agentReadyJsonContent) {
          throw new Error('Repository changed since candidate creation. Create and review a new candidate.');
        }
        const backupDir = applyRecipe(repoPath, candidate.recipe);
        candidate = undefined;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, backupDir }));
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
        candidate = undefined;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, ...cleaned }));
      } catch (err: any) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: err.message }));
      }
      return;
    }

    // Serve HTML Dashboard
    if (url.pathname === '/' || url.pathname === '/index.html') {
      const html = renderInteractiveStudio(analyzeRepository(repoPath, reportPath), sessionToken);

      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
      return;
    }

    res.writeHead(404);
    res.end('Not found');
    } catch (error) {
      const isApi = pathname.startsWith('/api/');
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        ok: false,
        error: isApi && error instanceof Error ? error.message : 'Analysis failed. Check the repository and report format.'
      }));
    } finally {
      if (isMutation) busy = false;
    }
  });

  const maxPortAttempts = 10;
  let currentPort = port;
  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE' && port !== 0 && currentPort < port + maxPortAttempts - 1) {
      currentPort += 1;
      console.warn(`\x1b[33m⚠️  Port ${currentPort - 1} déjà utilisé. Essai sur ${currentPort}...\x1b[0m`);
      server.listen(currentPort, '127.0.0.1');
    } else {
      console.error('Erreur Studio RepoTwin:', err.message);
    }
  });

  server.once('listening', () => {
    const address = server.address();
    const boundPort = address && typeof address !== 'string' ? address.port : currentPort;
    const studioUrl = `http://127.0.0.1:${boundPort}`;
    console.log(`\n🚀 RepoTwin Studio actif sur : \x1b[36m${studioUrl}\x1b[0m`);
    console.log(`Boutons d'action en direct : Créer Twin, Appliquer Fix, Nettoyer.`);

    // Automatically open in browser for interactive user sessions
    if (!process.env.VITEST && process.env.NODE_ENV !== 'test') {
      try {
        const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
        execFileSync(cmd, [studioUrl], { stdio: 'ignore' });
      } catch {
        // ignore if headless
      }
    }
  });

  server.listen(currentPort, '127.0.0.1');

  return server;
}

function renderInteractiveStudio(input: ReturnType<typeof analyzeRepository>, token: string): string {
  const data = {
    ...input,
    subprojects: input.subprojects.map(sub => ({
      ...sub,
      name: escapeHtml(sub.name),
      relPath: escapeHtml(sub.relPath),
      kind: escapeHtml(sub.kind),
      testScript: sub.testScript ? escapeHtml(sub.testScript) : undefined,
      lintScript: sub.lintScript ? escapeHtml(sub.lintScript) : undefined,
      buildScript: sub.buildScript ? escapeHtml(sub.buildScript) : undefined
    })),
    falsePositives: input.falsePositives.map(fp => ({ ...fp, classification: escapeHtml(fp.classification), targetRef: fp.targetRef ? escapeHtml(fp.targetRef) : undefined, raw: { ...fp.raw, message: escapeHtml(fp.raw.message) }, explanation: escapeHtml(fp.explanation) }))
  };
  const repoName = escapeHtml(path.basename(data.repoPath));
  const approxTokens = (text: string) => Math.ceil(text.length / 4);
  const currentAgentsPath = path.join(data.repoPath, 'AGENTS.md');
  const currentAgents = fs.existsSync(currentAgentsPath) ? fs.readFileSync(currentAgentsPath, 'utf-8') : '';
  const currentTokens = currentAgents ? approxTokens(currentAgents) : 0;
  const proposedTokens = approxTokens(data.recipe.agentsMdContent);
  const tokenDelta = proposedTokens - currentTokens;

  const subprojectsRows = data.subprojects.map((sub: any) => {
    const commands = [sub.testScript, sub.lintScript, sub.buildScript].filter(Boolean);
    return `
    <tr class="border-b border-zinc-800/60 hover:bg-zinc-900/60 transition">
      <td class="py-3 px-4 font-medium text-zinc-100 flex items-center gap-2">
        <span class="w-1.5 h-1.5 rounded-full ${sub.testScript ? 'bg-emerald-400 ring-2 ring-emerald-400/20' : 'bg-amber-400 ring-2 ring-amber-400/20'}"></span>
        <span>${sub.name}</span>
        <span class="text-[11px] text-zinc-500 font-mono">(${sub.relPath}/)</span>
      </td>
      <td class="py-3 px-4 text-zinc-400 font-mono text-xs">${sub.kind}</td>
      <td class="py-3 px-4 font-mono text-xs">
        ${commands.length ? commands.map((command: string) => `<span class="inline-block mr-1 mb-1 px-2 py-0.5 rounded bg-zinc-950 text-emerald-400 border border-zinc-800">${command}</span>`).join('') : '<span class="text-zinc-500">Aucune validation</span>'}
      </td>
      <td class="py-3 px-4 text-zinc-400 text-xs">
        <span class="px-2 py-0.5 rounded text-[11px] font-medium bg-zinc-900 text-zinc-400 border border-zinc-800">
          ${sub.isSubmodule ? 'Git Submodule' : 'Dossier'}
        </span>
      </td>
    </tr>
  `;
  }).join('');

  const fpCards = data.falsePositives.map((fp: any) => `
    <div class="p-3 bg-zinc-900/50 border border-zinc-800/80 rounded-xl flex items-start gap-3 text-xs hover:border-zinc-700/80 transition">
      <span class="px-2 py-0.5 rounded-md text-[10px] font-mono font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 shrink-0">
        ${fp.classification}
      </span>
      <div class="min-w-0 flex-1">
        <div class="font-mono text-zinc-200 font-medium truncate">${fp.targetRef || fp.raw.message}</div>
        <div class="text-zinc-400 text-[11px] mt-0.5 leading-relaxed">${fp.explanation}</div>
      </div>
    </div>
  `).join('');

  return `<!DOCTYPE html>
<html lang="fr" class="dark">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>RepoTwin Studio — ${repoName}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet">
  <script nonce="${token}" src="https://cdn.tailwindcss.com"></script>
  <script nonce="${token}">
    tailwind.config = {
      darkMode: 'class',
      theme: {
        extend: {
          colors: {
            zinc: {
              950: '#09090b',
              900: '#18181b',
              850: '#202023',
              800: '#27272a',
              700: '#3f3f46',
              600: '#52525b',
              500: '#71717a',
              400: '#a1a1aa',
              300: '#d4d4d8',
              200: '#e4e4e7',
              100: '#f4f4f5',
              50: '#fafafa'
            }
          },
          fontFamily: {
            sans: ['Inter', '-apple-system', 'BlinkMacSystemFont', 'system-ui', 'sans-serif'],
            mono: ['JetBrains Mono', 'monospace']
          }
        }
      }
    };
  </script>
  <style>
    :root {
      color-scheme: dark;
    }
    body {
      background-color: #09090b;
      color: #fafafa;
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, system-ui, sans-serif;
      -webkit-font-smoothing: antialiased;
    }
    code, pre {
      font-family: 'JetBrains Mono', monospace;
    }
    /* Shadcn Card base fallback */
    .shadcn-card {
      background-color: rgba(24, 24, 27, 0.65);
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 0.75rem;
      backdrop-filter: blur(8px);
    }
    .shadcn-card:hover {
      border-color: rgba(255, 255, 255, 0.14);
    }
    /* Custom scrollbar */
    ::-webkit-scrollbar { width: 6px; height: 6px; }
    ::-webkit-scrollbar-track { background: #09090b; }
    ::-webkit-scrollbar-thumb { background: #27272a; border-radius: 3px; }
    ::-webkit-scrollbar-thumb:hover { background: #3f3f46; }
    .hidden { display: none !important; }
  </style>
</head>
<body class="bg-zinc-950 text-zinc-100 min-h-screen py-10 px-4 sm:px-6 lg:px-8 selection:bg-zinc-800 selection:text-white">

  <!-- Toast Notification Container -->
  <div id="toast" class="fixed top-5 right-5 z-50 transform transition-all duration-300 opacity-0 translate-y-[-10px] pointer-events-none">
    <div class="bg-zinc-900 border border-zinc-700/80 px-4 py-3 rounded-xl shadow-2xl flex items-center gap-3 text-sm text-zinc-100 backdrop-blur">
      <span id="toastIcon">✨</span>
      <span id="toastMsg" class="font-medium text-white">Action effectuée</span>
    </div>
  </div>

  <div class="max-w-5xl mx-auto space-y-8">
    
    <!-- Top Bar -->
    <header class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-6 border-b border-zinc-800">
      <div class="flex items-center gap-3">
        <div class="h-10 w-10 rounded-xl bg-zinc-900 border border-zinc-700/80 flex items-center justify-center font-bold text-white shadow-sm text-sm tracking-tight font-mono">
          RT
        </div>
        <div>
          <div class="flex items-center gap-2">
            <h1 class="text-xl font-semibold text-zinc-100 tracking-tight">RepoTwin Studio</h1>
            <span class="text-[11px] font-mono px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-medium">Local Live</span>
          </div>
          <p class="text-xs text-zinc-400 mt-0.5">Diagnostic & Optimisation Git pour Agents IA (Cursor, Codex, Gemini)</p>
          <p class="text-xs text-zinc-300 mt-1 font-mono break-all">${escapeHtml(data.repoPath)}</p>
        </div>
      </div>

      <!-- Action Buttons Bar (Shadcn style) -->
      <div class="flex flex-wrap items-center gap-2">
        <button id="createTwinBtn" onclick="createTwin()" class="px-3.5 py-2 rounded-lg text-xs font-medium bg-zinc-100 hover:bg-zinc-200 text-zinc-900 transition-all shadow-sm flex items-center gap-2 active:scale-[0.98]">
          <span>🧬</span> 1. Créer Twin (Worktree)
        </button>
        <button id="verifyBtn" onclick="verifyTwin()" disabled class="px-3.5 py-2 rounded-lg text-xs font-medium bg-zinc-900 text-zinc-200 border border-zinc-800">2. Vérifier le candidat</button>
        <button id="applyBtn" onclick="applyFix()" disabled class="px-3.5 py-2 rounded-lg text-xs font-medium bg-zinc-900 text-zinc-500 cursor-not-allowed border border-zinc-800 transition-all flex items-center gap-2" title="Créez d'abord un Twin pour tester et débloquer l'application">
          <span>⚡</span> 3. Appliquer
          <span id="applyBadge" class="text-[10px] bg-zinc-950 text-zinc-500 px-1.5 py-0.5 rounded border border-zinc-800 font-mono">Twin requis</span>
        </button>
        <button onclick="cleanTwins()" class="px-3 py-2 rounded-lg text-xs font-medium bg-zinc-900/80 hover:bg-zinc-800 text-zinc-300 border border-zinc-800 transition-all flex items-center gap-1.5 active:scale-[0.98]">
          <span>🧹</span> Nettoyer
        </button>
      </div>
    </header>

    <!-- Active Twin Status Banner (Hidden by default, shown when verified) -->
    <div id="twinBanner" class="hidden bg-zinc-900/90 border border-emerald-500/40 p-4 rounded-xl flex items-center justify-between text-xs backdrop-blur shadow-sm">
      <div class="flex items-center gap-3 text-zinc-300">
        <span class="w-2 h-2 rounded-full bg-emerald-400 animate-pulse shrink-0"></span>
        <div>
          <div class="flex items-center gap-2">
            <span class="font-medium text-zinc-100">Candidat isolé depuis HEAD :</span>
            <span id="twinPathLabel" class="font-mono text-emerald-400 font-medium"></span>
          </div>
          <div id="twinVerifiedBadge" class="text-[11px] text-zinc-400 mt-0.5">En attente de vérification. Aucune commande exécutée.</div>
        </div>
      </div>
      <button onclick="cleanTwins()" class="text-zinc-400 hover:text-zinc-200 underline font-medium ml-4 shrink-0">Fermer & Nettoyer</button>
    </div>

    <!-- Scores Comparison Hero (Shadcn Card Grid) -->
    <section class="grid grid-cols-1 md:grid-cols-3 gap-4">
      <div class="bg-zinc-900/50 border border-red-500/20 hover:border-red-500/40 rounded-xl p-5 transition-all shadow-sm relative overflow-hidden backdrop-blur">
        <div class="text-[11px] font-medium uppercase tracking-wider text-red-400/90 mb-1">Rapport importé · score recalculé</div>
        <div class="flex items-baseline gap-2 mt-2">
          <span class="text-4xl font-extrabold text-red-400 tracking-tight">${data.scores.evaluated ? data.scores.rawScore : 'Non évalué'}</span>
          <span class="text-zinc-500 text-sm">/ 100</span>
          <span class="px-2 py-0.5 text-[11px] rounded-full bg-red-500/10 text-red-400 border border-red-500/20 font-bold ml-auto">${data.scores.evaluated ? data.scores.rawGrade : '-'}</span>
        </div>
        <p class="text-xs text-zinc-400 mt-4 leading-relaxed">Pénalisé par ${data.falsePositives.length} fausses alertes dues aux sous-projets non indexés.</p>
      </div>

      <div class="bg-zinc-900/50 border border-amber-500/20 hover:border-amber-500/40 rounded-xl p-5 transition-all shadow-sm relative overflow-hidden backdrop-blur">
        <div class="text-[11px] font-medium uppercase tracking-wider text-amber-400/90 mb-1">Instructions · contrôle initial</div>
        <div class="flex items-baseline gap-2 mt-2">
          <span class="text-4xl font-extrabold text-amber-400 tracking-tight">${data.instructionAudit.scores.correctedScore}</span>
          <span class="text-zinc-500 text-sm">/ 100</span>
          <span class="px-2 py-0.5 text-[11px] rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/20 font-bold ml-auto">${data.instructionAudit.scores.correctedGrade}</span>
        </div>
        <p class="text-xs text-zinc-400 mt-4 leading-relaxed">${data.instructionAudit.findings.length} constat(s). Vérifie la présence des sections attendues dans AGENTS.md, pas la qualité du code ni l'efficacité d'un agent.</p>
      </div>

      <div class="bg-zinc-900/60 border border-emerald-500/30 hover:border-emerald-500/50 rounded-xl p-5 transition-all shadow-sm relative overflow-hidden backdrop-blur">
        <div class="text-[11px] font-medium uppercase tracking-wider text-emerald-400/90 mb-1">Candidat · preuves collectées</div>
        <div class="flex items-baseline gap-2 mt-2">
          <span id="targetScoreDisplay" class="text-2xl font-extrabold text-emerald-400">Non vérifié</span>
          <span class="text-zinc-500 text-sm">/ 100</span>
          <span id="targetGrade" class="px-2 py-0.5 text-xs text-emerald-300">-</span>
        </div>
        <p id="verificationStatus" class="text-xs text-zinc-400 mt-4">Aucune validation exécutée.</p>
      </div>
    </section>

    <section class="border border-zinc-800 rounded-lg p-5">
      <h2 class="text-sm font-semibold text-zinc-200 mb-3">Constats documentaires initiaux</h2>
      <ul class="text-xs text-zinc-300 space-y-2">
        ${data.instructionAudit.findings.length ? data.instructionAudit.findings.map(finding => `<li><code>${escapeHtml(finding.file)}</code> : ${escapeHtml(finding.message)}</li>`).join('') : '<li>Aucun constat sur les contrôles documentaires couverts.</li>'}
      </ul>
    </section>

    <!-- Static repository observations -->
    <section class="bg-zinc-900/40 border border-emerald-500/20 rounded-xl p-6 backdrop-blur shadow-sm">
      <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-4">
        <div>
          <h2 class="text-xs font-semibold text-zinc-200 flex items-center gap-2 uppercase tracking-wider">
            <span>⚡</span> Observations du dépôt
          </h2>
          <p class="text-xs text-zinc-400 mt-1">Rapport importé et fichiers inspectés localement. Économies de tokens et productivité non mesurées.</p>
        </div>
        <span class="px-2.5 py-1 rounded-full text-[11px] font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 shrink-0 font-mono">
          Analyse statique
        </span>
      </div>

      <div class="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
        <div class="p-4 bg-zinc-950/70 border border-zinc-800/80 rounded-lg">
          <div class="text-zinc-400 font-medium text-[11px]">Références reclassées</div>
          <div class="text-2xl font-bold text-emerald-400 mt-1">${data.falsePositives.length}</div>
          <div class="text-[11px] text-zinc-400 mt-1">Constats du rapport importé reclassés par les heuristiques de RepoTwin.</div>
        </div>
        <div class="p-4 bg-zinc-950/70 border border-zinc-800/80 rounded-lg">
          <div class="text-zinc-400 font-medium text-[11px]">Taille de AGENTS.md (chargé à chaque prompt)</div>
          <div class="text-2xl font-bold text-indigo-400 mt-1">~${currentTokens} → ~${proposedTokens} tokens</div>
          <div class="text-[11px] text-zinc-400 mt-1">${tokenDelta > 0 ? `+${tokenDelta} tokens par prompt : la proposition ajoute du contexte, elle n'en retire pas.` : `${tokenDelta} tokens par prompt.`} Estimation car./4.</div>
        </div>
        <div class="p-4 bg-zinc-950/70 border border-zinc-800/80 rounded-lg">
          <div class="text-zinc-400 font-medium text-[11px]">Projets avec validation déclarée</div>
          <div class="text-2xl font-bold text-purple-400 mt-1">${data.subprojects.filter((s: any) => s.testScript || s.lintScript || s.buildScript).length} / ${data.subprojects.length} projets</div>
          <div class="text-[11px] text-zinc-400 mt-1">Tests, lint et builds détectés dans les manifests. Aucun lancement automatique.</div>
        </div>
      </div>
    </section>

    <!-- Subprojects Section -->
    <section class="bg-zinc-900/40 border border-zinc-800 rounded-xl p-6 shadow-sm">
      <h2 class="text-xs font-semibold text-zinc-300 mb-4 flex items-center gap-2 uppercase tracking-wider">
        <span>📦</span> Sous-Projets & Validations Détectées (${data.subprojects.length})
      </h2>
      <div class="overflow-x-auto border border-zinc-800/80 rounded-lg bg-zinc-950/40">
        <table class="w-full text-left">
          <thead>
            <tr class="text-[11px] uppercase font-medium text-zinc-400 border-b border-zinc-800/80 bg-zinc-900/50">
              <th class="py-2.5 px-4">Projet</th>
              <th class="py-2.5 px-4">Langage</th>
              <th class="py-2.5 px-4">Commandes proposées</th>
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
    <section class="bg-zinc-900/40 border border-zinc-800 rounded-xl p-6 shadow-sm">
      <h2 class="text-xs font-semibold text-zinc-300 mb-4 flex items-center gap-2 uppercase tracking-wider">
        <span>🛡️</span> Faux Positifs Éliminés (${data.falsePositives.length})
      </h2>
      <div class="grid grid-cols-1 md:grid-cols-2 gap-2.5 max-h-80 overflow-y-auto pr-1">
        ${fpCards}
      </div>
    </section>

    <!-- Real Git Diff from Candidate Twin (Shown when Twin is created) -->
    <section id="diffSection" class="hidden bg-zinc-900/40 border border-zinc-800 rounded-xl p-6 shadow-sm">
      <div class="flex items-center justify-between mb-4">
        <h2 class="text-xs font-semibold text-zinc-300 flex items-center gap-2 uppercase tracking-wider">
          <span>🔍</span> 2. Proposition & Diff Git Réel du Candidat
        </h2>
        <span class="text-[10px] bg-zinc-950 text-emerald-400 border border-zinc-800 px-2 py-0.5 rounded font-mono">
          git diff --no-color
        </span>
      </div>
      <div class="bg-zinc-950 rounded-lg p-4 border border-zinc-800/80">
        <pre id="diffContent" class="text-xs text-zinc-300 font-mono overflow-x-auto max-h-72"></pre>
      </div>
    </section>

    <section id="validationPlanSection" class="hidden bg-zinc-900/40 border border-amber-500/25 rounded-xl p-6 shadow-sm">
      <div class="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <div>
          <h2 class="text-sm font-semibold text-zinc-100">Vérifications proposées</h2>
          <p class="text-xs text-zinc-400 mt-1">RepoTwin n'exécutera ces commandes que lorsque vous confirmerez l'étape 2.</p>
        </div>
        <span id="validationPlanBadge" class="text-[10px] px-2 py-1 rounded border border-amber-500/20 bg-amber-500/10 text-amber-300">Consentement requis</span>
      </div>
      <div id="validationPlanList" class="mt-4 space-y-2"></div>
      <p class="text-[11px] text-zinc-500 mt-4">Exécution locale dans le twin, sans shell, avec environnement réduit, sortie limitée et délai maximal. Si un lockfile est présent, une installation reproductible (npm ci…) est d'abord lancée : elle utilise le réseau et exécute les scripts d'installation des dépendances. Une commande du projet peut accéder aux ressources accessibles à votre utilisateur.</p>
    </section>

    <section id="verificationSection" class="hidden border border-zinc-800 rounded-lg p-6">
      <h2 class="text-sm font-semibold text-zinc-200">Résultats vérifiables</h2>
      <div id="commandResults" class="mt-4 space-y-2"></div>
      <pre id="verificationDetails" class="text-xs text-zinc-300 whitespace-pre-wrap overflow-x-auto mt-4"></pre>
    </section>

    <!-- Proposed AGENTS.md Preview -->
    <section class="bg-zinc-900/40 border border-zinc-800 rounded-xl p-6 shadow-sm">
      <div class="flex items-center justify-between mb-4">
        <h2 class="text-xs font-semibold text-zinc-300 flex items-center gap-2 uppercase tracking-wider">
          <span>💡</span> Prévisualisation du AGENTS.md Optimisé
        </h2>
        <span class="text-xs text-zinc-400">Consultez le diff puis vérifiez le candidat.</span>
      </div>
      <div class="bg-zinc-950 rounded-lg p-4 border border-zinc-800/80">
        <pre class="text-xs text-zinc-300 font-mono overflow-x-auto max-h-72"><code>${escapeHtml(data.recipe.agentsMdContent)}</code></pre>
      </div>
    </section>

  </div>

  <script nonce="${token}">
    const sessionToken = '${token}';
    let candidateValidationPlan = [];
    let candidateScriptBodies = {};
    let candidateConsentToken = '';
    document.querySelectorAll('[onclick]').forEach(element => {
      const action = element.getAttribute('onclick');
      element.removeAttribute('onclick');
      element.addEventListener('click', () => {
        if (action === 'createTwin()') createTwin();
        if (action === 'verifyTwin()') verifyTwin();
        if (action === 'applyFix()') applyFix();
        if (action === 'cleanTwins()') cleanTwins();
      });
    });
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
      document.getElementById('applyBtn').disabled = true;
      document.getElementById('verifyBtn').disabled = true;
      document.getElementById('targetScoreDisplay').innerText = 'Non vérifié';
      document.getElementById('targetGrade').innerText = '-';
      document.getElementById('verificationStatus').innerText = 'Vérification requise. Aucune commande exécutée.';
      document.getElementById('verificationSection').classList.add('hidden');
      document.getElementById('validationPlanSection').classList.add('hidden');
      document.getElementById('diffSection').classList.add('hidden');
      showToast('Création du candidat...', '⏳');
      try {
        const res = await fetch('/api/twin/create', { method: 'POST', headers: { 'X-RepoTwin-Token': sessionToken } });
        const data = await res.json();
        if (data.ok) {
          showToast('Candidat créé. Consultez le diff, puis lancez la vérification.', '✓');
          document.getElementById('twinBanner').classList.remove('hidden');
          document.getElementById('twinPathLabel').innerText = data.result.twinPath;
          candidateValidationPlan = data.result.validationPlan || [];
          candidateScriptBodies = data.result.scriptBodies || {};
          candidateConsentToken = data.result.consentToken || '';
          const warnings = data.result.submoduleWarnings || [];
          const initialized = data.result.submodulesInitialized || [];
          document.getElementById('twinVerifiedBadge').innerText = 'Candidat créé depuis HEAD. Aucune commande exécutée.'
            + (initialized.length ? ' Submodules copiés localement : ' + initialized.join(', ') + '.' : '')
            + (warnings.length ? ' ⚠️ Submodules manquants (leurs commandes échoueront) : ' + warnings.join(' ; ') : '');

          if (data.result.diff) {
            document.getElementById('diffSection').classList.remove('hidden');
            document.getElementById('diffContent').innerText = data.result.diff;
          }

          renderValidationPlan(candidateValidationPlan);

          document.getElementById('verifyBtn').disabled = false;
          document.getElementById('verifyBtn').innerText = candidateValidationPlan.length
            ? '2. Autoriser & vérifier (' + candidateValidationPlan.length + ')'
            : '2. Vérifier les instructions';
          document.getElementById('applyBadge').innerText = 'Vérification requise';
        } else {
          showToast('Erreur: ' + data.error, '❌');
        }
      } catch (err) {
        showToast('Erreur réseau', '❌');
      }
    }

    async function verifyTwin() {
      if (candidateValidationPlan.length) {
        const commands = candidateValidationPlan.map(item => item.relPath + ': ' + item.display + (candidateScriptBodies[item.id] ? '  →  ' + candidateScriptBodies[item.id] : '')).join('\\n');
        const accepted = confirm('RepoTwin va exécuter ces commandes dans la copie isolée :\\n\\n' + commands + '\\n\\nElles peuvent exécuter du code du projet et accéder au réseau. Continuer ?');
        if (!accepted) return;
      }
      document.getElementById('applyBtn').disabled = true;
      document.getElementById('targetScoreDisplay').innerText = 'Vérification...';
      document.getElementById('applyBadge').innerText = 'Vérification requise';
      try {
        const response = await fetch('/api/twin/verify', {
          method: 'POST',
          headers: {
            'X-RepoTwin-Token': sessionToken,
            'X-RepoTwin-Command-Consent': candidateConsentToken
          }
        });
        const data = await response.json();
        if (!data.ok) throw new Error(data.error);
        const check = data.result;
        document.getElementById('targetScoreDisplay').innerText = check.after.scores.correctedScore;
        document.getElementById('targetGrade').innerText = check.after.scores.correctedGrade;
        const passedCommands = (check.commandResults || []).filter(result => result.status === 'passed').length;
        const commandSummary = check.commandResults && check.commandResults.length
          ? passedCommands + '/' + check.commandResults.length + ' commande(s) réussie(s)'
          : 'aucune commande applicative déclarée';
        const summary = check.before.scores.correctedScore + ' → ' + check.after.scores.correctedScore + '/100 · ' + check.resolved.length + ' constat(s) résolu(s) · ' + commandSummary + '.';
        document.getElementById('verificationStatus').innerText = summary;
        document.getElementById('twinVerifiedBadge').innerText = summary;
        renderCommandResults(check.commandResults || []);
        document.getElementById('verificationDetails').textContent = JSON.stringify({ scope: check.scope, resolved: check.resolved, remaining: check.after.findings, introduced: check.introduced, candidateIntact: check.candidateIntact }, null, 2);
        document.getElementById('verificationSection').classList.remove('hidden');
        document.getElementById('applyBtn').disabled = !check.passed;
        document.getElementById('applyBtn').title = check.passed ? 'Appliquer le candidat vérifié' : 'Application bloquée : une vérification a échoué';
        document.getElementById('applyBadge').innerText = check.passed ? 'Candidat vérifié' : 'Vérification échouée';
        document.getElementById('validationPlanBadge').innerText = check.passed ? 'Vérifié' : 'À corriger';
        showToast(check.passed ? 'Candidat vérifié avec succès.' : 'Application bloquée : consultez les résultats.', check.passed ? '✓' : '!');
      } catch (error) { showToast(error.message || 'Vérification impossible', '!'); }
    }

    function renderValidationPlan(plan) {
      const section = document.getElementById('validationPlanSection');
      const list = document.getElementById('validationPlanList');
      list.replaceChildren();
      section.classList.remove('hidden');
      if (!plan.length) {
        const empty = document.createElement('p');
        empty.className = 'text-xs text-zinc-400';
        empty.textContent = 'Aucune commande applicative reconnue. La vérification portera sur les instructions.';
        list.appendChild(empty);
        document.getElementById('validationPlanBadge').innerText = 'Contrôle documentaire';
        return;
      }
      for (const item of plan) {
        const row = document.createElement('div');
        row.className = 'flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 rounded-lg border border-zinc-800 bg-zinc-950/70 px-3 py-2';
        const project = document.createElement('span');
        project.className = 'text-xs text-zinc-400';
        project.textContent = item.project + ' · ' + item.kind + ' · ' + item.relPath;
        const command = document.createElement('code');
        command.className = 'text-xs text-amber-300';
        command.textContent = item.display + (candidateScriptBodies[item.id] ? '  →  ' + candidateScriptBodies[item.id] : '');
        row.append(project, command);
        list.appendChild(row);
      }
      document.getElementById('validationPlanBadge').innerText = plan.length + ' commande(s) · consentement requis';
    }

    function renderCommandResults(results) {
      const container = document.getElementById('commandResults');
      container.replaceChildren();
      for (const result of results) {
        const details = document.createElement('details');
        details.className = 'rounded-lg border border-zinc-800 bg-zinc-950/70 px-3 py-2';
        const summary = document.createElement('summary');
        summary.className = 'cursor-pointer text-xs text-zinc-200';
        summary.textContent = (result.status === 'passed' ? '✓' : '×') + ' ' + result.project + ' · ' + result.display + ' · ' + result.status + ' · ' + result.durationMs + ' ms';
        const output = document.createElement('pre');
        output.className = 'mt-3 max-h-52 overflow-auto whitespace-pre-wrap text-[11px] text-zinc-400';
        output.textContent = result.output || '(aucune sortie)';
        details.append(summary, output);
        container.appendChild(details);
      }
    }

    async function applyFix() {
      if (!confirm('Appliquer la recette prévisualisée aux fichiers du dépôt avec sauvegarde ?')) return;
      showToast('Application des modifications...', '⏳');
      try {
        const res = await fetch('/api/twin/apply', { method: 'POST', headers: { 'X-RepoTwin-Token': sessionToken } });
        const data = await res.json();
        if (data.ok) {
          showToast('Fichiers appliqués avec sauvegarde. Relancez les vérifications.', '✓');
          document.getElementById('applyBadge').innerText = 'Appliqué localement';
          document.getElementById('applyBtn').disabled = true;
          document.getElementById('verifyBtn').disabled = true;
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
        const res = await fetch('/api/twin/clean', { method: 'POST', headers: { 'X-RepoTwin-Token': sessionToken } });
        const data = await res.json();
        if (!data.ok) throw new Error(data.error);
        showToast(data.cleaned + ' nettoyé(s), ' + data.skippedDirty + ' préservé(s).', '✓');
        document.getElementById('twinBanner').classList.add('hidden');
        document.getElementById('diffSection').classList.add('hidden');
        document.getElementById('verificationSection').classList.add('hidden');
        document.getElementById('validationPlanSection').classList.add('hidden');
        document.getElementById('verifyBtn').disabled = true;
        document.getElementById('verifyBtn').innerText = '2. Vérifier le candidat';
        document.getElementById('targetScoreDisplay').innerText = 'Non vérifié';
        document.getElementById('targetGrade').innerText = '-';
        document.getElementById('verificationStatus').innerText = 'Aucune validation exécutée.';
        candidateValidationPlan = [];
        candidateConsentToken = '';

        // Lock Apply button again
        const applyBtn = document.getElementById('applyBtn');
        applyBtn.disabled = true;
        applyBtn.className = 'px-3.5 py-2 rounded-lg text-xs font-medium bg-zinc-900 text-zinc-500 cursor-not-allowed border border-zinc-800 transition-all flex items-center gap-2';
        applyBtn.title = "Créez d'abord un Twin pour tester et débloquer l'application";
        document.getElementById('applyBadge').className = 'text-[10px] bg-zinc-950 text-zinc-500 px-1.5 py-0.5 rounded border border-zinc-800 font-mono';
        document.getElementById('applyBadge').innerText = 'Twin requis';
      } catch (err) {
        showToast('Erreur réseau', '❌');
      }
    }
  </script>
</body>
</html>`;
}

/** Maps each npm-based command to the script body found in the twin (HEAD). */
function describeScripts(twinPath: string, plan: ValidationCommand[]): Record<string, string> {
  const bodies: Record<string, string> = {};
  for (const command of plan) {
    if (command.executable !== 'npm' || command.args[0] !== 'run' || !command.args[1]) continue;
    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(twinPath, command.relPath, 'package.json'), 'utf-8'));
      const body = pkg?.scripts?.[command.args[1]];
      if (typeof body === 'string') bodies[command.id] = body.slice(0, 500);
    } catch {
      bodies[command.id] = '(package.json introuvable dans le twin)';
    }
  }
  return bodies;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
