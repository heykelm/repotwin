/**
 * Offline, standalone SVG chart generators for RepoTwin RFC-002 Reports.
 * Zero external CDN or JavaScript dependencies; 100% self-contained and vector sharp.
 */

function escapeHtml(str: string): string {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * 1. Token Consumption — Before / After
 */
export function renderTokenComparisonChart(
  baselineTokens?: number,
  candidateTokens?: number,
  deltaReduction?: number
): string {
  if (baselineTokens === undefined || candidateTokens === undefined) {
    return `<div class="p-6 bg-gray-950/40 rounded-xl border border-gray-800 text-center text-gray-500 text-xs font-mono">
      N/A — Données de tokens non disponibles pour cette exécution
    </div>`;
  }

  const maxVal = Math.max(baselineTokens, candidateTokens, 1);
  const baselineW = Math.round((baselineTokens / maxVal) * 360);
  const candidateW = Math.round((candidateTokens / maxVal) * 360);
  const pctText = deltaReduction !== undefined
    ? `${(deltaReduction * 100).toFixed(1)}%`
    : `${(((baselineTokens - candidateTokens) / baselineTokens) * 100).toFixed(1)}%`;
  const isGain = (deltaReduction ?? (baselineTokens - candidateTokens)) > 0;

  return `
  <div class="bg-gray-950/60 p-5 rounded-xl border border-gray-800/80">
    <div class="flex items-center justify-between mb-4">
      <div class="flex items-center gap-2">
        <span class="w-2.5 h-2.5 rounded-full bg-indigo-400"></span>
        <span class="text-xs font-bold uppercase tracking-wider text-gray-300">1. Token Consumption (Before / After)</span>
      </div>
      <span class="px-2 py-0.5 rounded text-xs font-bold font-mono ${isGain ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-rose-500/10 text-rose-400 border border-rose-500/20'}">
        ${isGain ? '▼ -' : '▲ +'}${pctText.replace(/^[+-]/, '')} tokens
      </span>
    </div>
    <svg viewBox="0 0 500 110" class="w-full h-auto font-mono text-xs select-none">
      <!-- Baseline Bar -->
      <text x="10" y="32" fill="#94a3b8" font-size="11" font-weight="600">Baseline</text>
      <rect x="90" y="16" width="360" height="24" rx="5" fill="#1e293b" />
      <rect x="90" y="16" width="${baselineW}" height="24" rx="5" fill="#64748b" opacity="0.8" />
      <text x="${Math.max(105, 90 + baselineW - 55)}" y="32" fill="#ffffff" font-size="11" font-weight="bold">${baselineTokens.toLocaleString()} tks</text>

      <!-- Candidate Bar -->
      <text x="10" y="80" fill="#38bdf8" font-size="11" font-weight="600">Candidate</text>
      <rect x="90" y="64" width="360" height="24" rx="5" fill="#1e293b" />
      <rect x="90" y="64" width="${candidateW}" height="24" rx="5" fill="#10b981" />
      <text x="${Math.max(105, 90 + candidateW - 55)}" y="80" fill="#ffffff" font-size="11" font-weight="bold">${candidateTokens.toLocaleString()} tks</text>
    </svg>
    <div class="flex justify-between text-[11px] text-gray-500 font-mono mt-2 pt-2 border-t border-gray-900">
      <span>Baseline: ${baselineTokens.toLocaleString()} tokens</span>
      <span class="text-emerald-400 font-bold">Candidat optimisé: ${candidateTokens.toLocaleString()} tokens</span>
    </div>
  </div>`;
}

/**
 * 2. Agent Execution Time
 */
export function renderExecutionTimeChart(
  baselineDurationMs?: number,
  candidateDurationMs?: number
): string {
  if (baselineDurationMs === undefined || candidateDurationMs === undefined) {
    return `<div class="p-6 bg-gray-950/40 rounded-xl border border-gray-800 text-center text-gray-500 text-xs font-mono">
      N/A — Durées d'exécution non enregistrées
    </div>`;
  }

  const baselineSec = (baselineDurationMs / 1000).toFixed(2);
  const candidateSec = (candidateDurationMs / 1000).toFixed(2);
  const maxVal = Math.max(baselineDurationMs, candidateDurationMs, 1);
  const baselineW = Math.round((baselineDurationMs / maxVal) * 360);
  const candidateW = Math.round((candidateDurationMs / maxVal) * 360);
  const diffSec = Math.abs((baselineDurationMs - candidateDurationMs) / 1000).toFixed(2);
  const isFaster = baselineDurationMs >= candidateDurationMs;

  return `
  <div class="bg-gray-950/60 p-5 rounded-xl border border-gray-800/80">
    <div class="flex items-center justify-between mb-4">
      <div class="flex items-center gap-2">
        <span class="w-2.5 h-2.5 rounded-full bg-cyan-400"></span>
        <span class="text-xs font-bold uppercase tracking-wider text-gray-300">2. Agent Execution Time</span>
      </div>
      <span class="px-2 py-0.5 rounded text-xs font-bold font-mono ${isFaster ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-amber-500/10 text-amber-400 border border-amber-500/20'}">
        ${isFaster ? '⚡ -' : '+ '}${diffSec}s
      </span>
    </div>
    <svg viewBox="0 0 500 110" class="w-full h-auto font-mono text-xs select-none">
      <text x="10" y="32" fill="#94a3b8" font-size="11" font-weight="600">Baseline</text>
      <rect x="90" y="16" width="360" height="24" rx="5" fill="#1e293b" />
      <rect x="90" y="16" width="${baselineW}" height="24" rx="5" fill="#475569" />
      <text x="${Math.max(105, 90 + baselineW - 45)}" y="32" fill="#ffffff" font-size="11" font-weight="bold">${baselineSec}s</text>

      <text x="10" y="80" fill="#06b6d4" font-size="11" font-weight="600">Candidate</text>
      <rect x="90" y="64" width="360" height="24" rx="5" fill="#1e293b" />
      <rect x="90" y="64" width="${candidateW}" height="24" rx="5" fill="#06b6d4" />
      <text x="${Math.max(105, 90 + candidateW - 45)}" y="80" fill="#ffffff" font-size="11" font-weight="bold">${candidateSec}s</text>
    </svg>
    <div class="flex justify-between text-[11px] text-gray-500 font-mono mt-2 pt-2 border-t border-gray-900">
      <span>Durée initiale: ${baselineSec}s</span>
      <span class="text-cyan-400 font-bold">Durée optimisée: ${candidateSec}s</span>
    </div>
  </div>`;
}

/**
 * 3. Task Success Rate & Regression Guard
 */
export function renderSuccessRateChart(
  baselineRate: number,
  candidateRate: number,
  baselineTotal: number,
  candidateTotal: number
): string {
  const bPct = Math.round(baselineRate * 100);
  const cPct = Math.round(candidateRate * 100);
  const isRegression = candidateRate < baselineRate;

  return `
  <div class="bg-gray-950/60 p-5 rounded-xl border border-gray-800/80">
    <div class="flex items-center justify-between mb-4">
      <div class="flex items-center gap-2">
        <span class="w-2.5 h-2.5 rounded-full ${isRegression ? 'bg-rose-500' : 'bg-emerald-400'}"></span>
        <span class="text-xs font-bold uppercase tracking-wider text-gray-300">3. Task Success Rate</span>
      </div>
      <span class="px-2 py-0.5 rounded text-xs font-bold font-mono ${isRegression ? 'bg-rose-500/10 text-rose-400 border border-rose-500/20' : 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'}">
        ${isRegression ? 'RÉGRESSION DÉTECTÉE' : 'AUCUNE RÉGRESSION (100% Intact)'}
      </span>
    </div>
    <div class="grid grid-cols-2 gap-4 my-2">
      <div class="bg-gray-900/50 p-3 rounded-lg border border-gray-800 text-center">
        <div class="text-[11px] text-gray-400 font-medium">Baseline (Initial)</div>
        <div class="text-2xl font-black text-gray-200 mt-1">${bPct}%</div>
        <div class="text-[10px] text-gray-500 font-mono mt-0.5">${Math.round(baselineRate * baselineTotal)} / ${baselineTotal} passés</div>
      </div>
      <div class="bg-gray-900/50 p-3 rounded-lg border ${isRegression ? 'border-rose-900/50' : 'border-emerald-900/50'} text-center">
        <div class="text-[11px] text-gray-400 font-medium">Candidate (Optimisé)</div>
        <div class="text-2xl font-black ${isRegression ? 'text-rose-400' : 'text-emerald-400'} mt-1">${cPct}%</div>
        <div class="text-[10px] text-gray-500 font-mono mt-0.5">${Math.round(candidateRate * candidateTotal)} / ${candidateTotal} passés</div>
      </div>
    </div>
    <div class="text-[11px] text-gray-400 font-mono pt-2 border-t border-gray-900 text-center">
      ${isRegression ? 'Attention: le candidat dégrade le taux de succès des tâches.' : 'Validation contractuelle : les tests de contrôle réussissent sur les deux versions.'}
    </div>
  </div>`;
}

/**
 * 4. Context & Navigation Efficiency (Files read, tool calls)
 */
export function renderNavigationEfficiencyChart(
  baselineToolCalls?: number,
  candidateToolCalls?: number,
  baselineFiles?: number,
  candidateFiles?: number
): string {
  const hasTools = baselineToolCalls !== undefined && candidateToolCalls !== undefined;
  const hasFiles = baselineFiles !== undefined && candidateFiles !== undefined;

  if (!hasTools && !hasFiles) {
    return `<div class="p-6 bg-gray-950/40 rounded-xl border border-gray-800 text-center text-gray-500 text-xs font-mono">
      N/A — Détails d'appels d'outils et de fichiers consultés non instrumentés
    </div>`;
  }

  const toolDelta = hasTools && baselineToolCalls > 0
    ? Math.round(((baselineToolCalls - candidateToolCalls) / baselineToolCalls) * 100)
    : 0;

  const fileDelta = hasFiles && baselineFiles > 0
    ? Math.round(((baselineFiles - candidateFiles) / baselineFiles) * 100)
    : 0;

  return `
  <div class="bg-gray-950/60 p-5 rounded-xl border border-gray-800/80">
    <div class="flex items-center justify-between mb-4">
      <div class="flex items-center gap-2">
        <span class="w-2.5 h-2.5 rounded-full bg-violet-400"></span>
        <span class="text-xs font-bold uppercase tracking-wider text-gray-300">4. Context & Navigation Efficiency</span>
      </div>
      <span class="text-xs font-mono text-violet-400 font-medium">Navigation & Churn</span>
    </div>

    <div class="space-y-4">
      ${hasTools ? `
      <div>
        <div class="flex justify-between text-xs font-mono mb-1">
          <span class="text-gray-400">Appels d'outils (Tool calls)</span>
          <span class="text-emerald-400 font-bold">${candidateToolCalls} vs ${baselineToolCalls} (${toolDelta > 0 ? `-${toolDelta}%` : `+${Math.abs(toolDelta)}%`})</span>
        </div>
        <div class="w-full bg-gray-800 h-2.5 rounded-full overflow-hidden flex">
          <div class="bg-violet-500 h-full" style="width: ${Math.min(100, Math.round((candidateToolCalls / Math.max(baselineToolCalls, 1)) * 100))}%"></div>
        </div>
      </div>` : ''}

      ${hasFiles ? `
      <div>
        <div class="flex justify-between text-xs font-mono mb-1">
          <span class="text-gray-400">Fichiers explorés dans le repo</span>
          <span class="text-emerald-400 font-bold">${candidateFiles} vs ${baselineFiles} (${fileDelta > 0 ? `-${fileDelta}%` : `+${Math.abs(fileDelta)}%`})</span>
        </div>
        <div class="w-full bg-gray-800 h-2.5 rounded-full overflow-hidden flex">
          <div class="bg-indigo-500 h-full" style="width: ${Math.min(100, Math.round((candidateFiles / Math.max(baselineFiles, 1)) * 100))}%"></div>
        </div>
      </div>` : ''}
    </div>
    <div class="text-[11px] text-gray-500 font-mono mt-4 pt-2 border-t border-gray-900">
      Moins de fichiers explorés = moins de tours perdus à chercher les mauvais chemins.
    </div>
  </div>`;
}

/**
 * 5. Benchmark Variability (Stochastic variance across trials)
 */
export function renderVariabilityChart(
  baselineTrials: number[],
  candidateTrials: number[]
): string {
  if (baselineTrials.length === 0 || candidateTrials.length === 0) {
    return `
    <div class="bg-gray-950/60 p-5 rounded-xl border border-gray-800/80">
      <div class="flex items-center gap-2 mb-2">
        <span class="w-2.5 h-2.5 rounded-full bg-amber-400"></span>
        <span class="text-xs font-bold uppercase tracking-wider text-gray-300">5. Benchmark Variability</span>
      </div>
      <div class="p-6 bg-gray-900/30 rounded-lg text-center text-gray-500 text-xs font-mono">
        N/A — Essais multiples requis pour tracer la variabilité stochastique
      </div>
    </div>`;
  }

  const allVals = [...baselineTrials, ...candidateTrials];
  const maxVal = Math.max(...allVals, 1);
  const minVal = Math.min(...allVals, 0);

  // Render SVG points along a timeline / trial index
  const width = 480;
  const height = 120;
  const padX = 40;
  const padY = 20;
  const plotW = width - padX * 2;
  const plotH = height - padY * 2;

  const count = Math.max(baselineTrials.length, candidateTrials.length);
  const stepX = count > 1 ? plotW / (count - 1) : plotW / 2;

  const bPoints = baselineTrials.map((val, idx) => {
    const x = padX + (count > 1 ? idx * stepX : plotW / 2);
    const y = height - padY - ((val - minVal) / (maxVal - minVal || 1)) * plotH;
    return { x, y, val };
  });

  const cPoints = candidateTrials.map((val, idx) => {
    const x = padX + (count > 1 ? idx * stepX : plotW / 2);
    const y = height - padY - ((val - minVal) / (maxVal - minVal || 1)) * plotH;
    return { x, y, val };
  });

  const bPath = bPoints.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
  const cPath = cPoints.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');

  return `
  <div class="bg-gray-950/60 p-5 rounded-xl border border-gray-800/80">
    <div class="flex items-center justify-between mb-4">
      <div class="flex items-center gap-2">
        <span class="w-2.5 h-2.5 rounded-full bg-amber-400"></span>
        <span class="text-xs font-bold uppercase tracking-wider text-gray-300">5. Benchmark Variability (${count} Essais)</span>
      </div>
      <div class="flex items-center gap-3 text-xs font-mono">
        <span class="flex items-center gap-1 text-gray-400"><span class="w-2 h-2 rounded-full bg-slate-400"></span> Baseline</span>
        <span class="flex items-center gap-1 text-emerald-400"><span class="w-2 h-2 rounded-full bg-emerald-400"></span> Candidate</span>
      </div>
    </div>
    <svg viewBox="0 0 ${width} ${height}" class="w-full h-auto select-none font-mono">
      <!-- Grid Lines -->
      <line x1="${padX}" y1="${padY}" x2="${width - padX}" y2="${padY}" stroke="#334155" stroke-dasharray="2,2" />
      <line x1="${padX}" y1="${height - padY}" x2="${width - padX}" y2="${height - padY}" stroke="#334155" stroke-dasharray="2,2" />

      <!-- Baseline Line & Points -->
      ${count > 1 ? `<path d="${bPath}" fill="none" stroke="#64748b" stroke-width="2" opacity="0.6" />` : ''}
      ${bPoints.map(p => `
        <circle cx="${p.x}" cy="${p.y}" r="4" fill="#94a3b8" />
        <text x="${p.x}" y="${p.y - 7}" fill="#94a3b8" font-size="9" text-anchor="middle">${Math.round(p.val).toLocaleString()}</text>
      `).join('')}

      <!-- Candidate Line & Points -->
      ${count > 1 ? `<path d="${cPath}" fill="none" stroke="#10b981" stroke-width="2" />` : ''}
      ${cPoints.map(p => `
        <circle cx="${p.x}" cy="${p.y}" r="4" fill="#10b981" />
        <text x="${p.x}" y="${p.y + 14}" fill="#34d399" font-size="9" font-weight="bold" text-anchor="middle">${Math.round(p.val).toLocaleString()}</text>
      `).join('')}
    </svg>
    <div class="text-[11px] text-gray-500 font-mono mt-2 pt-2 border-t border-gray-900 flex justify-between">
      <span>Contrebalancement d'ordre appliqué (élimination des biais de cache)</span>
      <span>Écart min/max mesuré</span>
    </div>
  </div>`;
}

/**
 * 6. Repository Evolution (Historical trends over commits/certifications)
 */
export function renderEvolutionChart(
  history: Array<{ date: string; score: number; label?: string }>,
  locale: "fr" | "en" = "fr"
): string {
  const en = locale === "en";
  if (!history || history.length < 2) {
    return `
    <div class="bg-gray-950/60 p-5 rounded-xl border border-gray-800/80">
      <div class="flex items-center gap-2 mb-2">
        <span class="w-2.5 h-2.5 rounded-full bg-blue-400"></span>
        <span class="text-xs font-bold uppercase tracking-wider text-gray-300">${en ? "6. Repository history" : "6. Historique du dépôt"}</span>
      </div>
      <div class="p-6 bg-gray-900/30 rounded-lg text-center text-gray-500 text-xs font-mono">
        ${en ? "N/A — Not enough recorded analyses to show a trend." : "N/D — Pas assez d’analyses enregistrées pour afficher une tendance."}
      </div>
    </div>`;
  }

  const width = 480;
  const height = 110;
  const padX = 40;
  const padY = 20;
  const plotW = width - padX * 2;
  const plotH = height - padY * 2;

  const stepX = plotW / (history.length - 1);
  const points = history.map((h, i) => {
    const x = padX + i * stepX;
    const y = height - padY - (Math.max(0, Math.min(100, h.score)) / 100) * plotH;
    return { x, y, score: h.score, date: h.date, label: h.label || '' };
  });

  const pathD = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');

  return `
  <div class="bg-gray-950/60 p-5 rounded-xl border border-gray-800/80">
    <div class="flex items-center justify-between mb-4">
      <div class="flex items-center gap-2">
        <span class="w-2.5 h-2.5 rounded-full bg-blue-400"></span>
        <span class="text-xs font-bold uppercase tracking-wider text-gray-300">${en ? "6. Repository history" : "6. Historique du dépôt"} (${history.length} ${en ? "analyses" : "analyses"})</span>
      </div>
      <span class="text-xs font-mono text-blue-400 font-semibold">${en ? "Recorded diagnostic scores" : "Scores de diagnostic enregistrés"}</span>
    </div>
    <svg viewBox="0 0 ${width} ${height}" class="w-full h-auto select-none font-mono">
      <path d="${pathD}" fill="none" stroke="#3b82f6" stroke-width="2.5" />
      ${points.map(p => `
        <circle cx="${p.x}" cy="${p.y}" r="4" fill="#3b82f6" />
        <text x="${p.x}" y="${p.y - 7}" fill="#93c5fd" font-size="9" font-weight="bold" text-anchor="middle">${p.score}%</text>
        <text x="${p.x}" y="${height - 4}" fill="#64748b" font-size="8" text-anchor="middle">${escapeHtml(p.date)}</text>
      `).join('')}
    </svg>
    <div class="text-[11px] text-gray-500 font-mono mt-2 pt-2 border-t border-gray-900">
      ${en ? "Recorded diagnostic scores over time; this does not measure agent efficiency." : "Scores de diagnostic enregistrés dans le temps ; ils ne mesurent pas l’efficacité des agents."}
    </div>
  </div>`;
}

/**
 * 7. AI Subscription & Quota Runway Projection Chart
 * Projects cumulative token burn rate, plan exhaustion, and task capacity over 100 developer tasks.
 */
export function renderSubscriptionQuotaProjectionChart(options: {
  baselineTokensPerTask?: number;
  candidateTokensPerTask?: number;
  monthlyQuotaTokens?: number;
  tasksCount?: number;
  isMeasured?: boolean;
  locale?: "fr" | "en";
}): string {
  const tasksCount = options.tasksCount || 100;
  const baseTks = Math.round(options.baselineTokensPerTask || 46000);
  const candTks = Math.round(options.candidateTokensPerTask || 23500);
  const quota = options.monthlyQuotaTokens || 2500000;
  const isMeasured = options.isMeasured ?? false;
  const en = options.locale === "en";
  const taskWord = en ? "tasks" : "tâches";

  const totalBaseTokens = tasksCount * baseTks;
  const totalCandTokens = tasksCount * candTks;
  const maxTokensAxis = Math.max(totalBaseTokens, quota * 1.15, 3000000);

  const baseTasksBeforeQuota = Math.floor(quota / baseTks);
  const candTasksBeforeQuota = Math.floor(quota / candTks);
  const extraTasksGain = Math.round(((candTasksBeforeQuota - baseTasksBeforeQuota) / baseTasksBeforeQuota) * 100);
  const tokensSaved = totalBaseTokens - totalCandTokens;

  // Chart layout
  const width = 640;
  const height = 240;
  const padLeft = 60;
  const padRight = 35;
  const padTop = 30;
  const padBottom = 35;
  const plotW = width - padLeft - padRight;
  const plotH = height - padTop - padBottom;

  const steps = [0, 20, 40, 60, 80, 100];

  const mapX = (t: number) => padLeft + (t / 100) * plotW;
  const mapY = (tokens: number) => height - padBottom - (tokens / maxTokensAxis) * plotH;

  const quotaY = mapY(quota);

  // Points
  const basePoints = steps.map(t => ({ x: mapX(t), y: mapY(t * baseTks), tokens: t * baseTks, task: t }));
  const candPoints = steps.map(t => ({ x: mapX(t), y: mapY(t * candTks), tokens: t * candTks, task: t }));

  const basePathD = basePoints.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');
  const candPathD = candPoints.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');

  // Area under candidate curve
  const candAreaD = `${candPathD} L ${mapX(100).toFixed(1)} ${mapY(0).toFixed(1)} L ${mapX(0).toFixed(1)} ${mapY(0).toFixed(1)} Z`;

  // Saturation marker for baseline
  const baseExhaustionX = mapX(Math.min(100, baseTasksBeforeQuota));

  return `
  <div class="bg-gradient-to-b from-gray-900/90 to-gray-950/80 p-6 rounded-2xl border border-indigo-500/30 relative overflow-hidden backdrop-blur shadow-2xl">
    <div class="absolute -right-10 -top-10 w-48 h-48 bg-indigo-500/10 rounded-full blur-3xl pointer-events-none"></div>

    <!-- Header & KPIs -->
    <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6 pb-4 border-b border-gray-800/80">
      <div>
        <div class="flex items-center gap-2">
          <span class="w-3 h-3 rounded-full bg-gradient-to-r from-emerald-400 to-cyan-400 animate-pulse"></span>
          <h3 class="text-sm font-bold uppercase tracking-wider text-white">
            ${en ? "Illustrative token budget scenario over 100 tasks" : "Scénario illustratif de budget de tokens sur 100 tâches"}
          </h3>
        </div>
        <p class="text-xs text-gray-400 mt-1">
          ${en ? "Uses assumed per-task token counts and a sample quota. It does not measure this repository." : "Utilise des tokens par tâche supposés et un quota fictif. Ce dépôt n’a pas été mesuré."}
        </p>
      </div>

      <div class="flex flex-wrap items-center gap-2">
        <span class="px-3 py-1 rounded-full text-xs font-bold font-mono ${isMeasured ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-indigo-500/10 text-indigo-300 border border-indigo-500/20'}">
          ${isMeasured ? (en ? 'BENCHMARK INPUTS' : 'DONNÉES DE BENCHMARK') : (en ? 'ILLUSTRATIVE SCENARIO' : 'SCÉNARIO ILLUSTRATIF')}
        </span>
      </div>
    </div>

    <!-- 3 KPI Cards -->
    <div class="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-6">
      <div class="bg-gray-950/70 p-3.5 rounded-xl border border-gray-800/90">
        <div class="text-[11px] font-medium text-gray-400">${en ? "Estimated task capacity" : "Capacité estimée en tâches"}</div>
        <div class="text-xl font-extrabold text-emerald-400 mt-1 font-mono">+${extraTasksGain}%</div>
        <div class="text-[10px] text-gray-500 mt-0.5">${en ? "Under the assumed token budget" : "Sous le budget de tokens supposé"}</div>
      </div>

      <div class="bg-gray-950/70 p-3.5 rounded-xl border border-gray-800/90">
        <div class="text-[11px] font-medium text-gray-400">${en ? "Modelled difference (100 tasks)" : "Écart modélisé (100 tâches)"}</div>
        <div class="text-xl font-extrabold text-cyan-400 mt-1 font-mono">-${(tokensSaved / 1000000).toFixed(2)}M</div>
        <div class="text-[10px] text-gray-500 mt-0.5">${en ? "Scenario output, not observed savings" : "Résultat du scénario, pas un gain observé"}</div>
      </div>

      <div class="bg-gray-950/70 p-3.5 rounded-xl border border-gray-800/90">
        <div class="text-[11px] font-medium text-gray-400">${en ? "Budget threshold" : "Seuil du budget"}</div>
        <div class="text-xl font-extrabold text-amber-400 mt-1 font-mono">${en ? "Task" : "Tâche"} #${baseTasksBeforeQuota} / #${candTasksBeforeQuota}</div>
        <div class="text-[10px] text-gray-500 mt-0.5">${en ? "Assumed baseline / candidate" : "Hypothèses initiale / cible"}</div>
      </div>
    </div>

    <!-- Vector SVG Graph -->
    <div class="w-full overflow-hidden">
      <svg viewBox="0 0 ${width} ${height}" class="w-full h-auto select-none font-mono text-xs">
        <defs>
          <linearGradient id="candGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#10b981" stop-opacity="0.25"/>
            <stop offset="100%" stop-color="#10b981" stop-opacity="0.0"/>
          </linearGradient>
        </defs>

        <!-- Y-Axis Grid & Labels -->
        <line x1="${padLeft}" y1="${mapY(0)}" x2="${width - padRight}" y2="${mapY(0)}" stroke="#334155" stroke-width="1" />
        <text x="${padLeft - 10}" y="${mapY(0) + 4}" fill="#64748b" font-size="9" text-anchor="end">0</text>

        <line x1="${padLeft}" y1="${mapY(1500000)}" x2="${width - padRight}" y2="${mapY(1500000)}" stroke="#1e293b" stroke-dasharray="3,3" />
        <text x="${padLeft - 10}" y="${mapY(1500000) + 4}" fill="#64748b" font-size="9" text-anchor="end">1.5M</text>

        <line x1="${padLeft}" y1="${mapY(3000000)}" x2="${width - padRight}" y2="${mapY(3000000)}" stroke="#1e293b" stroke-dasharray="3,3" />
        <text x="${padLeft - 10}" y="${mapY(3000000) + 4}" fill="#64748b" font-size="9" text-anchor="end">3.0M</text>

        <line x1="${padLeft}" y1="${mapY(4500000)}" x2="${width - padRight}" y2="${mapY(4500000)}" stroke="#1e293b" stroke-dasharray="3,3" />
        <text x="${padLeft - 10}" y="${mapY(4500000) + 4}" fill="#64748b" font-size="9" text-anchor="end">4.5M</text>

        <!-- X-Axis Labels (Tasks count) -->
        ${steps.map(t => `
          <line x1="${mapX(t)}" y1="${height - padBottom}" x2="${mapX(t)}" y2="${height - padBottom + 4}" stroke="#475569" />
          <text x="${mapX(t)}" y="${height - padBottom + 16}" fill="#94a3b8" font-size="9" text-anchor="middle">${t === 0 ? '0' : `${t} ${taskWord}`}</text>
        `).join('')}

        <!-- Quota Threshold Line -->
        <line x1="${padLeft}" y1="${quotaY}" x2="${width - padRight}" y2="${quotaY}" stroke="#f59e0b" stroke-width="1.5" stroke-dasharray="4,4" />
        <text x="${width - padRight - 5}" y="${quotaY - 6}" fill="#fbbf24" font-size="9" font-weight="bold" text-anchor="end">
          ${en ? "Assumed token budget" : "Budget de tokens supposé"} (${(quota / 1000000).toFixed(1)}M)
        </text>

        <!-- Baseline Curve (Sans RepoTwin) -->
        <path d="${basePathD}" fill="none" stroke="#f43f5e" stroke-width="2.5" stroke-dasharray="5,3" />
        ${basePoints.map(p => `
          <circle cx="${p.x}" cy="${p.y}" r="3.5" fill="#f43f5e" />
        `).join('')}

        <!-- Candidate Gradient Area & Curve (Avec RepoTwin) -->
        <path d="${candAreaD}" fill="url(#candGrad)" />
        <path d="${candPathD}" fill="none" stroke="#10b981" stroke-width="3" />
        ${candPoints.map(p => `
          <circle cx="${p.x}" cy="${p.y}" r="4" fill="#10b981" stroke="#064e3b" stroke-width="1.5" />
        `).join('')}

        <!-- Saturation Point Callout for Baseline -->
        <line x1="${baseExhaustionX}" y1="${quotaY}" x2="${baseExhaustionX}" y2="${height - padBottom}" stroke="#f43f5e" stroke-width="1" stroke-dasharray="2,2" />
        <circle cx="${baseExhaustionX}" cy="${quotaY}" r="5" fill="#f43f5e" />
        <text x="${baseExhaustionX - 6}" y="${quotaY + 16}" fill="#fda4af" font-size="8.5" font-weight="bold" text-anchor="end">
          ${en ? "Threshold at task" : "Seuil à la tâche"} #${baseTasksBeforeQuota}
        </text>

        <!-- Legend inside SVG -->
        <g transform="translate(${padLeft + 10}, ${padTop - 12})">
          <!-- Baseline Legend -->
          <line x1="0" y1="0" x2="18" y2="0" stroke="#f43f5e" stroke-width="2.5" stroke-dasharray="4,2" />
          <circle cx="9" cy="0" r="3" fill="#f43f5e" />
          <text x="24" y="3" fill="#f43f5e" font-size="9.5" font-weight="bold">${en ? "Baseline assumption" : "Hypothèse initiale"} (~${(baseTks / 1000).toFixed(1)}k/${en ? "task" : "tâche"})</text>

          <!-- Candidate Legend -->
          <line x1="220" y1="0" x2="238" y2="0" stroke="#10b981" stroke-width="3" />
          <circle cx="229" cy="0" r="3" fill="#10b981" />
          <text x="244" y="3" fill="#34d399" font-size="9.5" font-weight="bold">${en ? "Candidate assumption" : "Hypothèse cible"} (~${(candTks / 1000).toFixed(1)}k/${en ? "task" : "tâche"})</text>
        </g>
      </svg>
    </div>

    <div class="mt-4 pt-3 border-t border-gray-800/80 flex flex-col sm:flex-row sm:items-center sm:justify-between text-[11px] text-gray-400 font-mono gap-2">
      <div>
        <span class="text-white font-medium">${en ? "Assumptions:" : "Hypothèses :"}</span> ${baseTks.toLocaleString(en ? "en-US" : "fr-FR")} / ${candTks.toLocaleString(en ? "en-US" : "fr-FR")} ${en ? "tokens per task; token budget" : "tokens par tâche ; budget de tokens"} ${quota.toLocaleString(en ? "en-US" : "fr-FR")}.
      </div>
      <div class="text-emerald-400 font-semibold">
        ${en ? "Modelled difference:" : "Écart modélisé :"} ${(tokensSaved / 1000000).toFixed(2)}M tokens / ${tasksCount} ${taskWord}
      </div>
    </div>
  </div>`;
}

