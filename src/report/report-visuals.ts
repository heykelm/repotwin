import type { LocalEvidence } from './evidence.js';

function escapeHtml(value: unknown): string {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}
export function renderSizeComparison(before: number | null, current: number | null, locale: 'fr' | 'en'): string {
  const fr = locale === 'fr';
  const t = (a: string, b: string) => fr ? a : b;
  const n = (value: number) => value.toLocaleString(fr ? 'fr-FR' : 'en-US');
  if (before === null || current === null) return '<p class="muted">' + t('Les deux versions de AGENTS.md sont nécessaires pour afficher la comparaison.', 'Both versions of AGENTS.md are needed to show the comparison.') + '</p>';
  const max = Math.max(before, current, 1);
  const beforeWidth = before / max * 360, currentWidth = current / max * 360;
  return `<div class="size-chart">
    <svg viewBox="0 0 560 115" role="img" aria-label="${t('Taille estimée du fichier de consignes, sauvegarde et version actuelle', 'Estimated instruction file size, backup and current version')}">
      <text x="0" y="31">${t('Sauvegarde', 'Backup')}</text><rect x="120" y="12" width="360" height="25" rx="5" fill="#26394d"/><rect x="120" y="12" width="${beforeWidth.toFixed(2)}" height="25" rx="5" fill="#7599b2"/><text x="550" y="31" text-anchor="end">~${n(before)}</text>
      <text x="0" y="85">${t('Actuel', 'Current')}</text><rect x="120" y="66" width="360" height="25" rx="5" fill="#26394d"/><rect x="120" y="66" width="${currentWidth.toFixed(2)}" height="25" rx="5" fill="#968bec"/><text x="550" y="85" text-anchor="end">~${n(current)}</text>
    </svg>
    <p class="source">${t('Tokens approximatifs : caractères ÷ 4. Ces barres décrivent un fichier, pas la consommation d’une tâche.', 'Approximate tokens: characters ÷ 4. These bars describe a file, not task usage.')}</p>
  </div>`;
}
export function renderArchiveTimeline(history: LocalEvidence['history'], locale: 'fr' | 'en', timeZone: string): string {
  const fr = locale === 'fr';
  const t = (a: string, b: string) => fr ? a : b;
  if (!history.length) return '<p class="muted">' + t('Aucun enregistrement historique exploitable.', 'No usable historical records.') + '</p>';
  return `<ol class="archive-timeline" aria-label="${t('Chronologie des archives, sans score de performance', 'Archive timeline, without a performance score')}">
    ${history.map(entry => `<li><span class="timeline-dot" aria-hidden="true"></span><time datetime="${escapeHtml(entry.date)}">${escapeHtml(new Date(entry.date).toLocaleString(fr ? 'fr-FR' : 'en-GB', { dateStyle: 'medium', timeStyle: 'medium', timeZone }))}</time><code>${escapeHtml(entry.git ?? '—')}</code><small>${t('Enregistrement archivé', 'Archived record')}</small></li>`).join('')}
  </ol><p class="source">${t('Une date correspond à un enregistrement distinct, après retrait des doublons. Cette chronologie ne représente pas une courbe de gain.', 'Each date is a distinct record, after deduplication. This timeline is not an improvement curve.')}</p>`;
}

export function renderCompoundingTokenCurve(locale: 'fr' | 'en'): string {
  const en = locale === 'en';
  const title = en
    ? 'Active Context Window: Raw Terminal vs. RepoTwin Twin Sieve'
    : 'Fenêtre de Contexte Active : Terminal Brut vs. Twin Sieve RepoTwin';
  const subtitle = en
    ? 'REPOTWIN V0.3.0 · ILLUSTRATIVE MODEL (SIMULATED 5-TURN DEBUG CYCLE)'
    : 'REPOTWIN V0.3.0 · MODÈLE ILLUSTRATIF (SIMULATION SUR 5 TOURS DE DEBUG)';
  const rawLegend = en ? 'Without RepoTwin (Raw O(N²))' : 'Sans RepoTwin (Brut O(N²))';
  const twinLegend = en ? 'With Twin Sieve (~75% Noise Filtered)' : 'Avec Twin Sieve (~75% Filtré)';
  const badgeText = en ? '⚡ ~75% NOISE FILTERED (MODEL)' : '⚡ ~75% DE BRUIT FILTRÉ (MODÈLE)';

  return `<div class="token-curve-wrap" style="margin: 20px 0;">
    <svg viewBox="0 0 760 360" width="100%" height="auto" role="img" aria-label="${title}" style="border-radius: 14px; border: 1px solid var(--border); background: #080e18;">
      <defs>
        <linearGradient id="curveBgGrad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#090d16" />
          <stop offset="100%" stop-color="#0e1726" />
        </linearGradient>
        <linearGradient id="curvePreservedGrad" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stop-color="#10b981" stop-opacity="0.35" />
          <stop offset="100%" stop-color="#10b981" stop-opacity="0.05" />
        </linearGradient>
        <linearGradient id="curveRedLineGrad" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stop-color="#f87171" />
          <stop offset="100%" stop-color="#ef4444" />
        </linearGradient>
        <linearGradient id="curveGreenLineGrad" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stop-color="#34d399" />
          <stop offset="100%" stop-color="#10b981" />
        </linearGradient>
      </defs>

      <rect width="760" height="360" rx="14" fill="url(#curveBgGrad)" />

      <text x="32" y="38" fill="#38d9a9" font-family="'JetBrains Mono', monospace" font-size="11" font-weight="700" letter-spacing="1.2">${subtitle}</text>
      <text x="32" y="64" fill="#f8fafc" font-family="'Plus Jakarta Sans', system-ui, sans-serif" font-size="16" font-weight="800">${title}</text>

      <g transform="translate(420, 26)">
        <circle cx="10" cy="10" r="5" fill="#ef4444" />
        <text x="22" y="14" fill="#94a3b8" font-family="system-ui, sans-serif" font-size="11" font-weight="600">${rawLegend}</text>
        <circle cx="190" cy="10" r="5" fill="#10b981" />
        <text x="202" y="14" fill="#34d399" font-family="system-ui, sans-serif" font-size="11" font-weight="700">${twinLegend}</text>
      </g>

      <g stroke="#1e293b" stroke-dasharray="3 3" opacity="0.7">
        <line x1="70" y1="90" x2="710" y2="90" />
        <line x1="70" y1="140" x2="710" y2="140" />
        <line x1="70" y1="190" x2="710" y2="190" />
        <line x1="70" y1="240" x2="710" y2="240" />
        <line x1="70" y1="290" x2="710" y2="290" />
      </g>

      <g fill="#64748b" font-family="'JetBrains Mono', monospace" font-size="10" text-anchor="end">
        <text x="60" y="94">40k</text>
        <text x="60" y="144">30k</text>
        <text x="60" y="194">20k</text>
        <text x="60" y="244">10k</text>
        <text x="60" y="294">0k</text>
      </g>

      <path d="M 110 270 C 180 260, 210 240, 250 230 C 290 220, 350 190, 390 175 C 430 160, 490 130, 530 110 C 570 90, 630 60, 670 45 L 670 248 C 630 250, 570 252, 530 253 C 490 254, 430 257, 390 259 C 350 261, 290 263, 250 264 L 110 270 Z" fill="url(#curvePreservedGrad)" />

      <g transform="translate(460, 160)">
        <rect width="180" height="28" rx="7" fill="#064e3b" stroke="#059669" stroke-width="1.2" opacity="0.95" />
        <text x="90" y="18" fill="#a7f3d0" font-family="'JetBrains Mono', monospace" font-size="11" font-weight="700" text-anchor="middle">${badgeText}</text>
      </g>

      <path d="M 110 270 C 180 260, 210 240, 250 230 C 290 220, 350 190, 390 175 C 430 160, 490 130, 530 110 C 570 90, 630 60, 670 45" fill="none" stroke="url(#curveRedLineGrad)" stroke-width="3" stroke-linecap="round" />
      <path d="M 110 270 C 180 268, 210 266, 250 264 C 290 262, 350 260, 390 259 C 430 256, 490 254, 530 253 C 570 250, 630 249, 670 248" fill="none" stroke="url(#curveGreenLineGrad)" stroke-width="3" stroke-linecap="round" />

      <circle cx="110" cy="270" r="4.5" fill="#ef4444" />
      <circle cx="250" cy="230" r="4.5" fill="#ef4444" />
      <circle cx="390" cy="175" r="4.5" fill="#ef4444" />
      <circle cx="530" cy="110" r="4.5" fill="#ef4444" />
      <circle cx="670" cy="45" r="5.5" fill="#f87171" stroke="#ef4444" stroke-width="2" />
      <text x="670" y="32" fill="#fca5a5" font-family="'JetBrains Mono', monospace" font-size="11" font-weight="700" text-anchor="middle">~38k tks</text>

      <circle cx="110" cy="270" r="4.5" fill="#10b981" />
      <circle cx="250" cy="264" r="4.5" fill="#10b981" />
      <circle cx="390" cy="259" r="4.5" fill="#10b981" />
      <circle cx="530" cy="253" r="4.5" fill="#10b981" />
      <circle cx="670" cy="248" r="5.5" fill="#34d399" stroke="#10b981" stroke-width="2" />
      <text x="670" y="274" fill="#6ee7b7" font-family="'JetBrains Mono', monospace" font-size="11" font-weight="700" text-anchor="middle">~8.4k tks</text>

      <g fill="#94a3b8" font-family="system-ui, sans-serif" font-size="11" font-weight="600" text-anchor="middle">
        <text x="110" y="320">Turn 1</text>
        <text x="110" y="335" fill="#64748b" font-size="9.5">Prompt</text>
        <text x="250" y="320">Turn 2</text>
        <text x="250" y="335" fill="#64748b" font-size="9.5">${en ? 'Test 1 Fail' : 'Échec Test 1'}</text>
        <text x="390" y="320">Turn 3</text>
        <text x="390" y="335" fill="#64748b" font-size="9.5">${en ? 'Test 2 Fail' : 'Échec Test 2'}</text>
        <text x="530" y="320">Turn 4</text>
        <text x="530" y="335" fill="#64748b" font-size="9.5">${en ? 'Test 3 Fail' : 'Échec Test 3'}</text>
        <text x="670" y="320">Turn 5</text>
        <text x="670" y="335" fill="#10b981" font-size="9.5" font-weight="700">${en ? 'All Tests Pass' : 'Tous Tests OK'}</text>
      </g>
    </svg>
  </div>`;
}
export const reportVisualStyles = `
.pipeline-track{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin:20px 0 28px;position:relative}
.pipeline-step{background:linear-gradient(145deg,rgba(18,30,46,0.9),rgba(10,16,26,0.95));border:1px solid var(--border);border-radius:14px;padding:16px;position:relative;transition:all .2s;box-shadow:0 4px 14px rgba(0,0,0,0.25)}
.pipeline-step.completed{border-color:rgba(56,217,169,0.4);background:linear-gradient(145deg,rgba(16,42,36,0.7),rgba(10,24,20,0.85))}
.pipeline-step.active{border-color:rgba(99,102,241,0.5);box-shadow:0 0 16px rgba(99,102,241,0.2)}
.pipeline-step-header{display:flex;align-items:center;justify-content:space-between;margin-bottom:8px}
.step-num{display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;border-radius:50%;font-size:11px;font-weight:800;font-family:'JetBrains Mono',monospace;background:#1e293b;color:#94a3b8;border:1px solid #334155}
.pipeline-step.completed .step-num{background:#10b981;color:#fff;border-color:#059669}
.step-title{font-size:13px;font-weight:700;color:#f1f5f9;margin:0 0 4px}
.step-desc{font-size:11px;color:var(--muted);margin:0;line-height:1.4}
.step-badge{font-size:10px;padding:2px 7px;border-radius:10px;font-family:'JetBrains Mono',monospace;font-weight:700;text-transform:uppercase}
.step-badge.done{background:rgba(16,185,129,0.15);color:#6ee7b7;border:1px solid rgba(16,185,129,0.3)}
.step-badge.pending{background:rgba(245,158,11,0.15);color:#fcd34d;border:1px solid rgba(245,158,11,0.3)}
.benefit-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px;margin:20px 0}.benefit-card{border:1px solid rgba(255,255,255,0.08);border-radius:16px;padding:22px;background:linear-gradient(135deg,rgba(18,34,50,0.65),rgba(12,20,32,0.85));box-shadow:0 6px 20px -4px rgba(0,0,0,0.35);transition:border-color .2s,transform .2s}.benefit-card:hover{border-color:rgba(56,217,169,0.35);transform:translateY(-2px)}.benefit-card h3{margin:10px 0;font-size:16px;font-weight:700}.benefit-card p{font-size:13px}.benefit-card .benefit-expectation{color:var(--muted);border-top:1px solid rgba(255,255,255,0.06);padding-top:12px;margin-top:12px}.report-nav{display:flex;flex-wrap:wrap;gap:8px;margin:20px 0 28px}.report-nav a{text-decoration:none;border:1px solid rgba(255,255,255,0.09);padding:7px 14px;border-radius:20px;font-size:12px;font-weight:600;background:rgba(255,255,255,0.03);color:#cbd5e1;transition:all .2s}.report-nav a:hover{background:rgba(56,217,169,0.12);border-color:rgba(56,217,169,0.4);color:#6ee7b7}.evidence-legend{display:flex;flex-wrap:wrap;gap:12px;margin:16px 0 24px}.evidence-legend>span{display:flex;align-items:center;gap:7px;font-size:12px;color:var(--muted)}.context-layout{display:grid;grid-template-columns:minmax(0,1.5fr) minmax(200px,1fr);gap:28px;align-items:center}.size-chart svg{width:100%;height:auto}.size-chart text{font-family:'JetBrains Mono',ui-monospace,SFMono-Regular,monospace;font-size:12px;fill:#c1d0e1}.context-summary{padding:22px;background:linear-gradient(135deg,rgba(16,26,42,0.8),rgba(12,19,30,0.9));border:1px solid rgba(255,255,255,0.06);border-radius:16px}.context-summary>strong{font-size:32px;display:block;color:#a5b4fc;font-family:'JetBrains Mono',monospace}.context-summary>span{font-size:13px;color:var(--muted)}.archive-timeline{display:flex;list-style:none;padding:0;margin:25px 0 15px;overflow-x:auto}.archive-timeline li{position:relative;flex:1;min-width:170px;border-top:2px solid #334155;padding:20px 14px 0 0;margin:0}.timeline-dot{position:absolute;top:-6px;left:0;width:10px;height:10px;border-radius:50%;background:#38d9a9;border:2px solid #080e18;box-shadow:0 0 8px rgba(56,217,169,0.5)}.archive-timeline time{display:block;font-size:12px;font-family:'JetBrains Mono',monospace}.archive-timeline code{display:block;font-size:11px;margin:5px 0}.archive-timeline small{color:var(--muted);font-size:10px}.copy-button{background:linear-gradient(135deg,#1e293b,#0f172a);border:1px solid rgba(255,255,255,0.12);color:#f1f5f9;font-size:12px;font-weight:600;padding:8px 14px;border-radius:8px;cursor:pointer;transition:all .2s}.copy-button:hover{border-color:rgba(56,217,169,0.4);background:#1e3a47;color:#6ee7b7}.actions-grid{display:grid;grid-template-columns:1fr 1fr;gap:20px}.action-card{background:linear-gradient(135deg,rgba(16,27,43,0.8),rgba(11,19,31,0.9));border:1px solid rgba(255,255,255,0.08);border-radius:16px;padding:24px}.action-card h3{margin:12px 0 8px;font-size:16px;font-weight:700}.action-card p{font-size:13px}.action-command{display:flex;gap:12px;align-items:center;background:#050911;border:1px solid rgba(255,255,255,0.08);border-radius:10px;padding:12px 14px;margin:14px 0}.action-command code{flex:1;word-break:break-word;background:transparent;border:none;padding:0;color:#93c5fd}.copy-status{font-size:11px;color:var(--accent);min-height:18px;display:block;font-family:'JetBrains Mono',monospace}.current-instructions{max-height:310px}.visual-section .section-heading{margin-bottom:12px}@media(max-width:700px){.pipeline-track{grid-template-columns:1fr}.benefit-grid,.context-layout,.actions-grid{grid-template-columns:1fr}.report-nav a{font-size:11px}.action-command{flex-direction:column;align-items:flex-start}}@media print{.copy-button{display:none}}
`;
export const reportCopyScript = `
document.querySelectorAll('[data-copy-command]').forEach(button => button.addEventListener('click', async () => {
  const card = button.closest('[data-command-card]');
  const command = card.querySelector('[data-command-text]').textContent;
  const status = card.querySelector('[data-copy-status]');
  const fr = card.closest('main').dataset.language === 'fr';
  try {
    await navigator.clipboard.writeText(command);
    status.textContent = fr ? 'Commande copiée. Aucune commande n’a été exécutée.' : 'Command copied. No command was executed.';
  } catch {
    status.textContent = fr ? 'Copie automatique indisponible : sélectionne le texte de la commande.' : 'Automatic copy unavailable: select the command text.';
  }
}));
`;

