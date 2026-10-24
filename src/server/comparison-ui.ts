import crypto from 'node:crypto';
import { IncomingMessage, ServerResponse } from 'node:http';
import { compareRevisions, ComparisonPlan, prepareComparison } from '../verification/revision-comparison.js';

export function createComparisonApi(repoPath: string, sessionToken: string) {
  let plan: ComparisonPlan | undefined;
  let consent = '';
  let progress: { state: string; side?: string; command?: string; completed?: number; total?: number } = { state: 'idle' };
  let report: Awaited<ReturnType<typeof compareRevisions>> | undefined;
  return async (url: URL, req: IncomingMessage, res: ServerResponse) => {
    if (!url.pathname.startsWith('/api/comparison/')) return false;
    res.setHeader('Content-Type', 'application/json');
    if (url.pathname === '/api/comparison/status' && req.method === 'GET') {
      res.end(JSON.stringify({ ok: true, progress, report }));
    } else if (url.pathname === '/api/comparison/plan' && req.method === 'POST') {
      plan = undefined;
      report = undefined;
      const prepared = prepareComparison(repoPath, url.searchParams.get('base') ?? 'HEAD~1', url.searchParams.get('target') ?? 'HEAD');
      consent = crypto.createHmac('sha256', sessionToken).update(prepared.fingerprint).digest('hex');
      plan = prepared;
      progress = { state: 'ready' };
      res.end(JSON.stringify({ ok: true, plan, consent }));
    } else if (url.pathname === '/api/comparison/run' && req.method === 'POST') {
      if (!plan || req.headers['x-repotwin-comparison-consent'] !== consent) {
        res.writeHead(409);
        res.end(JSON.stringify({ ok: false, error: 'Review and approve the comparison command plan first.' }));
        return true;
      }
      const approved = plan;
      plan = undefined;
      report = undefined;
      progress = { state: 'running', completed: 0, total: approved.before.length + approved.after.length };
      try {
        report = await compareRevisions(repoPath, approved, {
          onProgress: (side, event) => {
            progress = {
              state: 'running', side, command: event.command.display,
              completed: (side === 'after' ? approved.before.length : 0) + event.index + (event.type === 'command_done' ? 1 : 0),
              total: approved.before.length + approved.after.length
            };
          }
        });
        progress = { state: 'done' };
        res.end(JSON.stringify({ ok: true, report }));
      } catch (error) {
        progress = { state: 'failed' };
        throw error;
      }
    } else {
      res.writeHead(404); res.end(JSON.stringify({ ok: false, error: 'Unknown comparison action.' }));
    }
    return true;
  };
}

export const comparisonPanel = `
    <section class="border border-zinc-700 rounded-lg p-5 space-y-4" aria-labelledby="comparisonTitle">
      <h2 id="comparisonTitle" class="text-sm font-semibold text-zinc-100">Comparer deux versions</h2>
      <div class="flex flex-wrap items-end gap-3">
        <label class="text-xs text-zinc-300">Référence<input id="comparisonBase" value="HEAD~1" maxlength="256" class="block mt-1 bg-zinc-950 border border-zinc-700 rounded px-3 py-2 text-zinc-100 w-48 max-w-full"></label>
        <label class="text-xs text-zinc-300">Version à vérifier<input id="comparisonTarget" value="HEAD" maxlength="256" class="block mt-1 bg-zinc-950 border border-zinc-700 rounded px-3 py-2 text-zinc-100 w-48 max-w-full"></label>
        <button id="comparisonPlanBtn" type="button" class="border border-zinc-600 rounded px-3 py-2 text-xs text-zinc-100">Préparer la comparaison</button>
        <button id="comparisonRunBtn" type="button" disabled class="border border-emerald-700 rounded px-3 py-2 text-xs text-emerald-300 disabled:opacity-40">Autoriser et comparer</button>
        <button id="comparisonExportBtn" type="button" hidden class="border border-zinc-600 rounded px-3 py-2 text-xs text-zinc-100">Exporter JSON</button>
      </div>
      <p id="comparisonStatus" role="status" aria-live="polite" class="text-xs text-zinc-400">Commits enregistrés uniquement · modifications locales non incluses.</p>
      <progress id="comparisonProgress" hidden max="1" value="0" class="w-full accent-emerald-500"></progress>
      <pre id="comparisonPlan" hidden class="max-h-48 overflow-auto whitespace-pre-wrap text-xs text-zinc-300"></pre>
      <div id="comparisonResults" class="space-y-3"></div>
    </section>`;

export const comparisonScript = `
    let comparisonConsent = '';
    let comparisonReport;
    let comparisonTimer;
    const comparisonStatus = document.getElementById('comparisonStatus');
    const comparisonPlanBtn = document.getElementById('comparisonPlanBtn');
    const comparisonRunBtn = document.getElementById('comparisonRunBtn');
    const comparisonExportBtn = document.getElementById('comparisonExportBtn');
    const comparisonProgress = document.getElementById('comparisonProgress');
    const comparisonLabels = {
      regression: 'Régression observée', fixed: 'Contrôle réparé',
      'failing-both': 'Échec avant et après', 'passing-both': 'Réussite avant et après',
      'not-verified': 'Non vérifié / non comparable'
    };
    function showComparison(report) {
      comparisonReport = report;
      comparisonExportBtn.hidden = false;
      const container = document.getElementById('comparisonResults');
      container.replaceChildren();
      const verdicts = { incomplete: 'Comparaison incomplète', regressions: 'Régression(s) observée(s)', 'no-regression-observed': 'Aucune régression observée sur les contrôles exécutés' };
      comparisonStatus.textContent = verdicts[report.verdict] + ' · ' + report.baseCommit.slice(0, 8) + ' → ' + report.targetCommit.slice(0, 8);
      const counts = document.createElement('p');
      counts.className = 'text-xs text-zinc-300';
      counts.textContent = Object.entries(report.counts).map(([key, value]) => comparisonLabels[key] + ': ' + value).join(' · ');
      container.appendChild(counts);
      if (!report.checks.length) {
        const empty = document.createElement('p');
        empty.className = 'text-xs text-amber-300';
        empty.textContent = 'Aucun contrôle reconnu dans ces versions. Aucun résultat applicatif à comparer.';
        container.appendChild(empty);
      }
      for (const check of report.checks) {
        const details = document.createElement('details');
        details.className = 'border rounded p-3 text-xs ' + (check.outcome === 'regression' ? 'border-red-500 text-red-300' : check.outcome === 'fixed' ? 'border-emerald-600 text-emerald-300' : 'border-zinc-700 text-zinc-300');
        const summary = document.createElement('summary');
        summary.textContent = comparisonLabels[check.outcome] + ' · ' + check.command.relPath + ' · ' + check.command.display;
        details.appendChild(summary);
        if (check.reason) { const reason = document.createElement('p'); reason.className = 'mt-2'; reason.textContent = check.reason; details.appendChild(reason); }
        for (const [label, result] of [['Avant', check.before], ['Après', check.after]]) {
          const output = document.createElement('pre');
          output.className = 'mt-3 max-h-48 overflow-auto whitespace-pre-wrap text-zinc-400';
          output.textContent = label + ': ' + (result ? result.status + ' · ' + result.durationMs + ' ms' + (result.outputTruncated ? ' · sortie tronquée' : '') + '\\n' + result.output : 'Contrôle absent');
          details.appendChild(output);
        }
        container.appendChild(details);
      }
      const installs = [...report.before, ...report.after].filter(r => r.kind === 'install' && r.status !== 'passed');
      for (const warning of [...report.warnings, ...installs.map(r => r.project + ': ' + r.output)]) {
        const p = document.createElement('p'); p.className = 'text-xs text-amber-300 whitespace-pre-wrap'; p.textContent = warning; container.appendChild(p);
      }
    }
    async function pollComparison() {
      try {
        const data = await (await fetch('/api/comparison/status')).json();
        if (data.progress.state === 'running') {
          comparisonProgress.hidden = false;
          comparisonProgress.max = data.progress.total || 1;
          comparisonProgress.value = data.progress.completed || 0;
          comparisonStatus.textContent = (data.progress.side === 'after' ? 'Après' : 'Avant') + ' · ' + (data.progress.command || 'Préparation') + ' · ' + (data.progress.completed || 0) + '/' + (data.progress.total || 0);
        } else if (data.report) showComparison(data.report);
      } catch { /* The final request reports connection errors. */ }
    }
    for (const id of ['comparisonBase', 'comparisonTarget']) document.getElementById(id).addEventListener('input', () => { comparisonConsent = ''; comparisonRunBtn.disabled = true; });
    comparisonPlanBtn.addEventListener('click', async () => {
      comparisonPlanBtn.disabled = true;
      comparisonRunBtn.disabled = true;
      comparisonExportBtn.hidden = true;
      document.getElementById('comparisonResults').replaceChildren();
      comparisonStatus.textContent = 'Préparation des deux versions…';
      try {
        const params = new URLSearchParams({ base: document.getElementById('comparisonBase').value, target: document.getElementById('comparisonTarget').value });
        const data = await (await fetch('/api/comparison/plan?' + params, { method: 'POST', headers: { 'X-RepoTwin-Token': sessionToken } })).json();
        if (!data.ok) throw new Error(data.error);
        comparisonConsent = data.consent;
        const lines = ['Avant: ' + data.plan.baseCommit, 'Après: ' + data.plan.targetCommit];
        for (const side of ['before', 'after']) for (const command of data.plan[side]) lines.push((side === 'before' ? 'Avant' : 'Après') + ' · ' + command.relPath + ' · ' + command.display + (data.plan.definitions[side][command.id] ? ' → ' + data.plan.definitions[side][command.id] : ''));
        lines.push(...data.plan.warnings);
        const preview = document.getElementById('comparisonPlan'); preview.hidden = false; preview.textContent = lines.join('\\n');
        comparisonStatus.textContent = data.plan.before.length + data.plan.after.length + ' commande(s) prévues au total. Aucune commande projet exécutée.';
        comparisonRunBtn.disabled = false;
      } catch (error) { comparisonStatus.textContent = error.message; }
      finally { comparisonPlanBtn.disabled = false; }
    });
    comparisonRunBtn.addEventListener('click', async () => {
      if (!comparisonConsent || !confirm('Exécuter les commandes affichées sur les deux versions ? Les installations et scripts exécutent du code du projet et peuvent accéder au réseau.')) return;
      comparisonRunBtn.disabled = true;
      comparisonPlanBtn.disabled = true;
      comparisonStatus.textContent = 'Comparaison en cours…';
      comparisonTimer = setInterval(pollComparison, 1000);
      try {
        const data = await (await fetch('/api/comparison/run', { method: 'POST', headers: { 'X-RepoTwin-Token': sessionToken, 'X-RepoTwin-Comparison-Consent': comparisonConsent } })).json();
        if (!data.ok) throw new Error(data.error);
        showComparison(data.report);
      } catch (error) { comparisonStatus.textContent = error.message; }
      finally { clearInterval(comparisonTimer); comparisonProgress.hidden = true; comparisonPlanBtn.disabled = false; comparisonConsent = ''; }
    });
    comparisonExportBtn.addEventListener('click', () => {
      if (!comparisonReport) return;
      const url = URL.createObjectURL(new Blob([JSON.stringify(comparisonReport, null, 2)], { type: 'application/json' }));
      const a = document.createElement('a'); a.href = url; a.download = 'repotwin-comparison.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
    pollComparison();
`;
