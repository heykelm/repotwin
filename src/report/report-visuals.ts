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

