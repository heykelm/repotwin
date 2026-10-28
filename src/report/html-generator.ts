import fs from 'node:fs';
import path from 'node:path';
import type { SubprojectInfo, ProcessedFinding } from '../types/index.js';
import type { ScoreBreakdown } from '../diagnostics/score.js';
import type { ComparisonReport } from '../metrics/comparator.js';
import type { AgentRun } from '../types/contracts.js';
import { REPOTWIN_VERSION } from '../version.js';
import { readLocalEvidence, type FileEvidence } from './evidence.js';
import { renderSizeComparison, renderArchiveTimeline, reportVisualStyles, reportCopyScript } from './report-visuals.js';
import { auditTokenEfficiency, type TokenEfficiencyAudit } from '../analysis/token-efficiency.js';

export interface HtmlReportOptions {
  repoPath: string;
  scores: ScoreBreakdown;
  subprojects: SubprojectInfo[];
  falsePositives: ProcessedFinding[];
  trueIssues: ProcessedFinding[];
  proposedFixes: string[];
  newAgentsMd: string;
  benchmarkComparison?: ComparisonReport;
  runs?: AgentRun[];
  evolutionHistory?: Array<{ date: string; score: number; label?: string }>;
  timeZone?: string;
  syncRootReport?: boolean;
  tokenEfficiency?: TokenEfficiencyAudit;
}
function escapeHtml(value: unknown): string {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}
const code = (value: unknown) => '<code>' + escapeHtml(value) + '</code>';
const characters = (value: string) => Array.from(value).length;
const shellQuote = (value: string) => "'" + value.replace(/'/g, "'\\''") + "'";

export function generateHtmlReport(options: HtmlReportOptions, outputPath: string): string {
  const evidence = readLocalEvidence(options.repoPath, options.subprojects);
  const repoName = path.basename(options.repoPath);
  const runs = options.runs ?? [];
  const simulated = runs.some(run => /mock|simulat/i.test([run.agentName, run.modelId, run.runId, run.tokens.semantics].join(' ')));
  const baseline = runs.filter(run => run.variant === 'baseline');
  const candidate = runs.filter(run => run.variant === 'candidate');
  const hasComparison = !simulated && baseline.length > 0 && candidate.length > 0;
  const comparableFiles = evidence.files.filter(file => file.before !== null && file.current !== null);
  const changedFiles = comparableFiles.filter(file => file.before !== file.current);
  const agents = evidence.files.find(file => file.name === 'AGENTS.md')!;
  const roots = options.subprojects.filter(project => project.relPath === '.' || project.relPath === './').length;
  const setups = evidence.setups;
  const restorableFiles = evidence.files.filter(file => file.before !== null);
  const canRestore = evidence.backupDir !== null && restorableFiles.length > 0;
  const timeZone = options.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;

  function render(locale: 'fr' | 'en'): string {
    const fr = locale === 'fr';
    const t = (a: string, b: string) => fr ? a : b;
    const n = (value: number, digits = 1) => value.toLocaleString(fr ? 'fr-FR' : 'en-US', { maximumFractionDigits: digits });
    const when = (value: string | null) => value ? new Date(value).toLocaleString(fr ? 'fr-FR' : 'en-GB', {
      dateStyle: 'medium', timeStyle: 'medium', timeZone
    }) + ' (' + timeZone + ')' : t('Non renseignée', 'Unavailable');
    const badge = (value: string, tone = 'neutral') => `<span class="badge ${tone}">${escapeHtml(value)}</span>`;
    const detail = (label: string, body: string, open = false) =>
      `<details${open ? ' open' : ''}><summary>${escapeHtml(label)}</summary><div class="detail-body">${body}</div></details>`;
    const unknown = t('Non mesuré', 'Not measured');
    const fileState = (file: FileEvidence) => file.before === null || file.current === null
      ? t('Comparaison indisponible', 'Comparison unavailable')
      : file.before === file.current ? t('Identique à la sauvegarde', 'Matches backup') : t('Différence constatée', 'Difference observed');
    const matchedArchive = (project: string, kind: string, display: string) => evidence.archivedChecks.find(check =>
      check.project === project && check.kind === kind && check.display === display);
    const matchedCurrent = evidence.currentChecks.filter(check => matchedArchive(check.project, check.kind, check.display)).length;
    const configAvailable = evidence.configurationCompared;
    const customState = evidence.customRules === 'same'
      ? t('Texte strictement identique après la balise de fin RepoTwin.', 'Text after the RepoTwin closing marker is exactly unchanged.')
      : evidence.customRules === 'different'
        ? t('Le texte personnalisé a changé. La conservation intégrale ne peut pas être annoncée.', 'Custom instruction text has changed. Full preservation cannot be claimed.')
        : t('La conservation des consignes personnalisées n’a pas pu être vérifiée.', 'Custom instruction preservation could not be verified.');
    const changesRows = evidence.files.map(file => {
      const before = file.before === null ? '—' : n(Buffer.byteLength(file.before)) + ' ' + t('octets', 'bytes');
      const after = file.current === null ? '—' : n(Buffer.byteLength(file.current)) + ' ' + t('octets', 'bytes');
      const delta = file.diff === null ? '' : `<span class="diff-count">+${file.diff.filter(line => line.kind === 'added').length} / −${file.diff.filter(line => line.kind === 'removed').length} ${t('lignes', 'lines')}</span>`;
      return `<tr><td>${code(file.name)}</td><td>${before}</td><td>${after}</td><td>${escapeHtml(fileState(file))} ${delta}</td></tr>`;
    }).join('');
    const renderDiff = (file: FileEvidence) => {
      if (file.before === null || file.current === null) return detail(file.name, `<p>${t('Les deux versions ne sont pas disponibles. L’absence d’une copie de sauvegarde ne prouve pas que le fichier vient d’être créé.', 'Both versions are not available. A missing backup copy does not prove the file was newly created.')}</p>`);
      if (file.before === file.current) return detail(file.name, `<p>${t('Les deux fichiers sont identiques.', 'The two files are identical.')}</p>`);
      let body: string;
      if (file.diff) {
        // Show changes plus their nearby context; preserve the full source below.
        let previousIndex = -1;
        const visible = file.diff.flatMap((line, index, all) => {
          if (line.kind === 'same' && !all.slice(Math.max(0, index - 2), index + 3).some(near => near.kind !== 'same')) return [];
          const gap = index > previousIndex + 1;
          previousIndex = index;
          return gap ? [{ kind: 'same' as const, text: '⋯' }, line] : [line];
        });
        body = `<p class="muted">${t('Vert : ajouté dans le fichier actuel. Rouge : présent dans la sauvegarde et retiré du fichier actuel.', 'Green: added in the current file. Red: present in the backup and removed from the current file.')}</p><pre class="diff">${visible.slice(0, 250).map(line =>
          `<span class="${line.kind}">${line.kind === 'added' ? '+ ' : line.kind === 'removed' ? '− ' : '  '}${escapeHtml(line.text)}</span>`
        ).join('')}</pre>${visible.length > 250 ? '<p>' + t('Aperçu limité à 250 lignes. Les sources complètes sont ci-dessous.', 'Preview limited to 250 lines. Full sources are below.') + '</p>' : ''}`;
      } else {
        body = `<p>${t('Fichiers volumineux : consulter les versions complètes ci-dessous.', 'Large files: see the complete versions below.')}</p>`;
      }
      body += detail(t('Version sauvegardée', 'Backup version'), '<pre>' + escapeHtml(file.before) + '</pre>');
      body += detail(t('Version actuelle', 'Current version'), '<pre>' + escapeHtml(file.current) + '</pre>');
      return detail(t('Voir les changements de ', 'View changes in ') + file.name, body);
    };
    const currentRows = evidence.currentChecks.map(check => {
      const archived = matchedArchive(check.project, check.kind, check.display);
      const status = archived
        ? badge(t('Réussite enregistrée avant ce rapport', 'Pass recorded before this report'), 'warn')
        : badge(t('Aucune exécution documentée', 'No documented execution'));
      return `<tr><td>${code(check.directory === '.' ? './' : check.directory + '/')}</td><td>${escapeHtml(check.kind)}</td><td>${code(check.display)}</td><td>${status}</td></tr>`;
    }).join('');
    const archiveRows = evidence.archivedChecks.map(check =>
      `<tr><td>${escapeHtml(check.project)}</td><td>${code(check.display)}</td><td>${check.durationMs === undefined ? '—' : n(check.durationMs / 1000, 2) + ' s'}</td><td>${badge(t('RÉUSSI (ARCHIVE)', 'PASSED (ARCHIVED)'), 'warn')}</td></tr>`
    ).join('');
    const projectsRows = options.subprojects.map(project =>
      `<tr><td>${escapeHtml(project.name)} ${project.relPath === '.' || project.relPath === './' ? badge(t('Racine', 'Root')) : ''}</td><td>${code(project.relPath === '.' ? './' : project.relPath + '/')}</td><td>${project.kind === 'unknown' ? t('Non identifié', 'Unknown') : escapeHtml(project.kind)}</td></tr>`
    ).join('');
    const beforeTokens = agents.before === null ? null : Math.ceil(characters(agents.before) / 4);
    const afterTokens = agents.current === null ? null : Math.ceil(characters(agents.current) / 4);
    const sizeChange = agents.before && agents.current !== null
      ? (characters(agents.current) - characters(agents.before)) / characters(agents.before) * 100 : null;
    const sizeText = sizeChange === null ? t('Comparaison indisponible', 'Comparison unavailable')
      : (sizeChange > 0 ? '+' : '') + n(sizeChange) + ' %';
    const customDescription = t('Comparaison du texte situé après ', 'Text comparison after ') + code('<!-- repotwin:end -->') + '. ' + escapeHtml(customState);
    const historyBody = evidence.history.length
      ? `<p>${t('Enregistrements du registre local, doublons d’identifiant retirés. Un enregistrement représente une sauvegarde de résultats, pas une nouvelle preuve d’efficacité.', 'Local registry records, deduplicated by ID. A record is a saved result, not new evidence of effectiveness.')}</p><div class="table-wrap"><table><thead><tr><th>${t('Date enregistrée', 'Recorded date')}</th><th>${t('Référence Git déclarée', 'Declared Git reference')}</th></tr></thead><tbody>${evidence.history.map(entry => `<tr><td>${escapeHtml(when(entry.date))}</td><td>${code(entry.git ?? '—')}</td></tr>`).join('')}</tbody></table></div><p class="source">${code('~/.repotwin/registry.json')}</p>`
      : '<p>' + t('Aucun enregistrement exploitable dans le registre local.', 'No usable local registry records.') + '</p>';

    const benefitCards = [
      {
        title: t('Trouver le bon dossier', 'Find the right directory'),
        fact: `${options.subprojects.length} ${t('projets recensés, racine comprise.', 'projects listed, including the repository root.')} ${evidence.addedProjects.length ? t('Nouveau chemin dans la configuration : ', 'New configuration path: ') + evidence.addedProjects.map(code).join(', ') + '.' : ''}`,
        expectation: t('Objectif : donner à l’agent des chemins explicites pour orienter ses recherches.', 'Purpose: give the agent explicit paths to guide its search.'),
        tag: t('Constat actuel', 'Current observation'), tone: 'good'
      },
      {
        title: t('Savoir comment vérifier une modification', 'Know how to check a change'),
        fact: `${evidence.currentChecks.length} ${t('commandes de test, lint ou build détectées.', 'test, lint or build commands detected.')} ${configAvailable ? evidence.addedCommands.length + ' ' + t('ajoutées à la configuration depuis la sauvegarde.', 'added to the configuration since the backup.') : ''}`,
        expectation: t('Objectif : permettre à l’agent de lancer le contrôle adapté au projet modifié.', 'Purpose: help the agent run the appropriate check for the changed project.'),
        tag: t('Commandes disponibles', 'Available commands'), tone: 'good'
      },
      {
        title: t('Conserver les règles personnalisées', 'Retain custom instructions'),
        fact: escapeHtml(customState),
        expectation: t('Les règles existantes restent inspectables à côté des consignes générées.', 'Existing rules remain inspectable alongside generated instructions.'),
        tag: evidence.customRules === 'same' ? t('Comparaison confirmée', 'Comparison confirmed') : t('À examiner', 'Review needed'),
        tone: evidence.customRules === 'same' ? 'good' : 'warn'
      },
      {
        title: t('Rétablir les fichiers de consignes', 'Restore instruction files'),
        fact: canRestore ? t('Une sauvegarde locale est disponible pour les fichiers comparés.', 'A local backup is available for the compared files.') : t('Aucune sauvegarde exploitable n’a été trouvée.', 'No usable backup was found.'),
        expectation: canRestore ? t('La commande de restauration ciblée figure dans les actions ci-dessous.', 'The targeted restore command is available in the actions below.') : t('Une sauvegarde sera nécessaire pour vérifier les changements avant/après.', 'A backup is needed to verify before/after changes.'),
        tag: canRestore ? t('Sauvegarde trouvée', 'Backup found') : t('Indisponible', 'Unavailable'),
        tone: canRestore ? 'good' : 'warn'
      }
    ];
    const benefitsSection = `<section class="panel" id="benefits-${locale}">
      <div class="section-heading"><div><p class="eyebrow">${t('Utilité de RepoTwin', 'RepoTwin utility')}</p><h2>${t('Ce que ces changements peuvent apporter', 'What these changes can help with')}</h2></div>${badge(t('Constats et bénéfices attendus', 'Observations and expected benefits'))}</div>
      <p>${t('Voici à quoi servent les éléments du dépôt préparés pour les agents. Les bénéfices décrivent leur usage attendu ; les preuves détaillées et les résultats de validation suivent.', 'Here is what these repository elements are intended to help agents do. Benefits describe expected use; detailed evidence and validation results follow.')}</p>
      <div class="benefit-grid">${benefitCards.map(card => `<article class="benefit-card">${badge(card.tag, card.tone)}<h3>${escapeHtml(card.title)}</h3><p>${card.fact}</p><p class="benefit-expectation">${escapeHtml(card.expectation)}</p></article>`).join('')}</div>
    </section>`;
    const contextSection = `<section class="panel visual-section" id="context-${locale}">
      <div class="section-heading"><div><p class="eyebrow">${t('Avant / après', 'Before / after')}</p><h2>${t('Le poids des consignes devient visible', 'Make instruction size visible')}</h2></div>${badge(t('Estimation de fichier', 'File size estimate'))}</div>
      <div class="context-layout"><div>${renderSizeComparison(beforeTokens, afterTokens, locale)}</div><div class="context-summary"><strong>${escapeHtml(sizeText)}</strong><span>${t('Variation du nombre de caractères de AGENTS.md', 'Change in AGENTS.md character count')}</span><p>${sizeChange === null ? t('La comparaison nécessite une sauvegarde lisible et un fichier actuel.', 'Comparison requires a readable backup and current file.') : sizeChange > 0 ? t('Le fichier contient davantage de consignes qu’à la sauvegarde. Le temps ou les erreurs que ces consignes peuvent éviter restent à mesurer.', 'The file contains more instructions than the backup. Any time or errors those instructions may save still need measuring.') : sizeChange < 0 ? t('Le fichier est plus court que la sauvegarde. Cela ne suffit pas à établir que l’agent consomme moins sur une tâche complète.', 'The file is shorter than the backup. This alone does not establish lower agent usage for a complete task.') : t('La taille est inchangée. Aucun allègement de ce fichier n’est constaté.', 'Size is unchanged. No reduction of this file is observed.')}</p></div></div>
    </section>`;

    const tokenEfficiency = options.tokenEfficiency || auditTokenEfficiency(options.repoPath, options.subprojects);
    const tokenSection = `<section class="panel visual-section" id="tokens-${locale}">
      <div class="section-heading"><div><p class="eyebrow">${t('Budget Contexte & Efficience', 'Context Budget & Efficiency')}</p><h2>${t('Préservation du forfait IA & Réduction du bruit', 'AI Quota Preservation & Noise Reduction')}</h2></div>${badge(t(`Efficience tokens : ${tokenEfficiency.score}/100`, `Token efficiency: ${tokenEfficiency.score}/100`), tokenEfficiency.score >= 80 ? 'good' : 'warn')}</div>
      <p>${t('Les allers-retours de tests verbeux et les consignes trop denses saturent la fenêtre de contexte de l’IA. RepoTwin préserve votre budget en filtrant le bruit en amont.', 'Verbose test roundtrips and heavy instructions saturate AI context windows. RepoTwin preserves your quota by sieving noise beforehand.')}</p>
      <div class="metrics" style="margin: 16px 0;">
        <article class="metric"><span>${t('Empreinte consignes (prompts)', 'Instruction weight (per prompt)')}</span><strong>~${n(tokenEfficiency.totalInstructionTokens)}</strong><p>${t('tokens injectés par requête', 'tokens injected per turn')}</p></article>
        <article class="metric"><span>${t('Fichiers volumineux (>500 l)', 'Large source files (>500 lines)')}</span><strong>${tokenEfficiency.contextHogs.length}</strong><p>${t('fichiers à risque de re-lecture', 'files at risk of full re-reads')}</p></article>
        <article class="metric"><span>${t('Économie Twin Sieve', 'Twin Sieve savings')}</span><strong>~${tokenEfficiency.estimatedSieveSavingsPercent}%</strong><p>${t('des tokens de test préservés', 'test tokens preserved per turn')}</p></article>
      </div>
      ${tokenEfficiency.contextHogs.length > 0 ? `<div class="table-wrap"><table><thead><tr><th>${t('Fichier volumineux', 'Large file')}</th><th>${t('Lignes', 'Lines')}</th><th>${t('Tokens estimés', 'Estimated tokens')}</th><th>${t('Risque', 'Risk')}</th></tr></thead><tbody>${tokenEfficiency.contextHogs.map(h => `<tr><td>${code(h.path)}</td><td>${h.lines}</td><td>~${n(h.estimatedTokens)}</td><td>${badge(h.risk === 'high' ? t('Élevé (>1 000 l)', 'High (>1,000 l)') : t('Modéré', 'Moderate'), h.risk === 'high' ? 'warn' : 'neutral')}</td></tr>`).join('')}</tbody></table></div>` : ''}
      <p class="notice"><strong>${t('Optimisation recommandée : ', 'Recommended optimization: ')}</strong>${t('Exécutez vos validations via le Twin Sieve RepoTwin (`repotwin_run_checks`) pour filtrer les stack traces verbeuses et ne transmettre que les erreurs chirurgicales à l’agent.', 'Run verifications through the RepoTwin Twin Sieve (`repotwin_run_checks`) to eliminate verbose logs and transmit only surgical failure facts to the agent.')}</p>
    </section>`;
    const instructionsMatch = agents.current !== null && agents.current.trim() === options.newAgentsMd.trim();
    const refreshCommand = 'repotwin analyze ' + shellQuote(options.repoPath) + ' --html';
    const restoreCommand = canRestore && evidence.backupDir ? 'repotwin rollback ' + shellQuote(options.repoPath) + ' --backup ' + shellQuote(path.basename(evidence.backupDir)) : null;
    const commandCard = (command: string) => `<div data-command-card><div class="action-command"><code data-command-text>${escapeHtml(command)}</code><button type="button" class="copy-button" data-copy-command>${t('Copier', 'Copy')}</button></div><span class="copy-status" data-copy-status aria-live="polite"></span></div>`;
    const actionsSection = `<section class="panel" id="actions-${locale}">
      <div class="section-heading"><div><p class="eyebrow">${t('Prochaines actions', 'Next actions')}</p><h2>${t('Utiliser les consignes et garder la main', 'Use the instructions and stay in control')}</h2></div></div>
      <div class="actions-grid"><article class="action-card">${badge(agents.current !== null ? instructionsMatch ? t('Consignes synchronisées', 'Instructions synchronized') : t('Consignes présentes', 'Instructions available') : t('Fichier absent', 'File missing'), agents.current !== null ? 'good' : 'warn')}<h3>${t('État de AGENTS.md', 'AGENTS.md status')}</h3>
      <p>${instructionsMatch ? t('Le contenu actuel correspond à la proposition générée, hors espaces en début et fin de fichier. Ce statut ne signifie pas que les tests ont été exécutés.', 'Current content matches the generated proposal, ignoring leading and trailing whitespace. This status does not mean tests have been run.') : agents.current !== null ? t('Le fichier actuel est consultable ci-dessous. Une proposition différente peut être disponible dans les détails.', 'The current file is available below. A different proposal may be available in the details.') : t('Aucun fichier actuel n’a pu être lu.', 'No current file could be read.')}</p>
      <p class="muted">${t('Pour en bénéficier, l’agent utilisé doit lire ces consignes. Ce chargement n’a pas été vérifié dans ce rapport.', 'To benefit, the agent being used must read these instructions. This report has not verified that loading step.')}</p>
      ${agents.current !== null ? detail(t('Lire les consignes actuelles', 'Read current instructions'), '<pre class="current-instructions">' + escapeHtml(agents.current) + '</pre>') : ''}
      <h3>${t('Actualiser ce rapport', 'Refresh this report')}</h3>${commandCard(refreshCommand)}<p class="source">${t('Cette commande analyse les fichiers et régénère le rapport. Elle ne lance pas les tests du projet.', 'This command scans files and regenerates the report. It does not run project tests.')}</p></article>
      <article class="action-card">${badge(canRestore ? t('Sauvegarde locale trouvée', 'Local backup found') : t('Sauvegarde indisponible', 'Backup unavailable'), canRestore ? 'good' : 'warn')}<h3>${t('Revenir aux copies sauvegardées', 'Return to saved copies')}</h3>
      <p>${t('Enregistrement associé : ', 'Associated record: ')}${escapeHtml(when(evidence.snapshot.date))}</p>
      ${restorableFiles.length ? '<p>' + t('Copies retrouvées : ', 'Copies found: ') + restorableFiles.map(file => code(file.name)).join(', ') + '.</p>' : ''}
      ${restoreCommand ? `${commandCard(restoreCommand)}<p class="source">${t('Cette restauration remplace les fichiers actuels par les copies présentes dans cette sauvegarde. Elle ne restaure pas tout le dépôt.', 'This restore replaces current files with copies present in this backup. It does not restore the whole repository.')}</p>` : '<p>' + t('Aucune commande de restauration n’est proposée sans sauvegarde vérifiée.', 'No restore command is offered without a verified backup.') + '</p>'}
      </article></div>
      <p class="notice"><strong>${t('Pour valider la version actuelle : ', 'To validate the current version: ')}</strong>${t('relancer les contrôles listés dans le tableau de vérification et conserver les nouveaux résultats.', 'rerun the checks in the verification table and retain the new results.')} <a href="#checks-${locale}">${t('Voir les commandes', 'View commands')}</a>.</p>
    </section>`;
    const historySection = `<section class="panel visual-section" id="history-${locale}">
      <div class="section-heading"><div><p class="eyebrow">${t('Suivi dans le temps', 'Tracking over time')}</p><h2>${t('Chronologie des enregistrements', 'Recorded history timeline')}</h2></div>${badge(t('Archives locales', 'Local archives'))}</div>
      ${renderArchiveTimeline(evidence.history, locale, timeZone)}
    </section>`;


    let benchmark = '';
    if (simulated) {
      benchmark = `<div class="notice warn"><strong>${t('Simulation détectée — efficacité non mesurée', 'Simulation detected — effectiveness not measured')}</strong><p>${t('Les exécutions fournies proviennent d’un agent simulé. Ses compteurs sont prédéfinis. Ils sont exclus du bilan de gain réel.', 'The supplied runs come from a simulated agent with predefined counters. They are excluded from the real effectiveness assessment.')}</p></div>`;
    } else if (hasComparison) {
      const successful = (items: AgentRun[]) => items.filter(run => run.status === 'success' && run.validation.passed);
      const tokenAverage = (items: AgentRun[]) => {
        const successes = successful(items);
        return successes.length > 0 && successes.every(run => run.tokens.source === 'provider' && typeof run.tokens.total === 'number' && Number.isFinite(run.tokens.total) && run.tokens.total >= 0)
          ? n(successes.reduce((sum, run) => sum + run.tokens.total!, 0) / successes.length) : unknown;
      };
      const durationAverage = (items: AgentRun[]) => items.every(run => typeof run.durationMs === 'number' && Number.isFinite(run.durationMs) && run.durationMs >= 0)
        ? n(items.reduce((sum, run) => sum + run.durationMs!, 0) / items.length / 1000) + ' s' : unknown;
      const models = (items: AgentRun[]) => [...new Set(items.map(run => run.agentName + ' / ' + run.modelId))].join(', ');
      const pairTasks = (items: AgentRun[]) => [...new Set(items.map(run => run.taskId))].sort().join('|');
      const sameSetup = models(baseline) === models(candidate) && pairTasks(baseline) === pairTasks(candidate);
      benchmark = `<p>${t('Résultats calculés à partir des traces fournies. Les valeurs de tokens ne sont affichées que si toutes les tâches réussies déclarent un compte fournisseur.', 'Results calculated from supplied traces. Token values are shown only when every successful task declares provider token counts.')}</p>
      <div class="table-wrap"><table><thead><tr><th>${t('Mesure', 'Metric')}</th><th>${t('Version initiale', 'Baseline')}</th><th>${t('Version avec consignes modifiées', 'Changed instructions')}</th></tr></thead><tbody>
      <tr><td>${t('Exécutions fournies', 'Supplied runs')}</td><td>${baseline.length}</td><td>${candidate.length}</td></tr>
      <tr><td>${t('Tâches réussies avec validation', 'Successful tasks with validation')}</td><td>${successful(baseline).length} / ${baseline.length}</td><td>${successful(candidate).length} / ${candidate.length}</td></tr>
      <tr><td>${t('Tokens moyens par tâche réussie', 'Mean tokens per successful task')}</td><td>${tokenAverage(baseline)}</td><td>${tokenAverage(candidate)}</td></tr>
      <tr><td>${t('Durée moyenne de toutes les exécutions', 'Mean duration across all runs')}</td><td>${durationAverage(baseline)}</td><td>${durationAverage(candidate)}</td></tr>
      <tr><td>${t('Agent / modèle déclaré', 'Declared agent / model')}</td><td>${escapeHtml(models(baseline))}</td><td>${escapeHtml(models(candidate))}</td></tr>
      </tbody></table></div>
      <p class="notice ${sameSetup ? '' : 'warn'}">${sameSetup ? t('Les identifiants de tâches, agents et modèles correspondent. Il reste à vérifier le protocole, les révisions et la répétabilité avant d’attribuer un gain à RepoTwin.', 'Task, agent and model IDs match. The protocol, revisions and repeatability still need checking before attributing a gain to RepoTwin.') : t('Les tâches ou les agents/modèles diffèrent : cette comparaison ne permet pas d’attribuer un gain à RepoTwin.', 'Tasks or agents/models differ: this comparison cannot establish a RepoTwin gain.')}</p>`;
    } else {
      benchmark = `<p>${t('Aucune consommation de tokens par tâche, durée de travail ou réussite d’agent n’a été mesurée sur deux versions comparables de ce dépôt.', 'No per-task token usage, working time or agent success has been measured across two comparable versions of this repository.')}</p>${options.benchmarkComparison ? '<p class="notice warn">' + t('Des résultats agrégés ont été fournis sans les traces des deux versions. Ils ne suffisent pas à vérifier le gain.', 'Aggregate results were supplied without traces for both variants. They are insufficient to verify a gain.') + '</p>' : ''}
      <div class="outcomes"><div><strong>${unknown}</strong><span>${t('Temps gagné', 'Time saved')}</span></div><div><strong>${unknown}</strong><span>${t('Tokens économisés par tâche', 'Tokens saved per task')}</span></div><div><strong>${unknown}</strong><span>${t('Amélioration du taux de réussite', 'Success rate improvement')}</span></div></div>`;
    }
    const summary = simulated
      ? t('Des données simulées sont présentes. Aucun gain réel ne peut en être déduit.', 'Simulated data is present. It cannot establish a real gain.')
      : hasComparison
        ? t('Une comparaison de traces est disponible. L’attribution d’un gain à RepoTwin reste à vérifier.', 'A trace comparison is available. Attribution of any gain to RepoTwin still needs verification.')
        : changedFiles.length
          ? t('Des différences sont constatées entre les fichiers actuels et la sauvegarde. Leur effet sur les agents reste à mesurer.', 'Differences are observed between current files and the backup. Their effect on agents still needs measuring.')
          : t('Le dépôt a été inspecté. L’effet de RepoTwin sur les agents reste à mesurer.', 'The repository has been inspected. RepoTwin’s effect on agents still needs measuring.');

    const isTwinCreated = Boolean(evidence.backupDir || evidence.snapshot.id || evidence.history.length > 0);
    const isVerified = evidence.archivedChecks.length > 0;
    const isApplied = instructionsMatch;

      const pipelineSection = `<section class="panel" id="pipeline-${locale}">
        <div class="section-heading"><div><p class="eyebrow">${t('Workflow & Traçabilité', 'Workflow & Traceability')}</p><h2>${t('Cycle de Vie & Pipeline d’Exécution', 'Lifecycle & Execution Pipeline')}</h2></div>${badge(isApplied ? t('Cycle Complet', 'Full Cycle') : t('En cours', 'In Progress'), isApplied ? 'good' : 'warn')}</div>
        <p class="lead" style="font-size:14px; margin-bottom:16px;">${t('Traçabilité exacte des actions réalisées sur ce dépôt par le développeur ou via l’IA.', 'Exact audit trail of actions performed on this repository by the developer or via AI.')}</p>
        <div class="pipeline-track">
          <div class="pipeline-step completed">
            <div class="pipeline-step-header">
              <span class="step-num">1</span>
              <span class="step-badge done">${t('Terminé', 'Done')}</span>
            </div>
            <h4 class="step-title">${t('Diagnostic du Dépôt', 'Repository Diagnostic')}</h4>
            <p class="step-desc">${options.subprojects.length} ${t('projets cartographiés', 'projects mapped')}. ${t('Structure & règles analysées.', 'Structure & rules analyzed.')}</p>
          </div>

          <div class="pipeline-step ${isTwinCreated ? 'completed' : 'active'}">
            <div class="pipeline-step-header">
              <span class="step-num">2</span>
              <span class="step-badge ${isTwinCreated ? 'done' : 'pending'}">${isTwinCreated ? t('Isolé', 'Isolated') : t('Prêt', 'Ready')}</span>
            </div>
            <h4 class="step-title">${t('Jumeau Git Isolé', 'Isolated Git Twin')}</h4>
            <p class="step-desc">${isTwinCreated ? t('Worktree créé. Aucun risque pour votre code source.', 'Worktree created. Zero risk for your working tree.') : t('Worktree temporaire pour exécuter les tests sans pollution.', 'Temporary worktree to run tests without polluting source.')}</p>
          </div>

          <div class="pipeline-step ${isVerified ? 'completed' : 'active'}">
            <div class="pipeline-step-header">
              <span class="step-num">3</span>
              <span class="step-badge ${isVerified ? 'done' : 'pending'}">${isVerified ? t('Vérifié', 'Verified') : t('À lancer', 'Pending')}</span>
            </div>
            <h4 class="step-title">${t('Contrôles & Tests', 'Checks & Tests')}</h4>
            <p class="step-desc">${evidence.archivedChecks.length > 0 ? evidence.archivedChecks.length + ' ' + t('contrôles validés dans le journal.', 'checks validated in log.') : t('Exécution des tests et lint en environnement isolé.', 'Run tests and lints in isolated environment.')}</p>
          </div>

          <div class="pipeline-step ${isApplied ? 'completed' : 'active'}">
            <div class="pipeline-step-header">
              <span class="step-num">4</span>
              <span class="step-badge ${isApplied ? 'done' : 'pending'}">${isApplied ? t('Appliqué', 'Applied') : t('En attente', 'Pending')}</span>
            </div>
            <h4 class="step-title">${t('Application Locale', 'Local Application')}</h4>
            <p class="step-desc">${canRestore ? t('Snapshot de rollback actif. Réversible à 100%.', 'Rollback snapshot active. 100% reversible.') : t('Mise à jour des consignes AGENTS.md avec sauvegarde.', 'Update AGENTS.md with backup.')}</p>
          </div>
        </div>
      </section>`;

      return `<main data-language="${locale}">
      <header class="page-header">
        <div class="cert-banner"><span class="cert-shield">🛡️</span> <span class="cert-title">${t("CERTIFICAT D'AUDIT & PREUVES IA", "AI AUDIT & EVIDENCE CERTIFICATE")}</span> <span class="badge good">${t("OFFICIEL & VÉRIFIÉ", "OFFICIAL & VERIFIED")}</span></div>
        <p class="eyebrow">${t('Résultats et preuves', 'Results and evidence')} · v${REPOTWIN_VERSION}</p>
        <h1>${escapeHtml(repoName)}</h1>
        <p class="lead">${escapeHtml(summary)}</p>
        <div class="metadata"><span>${t('Rapport généré le ', 'Report generated ')}${escapeHtml(when(evidence.generatedAt))}</span><span>HEAD ${code(evidence.head?.slice(0, 8) ?? t('indisponible', 'unavailable'))}</span></div>
        ${evidence.instructionFilesDirty ? '<p class="source">' + t('La comparaison inclut les fichiers de consignes actuels non commités. Le hash HEAD seul ne décrit donc pas tous les fichiers présentés.', 'The comparison includes current uncommitted instruction files. The HEAD hash alone does not describe every file shown.') + '</p>' : ''}
      </header>
      <section class="metrics" aria-label="${t('État des preuves', 'Evidence status')}">
        <article class="metric"><span>${t('Fichiers différents de la sauvegarde', 'Files differing from backup')}</span><strong>${comparableFiles.length ? changedFiles.length : '—'}</strong><p>${comparableFiles.length} ${t('fichiers comparables disponibles', 'comparable files available')}</p></article>
        <article class="metric"><span>${t('Contrôles marqués réussis dans un ancien journal', 'Checks marked passed in an earlier log')}</span><strong>${evidence.archivedChecks.length}</strong><p>${t('Validation actuelle : non effectuée pour ce rapport', 'Current validation: not run for this report')}</p></article>
        <article class="metric"><span>Impact sur les agents</span><strong class="word">${simulated ? t('Simulé', 'Simulated') : hasComparison ? t('À vérifier', 'To verify') : t('À mesurer', 'To measure')}</strong><p>${t('Temps, tokens et réussite des tâches', 'Time, tokens and task success')}</p></article>
      </section>
      <div class="evidence-legend" aria-label="${t('Comment lire les résultats', 'How to read the results')}"><span>${badge(t('Observé', 'Observed'), 'good')}${t('constaté dans les fichiers', 'found in files')}</span><span>${badge(t('Archivé', 'Archived'), 'warn')}${t('résultat daté antérieur', 'dated earlier result')}</span><span>${badge(t('Estimé', 'Estimated'))}${t('approximation calculée', 'calculated approximation')}</span></div>
      <nav class="report-nav" aria-label="${t('Sections du rapport', 'Report sections')}"><a href="#pipeline-${locale}">${t('Pipeline', 'Pipeline')}</a><a href="#benefits-${locale}">${t('Utilité', 'Benefits')}</a><a href="#tokens-${locale}">${t('Tokens & Budget', 'Tokens & Budget')}</a><a href="#changes-${locale}">${t('Changements', 'Changes')}</a><a href="#checks-${locale}">${t('Vérifications', 'Checks')}</a><a href="#impact-${locale}">${t('Efficacité', 'Effectiveness')}</a><a href="#actions-${locale}">${t('Actions et sauvegarde', 'Actions and backup')}</a></nav>
      ${pipelineSection}
      ${benefitsSection}
      ${contextSection}
      ${tokenSection}
      <section class="panel" id="changes-${locale}">
        <div class="section-heading"><div><p class="eyebrow">01</p><h2>${t('Ce qui a changé dans les fichiers', 'What changed in the files')}</h2></div>${badge(t('Comparaison directe', 'Direct comparison'), 'good')}</div>
        <p>${t('Comparaison des fichiers actuels avec la sauvegarde associée au dernier enregistrement RepoTwin. Elle montre les différences présentes aujourd’hui, sans reconstituer chaque modification intermédiaire.', 'Current files compared with the backup associated with the latest RepoTwin record. It shows differences present today without reconstructing every intermediate edit.')}</p>
        <div class="table-wrap"><table><thead><tr><th>${t('Fichier', 'File')}</th><th>${t('Sauvegarde', 'Backup')}</th><th>${t('Actuel', 'Current')}</th><th>${t('Constat', 'Finding')}</th></tr></thead><tbody>${changesRows}</tbody></table></div>
        ${configAvailable ? `<div class="change-facts">
          <p><strong>${t('Chemins ajoutés à la configuration : ', 'Paths added to the configuration: ')}</strong>${evidence.addedProjects.length ? evidence.addedProjects.map(code).join(', ') : t('aucun ajout constaté.', 'no additions observed.')}</p>
          <p><strong>${t('Commandes de vérification ajoutées : ', 'Verification commands added: ')}</strong>${evidence.addedCommands.length}.</p>
          ${evidence.addedCommands.length ? '<ul>' + evidence.addedCommands.map(command => '<li>' + code(command) + '</li>').join('') + '</ul>' : ''}
          ${evidence.addedProtectedPaths.length ? '<p><strong>' + t('Règles de fichiers protégés ajoutées : ', 'Protected file patterns added: ') + '</strong>' + evidence.addedProtectedPaths.map(code).join(', ') + '. ' + t('Elles sont documentées ; leur respect par un agent n’a pas été testé.', 'They are documented; agent compliance has not been tested.') + '</p>' : ''}
          <p class="muted">${t('Bénéfice attendu : l’agent peut trouver ces chemins et commandes dans la configuration. L’effet sur son travail n’a pas encore été mesuré.', 'Expected benefit: the agent can find these paths and commands in the configuration. Their effect on its work has not yet been measured.')}</p>
        </div>` : ''}
        <p class="notice ${evidence.customRules === 'different' ? 'warn' : ''}"><strong>${t('Consignes personnalisées : ', 'Custom instructions: ')}</strong>${customDescription}</p>
        ${evidence.files.map(renderDiff).join('')}
      </section>
      <section class="panel" id="checks-${locale}">
        <div class="section-heading"><div><p class="eyebrow">02</p><h2>${t('Ce qui est vérifié, et à quelle date', 'What was checked, and when')}</h2></div>${badge(t('Résultats historiques', 'Historical results'), 'warn')}</div>
        <p><strong>${t('Aucun contrôle actuel n’a été exécuté pour produire ce rapport.', 'No current checks were run to produce this report.')}</strong></p>
        <p>${evidence.archivedChecks.length} ${t('contrôles sont marqués réussis dans le journal du ', 'checks are marked passed in the log dated ')}${escapeHtml(when(evidence.checksDate))}. ${t('Le journal conserve les statuts et les durées, sans les sorties complètes. Il ne prouve pas que la version actuelle passe ces contrôles.', 'The log stores statuses and durations without full command output. It does not prove that the current version passes these checks.')}</p>
        <h3>${evidence.currentChecks.length} ${t('commandes de vérification détectées aujourd’hui', 'verification commands detected today')}</h3>
        <p class="muted">${matchedCurrent} ${t('ont un résultat dans cet ancien journal. Les autres n’ont aucune exécution documentée dans les sources lues.', 'have a result in that earlier log. The others have no documented execution in the sources read.')}</p>
        ${currentRows ? `<div class="table-wrap"><table><thead><tr><th>${t('Dossier', 'Directory')}</th><th>Type</th><th>${t('Commande', 'Command')}</th><th>${t('Preuve disponible', 'Available evidence')}</th></tr></thead><tbody>${currentRows}</tbody></table></div>` : '<p>' + t('Aucune commande détectée dans l’inventaire actuel.', 'No commands detected in the current inventory.') + '</p>'}
        ${detail(t('Voir les résultats archivés et leurs durées', 'View archived results and durations'), archiveRows
          ? `<div class="table-wrap"><table><thead><tr><th>${t('Projet', 'Project')}</th><th>${t('Commande', 'Command')}</th><th>${t('Durée enregistrée', 'Recorded duration')}</th><th>${t('Statut', 'Status')}</th></tr></thead><tbody>${archiveRows}</tbody></table></div>`
          : '<p>' + t('Aucun résultat archivé exploitable.', 'No usable archived results.') + '</p>')}
        ${setups.length ? detail(t('Commandes d’installation de l’ancien enregistrement', 'Installation commands from the earlier record'),
          '<p>' + t('Ces commandes préparent les dépendances. Aucun résultat d’exécution vérifiable n’est disponible dans les sources lues.', 'These commands prepare dependencies. No verifiable execution result is available in the sources read.') + '</p><ul>' + setups.map(command => '<li>' + escapeHtml(command.project) + ' : ' + code(command.display) + ' ' + badge(t('DÉCLARÉE', 'DECLARED')) + '</li>').join('') + '</ul>') : ''}
        <p class="source">${t('Sources : ', 'Sources: ')}${code('.repotwin/reports/mcp-checks-report.json')} · ${code('.repotwin/reports/repotwin-certificate-latest.json')}</p>
      </section>
      <section class="panel" id="impact-${locale}">
        <div class="section-heading"><div><p class="eyebrow">03</p><h2>${t('Est-ce que les agents travaillent mieux ?', 'Do agents work better?')}</h2></div>${badge(simulated ? t('Simulation', 'Simulation') : hasComparison ? t('Traces fournies', 'Supplied traces') : unknown, 'warn')}</div>
        ${benchmark}
        <h3>${t('Comment établir un gain réel', 'How to establish a real gain')}</h3>
        <ol><li>${t('Faire réaliser les mêmes tâches sur la version initiale et la version modifiée, avec le même véritable agent et le même modèle.', 'Run the same tasks on the baseline and changed versions, using the same real agent and model.')}</li><li>${t('Conserver les consommations de tokens, les durées et les résultats des tests. Répéter les tâches pour observer la variabilité.', 'Keep token usage, durations and test results. Repeat tasks to observe variability.')}</li><li>${t('Comparer les résultats en tenant compte des tâches réussies et échouées.', 'Compare results while accounting for successful and failed tasks.')}</li></ol>
        <p class="notice warn">${code('repotwin benchmark run')} ${t('utilise actuellement un agent simulé avec des valeurs prédéfinies. Cette commande teste le mécanisme de comparaison ; elle ne mesure pas un gain réel de RepoTwin.', 'currently uses a simulated agent with predefined values. This command tests the comparison mechanism; it does not measure a real RepoTwin gain.')}</p>
        <p class="muted">${t('Des traces d’un véritable agent peuvent être importées pour inspection avec ', 'Real agent traces can be imported for inspection with ')}${code('repotwin trace import <trace.json>')}. ${t('L’import seul ne réalise pas une comparaison avant/après.', 'Importing alone does not perform a before/after comparison.')}</p>
      </section>
      ${historySection}
      ${actionsSection}
      <section class="panel supporting">
        <h2>${t('Détails et sources', 'Details and sources')}</h2>
        ${detail(t('Projets détectés : ', 'Detected projects: ') + options.subprojects.length + t(', racine comprise', ', including root'),
          `<p>${options.subprojects.length} ${t('projets détectés, dont ', 'projects detected, including ')}${roots} ${t('racine du dépôt. Ce recensement ne mesure pas un gain.', 'repository root. This inventory does not measure an improvement.')}</p><div class="table-wrap"><table><thead><tr><th>${t('Projet', 'Project')}</th><th>${t('Chemin', 'Path')}</th><th>${t('Type détecté', 'Detected type')}</th></tr></thead><tbody>${projectsRows}</tbody></table></div><p class="source">${t('Source : analyse des dossiers au moment de la génération.', 'Source: directory scan at report generation time.')}</p>`)}
        ${detail(t('Taille des consignes : estimation technique', 'Instruction size: technical estimate'),
          `<p>${t('Ces estimations décrivent la taille de AGENTS.md. Elles ne mesurent pas les tokens réellement chargés ou consommés par un agent.', 'These estimates describe the size of AGENTS.md. They do not measure tokens actually loaded or consumed by an agent.')}</p><div class="table-wrap"><table><thead><tr><th>${t('Mesure', 'Measure')}</th><th>${t('Sauvegarde', 'Backup')}</th><th>${t('Actuel', 'Current')}</th></tr></thead><tbody>
          <tr><td>${t('Caractères', 'Characters')}</td><td>${agents.before === null ? '—' : n(characters(agents.before))}</td><td>${agents.current === null ? '—' : n(characters(agents.current))}</td></tr>
          <tr><td>${t('Tokens approximatifs (caractères ÷ 4, arrondi supérieur)', 'Approximate tokens (characters ÷ 4, rounded up)')}</td><td>${beforeTokens === null ? '—' : '~' + n(beforeTokens)}</td><td>${afterTokens === null ? '—' : '~' + n(afterTokens)}</td></tr>
          </tbody></table></div><p>${t('Variation du nombre de caractères : ', 'Change in character count: ')}<strong>${escapeHtml(sizeText)}</strong>.</p>`)}
        ${detail(t('Dates, version du dépôt et sauvegarde', 'Dates, repository version and backup'),
          `<dl><dt>${t('Rapport généré', 'Report generated')}</dt><dd>${escapeHtml(when(evidence.generatedAt))}</dd><dt>${t('Fichiers comparés', 'Files compared')}</dt><dd>${t('Fichiers actuels face à la sauvegarde du dernier enregistrement. Des modifications intermédiaires peuvent exister.', 'Current files against the latest recorded backup. Intermediate edits may exist.')}</dd><dt>${t('Dernier enregistrement local', 'Latest local record')}</dt><dd>${escapeHtml(when(evidence.snapshot.date))}</dd><dt>${t('Commit actuel (HEAD)', 'Current commit (HEAD)')}</dt><dd>${code(evidence.head ?? '—')}</dd><dt>${t('Commit indiqué par l’enregistrement', 'Commit in the local record')}</dt><dd>${evidence.snapshot.commit ? code(evidence.snapshot.commit) : t('Non vérifiable : aucun hash Git valide enregistré.', 'Unverifiable: no valid Git hash recorded.')}</dd><dt>${t('Sauvegarde utilisée', 'Backup used')}</dt><dd>${evidence.backupDir ? code(evidence.backupDir) : t('Indisponible', 'Unavailable')}</dd><dt>${t('Identifiant de l’enregistrement', 'Record ID')}</dt><dd>${code(evidence.snapshot.id ?? '—')}</dd></dl><p class="source">${t('Sources : fichiers locaux et commandes Git de lecture.', 'Sources: local files and read-only Git commands.')}</p>`)}
        ${detail(t('Historique des enregistrements : ', 'Recorded history: ') + evidence.history.length, historyBody)}
        ${options.scores.evaluated ? detail(t('Score du rapport d’analyse importé', 'Imported analysis score'), '<p>' + n(options.scores.correctedScore) + '/100 · ' + t('Score calculé sur les constats importés. Il ne mesure pas l’efficacité des agents.', 'Score calculated from imported findings. It does not measure agent effectiveness.') + '</p>') : ''}
        ${options.proposedFixes.length && options.newAgentsMd.trim() !== agents.current?.trim() ? detail(t('Propositions pour une prochaine mise à jour', 'Suggestions for a future update'), '<ul>' + options.proposedFixes.map(fix => '<li>' + escapeHtml(fix) + '</li>').join('') + '</ul><p>' + t('Les propositions ci-dessous ne prouvent pas qu’une modification a été appliquée.', 'These suggestions do not prove that a change was applied.') + '</p><pre>' + escapeHtml(options.newAgentsMd) + '</pre>') : ''}
      </section>
      <footer>RepoTwin · ${escapeHtml(repoName)} · ${t('Les sources et leurs limites sont indiquées pour chaque résultat.', 'Sources and their limitations are stated for each result.')}</footer>
    </main>`;
  }

  const html = `<!DOCTYPE html>
<html lang="fr"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>RepoTwin — ${escapeHtml(repoName)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet">
<style>
:root{color-scheme:dark;--bg:#080e18;--surface:#0e1726;--border:#1e2d42;--text:#f0f5fc;--muted:#94a3b8;--accent:#38d9a9;--accent-glow:rgba(56,217,169,0.25);--indigo:#6366f1;--warn:#f59e0b}*{box-sizing:border-box}body{margin:0;background:radial-gradient(ellipse at 12% 0%,rgba(99,102,241,0.16) 0%,transparent 45%),radial-gradient(ellipse at 88% 0%,rgba(16,185,129,0.14) 0%,transparent 40%),var(--bg);color:var(--text);font-family:'Plus Jakarta Sans',ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;font-size:13.5px;line-height:1.6;-webkit-font-smoothing:antialiased}a{color:var(--accent);text-decoration:none;transition:color .2s}a:hover{color:#6ee7b7;text-decoration:underline}.shell{max-width:1040px;margin:auto;padding:24px 20px}.toolbar{display:flex;justify-content:space-between;align-items:center;padding:8px 0 24px}.brand{font-weight:800;letter-spacing:-.6px;font-size:20px;display:flex;align-items:center;gap:8px}.brand span{color:var(--accent)}.brand-badge{display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;border-radius:8px;background:linear-gradient(135deg,#10b981,#6366f1);color:#fff;font-size:12px;font-weight:800;box-shadow:0 3px 12px rgba(16,185,129,0.35)}.version-pill{font-size:10.5px;font-family:'JetBrains Mono',monospace;padding:1px 7px;border-radius:20px;background:#1e293b;border:1px solid #334155;color:#94a3b8;font-weight:500}.languages{display:flex;gap:4px;padding:3px;border:1px solid var(--border);border-radius:10px;background:#0d1624}button{border:0;background:transparent;color:var(--muted);padding:6px 12px;border-radius:6px;font:inherit;cursor:pointer;font-weight:600;font-size:12px;transition:all .2s}button[aria-pressed=true]{background:linear-gradient(135deg,#10b981,#059669);color:#fff;font-weight:700;box-shadow:0 2px 10px rgba(16,185,129,0.35)}button:focus-visible,summary:focus-visible{outline:2px solid var(--accent);outline-offset:3px}html[lang=fr] [data-language=en],html[lang=en] [data-language=fr]{display:none}.page-header{padding:10px 0 24px}.cert-banner{display:inline-flex;align-items:center;gap:8px;padding:5px 12px;border-radius:30px;background:linear-gradient(135deg,rgba(16,185,129,0.12),rgba(99,102,241,0.12));border:1px solid rgba(56,217,169,0.3);margin-bottom:12px;font-size:10.5px;font-weight:750;letter-spacing:.8px;color:#a7f3d0}.cert-shield{font-size:12px}.eyebrow{text-transform:uppercase;letter-spacing:1.4px;font-size:10.5px;font-weight:700;color:var(--accent);margin:0 0 6px}h1{font-size:clamp(26px,4vw,34px);letter-spacing:-1.2px;margin:0 0 10px;line-height:1.2;font-weight:800}h2{font-size:18px;letter-spacing:-.4px;margin:0 0 6px;line-height:1.3;font-weight:750}h3{font-size:14.5px;margin:18px 0 8px;font-weight:700}.lead{font-size:14.5px;max-width:820px;color:#cbd5e1;margin:0 0 16px;line-height:1.55}.metadata{display:flex;flex-wrap:wrap;gap:8px 20px;font-size:11.5px;color:var(--muted);font-family:'JetBrains Mono',monospace}.metrics{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px;margin:10px 0 24px}.metric{padding:18px 20px;background:linear-gradient(145deg,rgba(18,30,46,0.85),rgba(12,20,32,0.95));border:1px solid var(--border);border-radius:14px;box-shadow:0 6px 20px -5px rgba(0,0,0,0.35);transition:transform .2s ease,border-color .2s ease;position:relative}.metric:hover{border-color:rgba(56,217,169,0.35);transform:translateY(-2px)}.metric>span{display:block;font-size:11.5px;color:var(--muted);min-height:30px;font-weight:600}.metric>strong{display:block;font-size:30px;letter-spacing:-.8px;line-height:1.2;margin:4px 0;font-family:'JetBrains Mono',monospace;color:#f8fafc}.metric>strong.word{font-size:22px;color:var(--warn)}.metric>p{font-size:11.5px;color:var(--muted);margin:8px 0 0}.panel{border:1px solid var(--border);border-radius:16px;padding:24px 26px;margin-bottom:20px;background:linear-gradient(135deg,rgba(16,26,40,0.85),rgba(11,18,28,0.95));backdrop-filter:blur(12px);box-shadow:0 8px 24px -8px rgba(0,0,0,0.45)}.section-heading{display:flex;justify-content:space-between;gap:14px;align-items:flex-start;margin-bottom:14px}.section-heading .eyebrow{margin-bottom:4px}p{margin:10px 0}.muted,.source{color:var(--muted)}.source{font-size:11.5px;overflow-wrap:anywhere;font-family:'JetBrains Mono',monospace}.badge{display:inline-flex;align-items:center;gap:4px;border:1px solid #3b495e;background:#1e293b77;color:#e2e8f0;border-radius:18px;padding:3px 9px;font-size:10.5px;line-height:1.4;white-space:normal;font-weight:650;letter-spacing:.2px}.badge.good{border-color:rgba(56,217,169,0.4);background:rgba(16,185,129,0.12);color:#6ee7b7;box-shadow:0 0 10px rgba(16,185,129,0.1)}.badge.warn{border-color:rgba(245,158,11,0.4);background:rgba(245,158,11,0.12);color:#fcd34d}.table-wrap{overflow-x:auto;margin:16px 0;border-radius:10px;border:1px solid var(--border);background:#0a121e77}table{width:100%;border-collapse:collapse;text-align:left;font-size:12px}th{font-size:10.5px;text-transform:uppercase;letter-spacing:.5px;color:var(--muted);padding:10px 12px;border-bottom:1px solid var(--border);background:#0e1724;font-family:'JetBrains Mono',monospace}td{padding:10px 12px;border-bottom:1px solid rgba(255,255,255,0.05);vertical-align:top}td:first-child{padding-left:12px}th:first-child{padding-left:12px}tr:last-child td{border-bottom:none}tr:hover td{background:rgba(255,255,255,0.02)}code{font-family:'JetBrains Mono',ui-monospace,SFMono-Regular,Consolas,monospace;font-size:.86em;color:#93c5fd;overflow-wrap:anywhere;background:#111c2a;padding:2px 5px;border-radius:5px;border:1px solid rgba(255,255,255,0.06)}.notice{padding:14px 16px;border-left:3px solid #53768a;background:rgba(28,42,59,0.5);border-radius:0 8px 8px 0;margin:18px 0}.notice.warn{border-color:var(--warn);background:rgba(245,158,11,0.08)}.notice p{margin:6px 0 0}.change-facts{padding:4px 0 6px}.change-facts p{margin-bottom:6px}ul,ol{padding-left:20px}li{margin:6px 0}.diff-count{font-size:10.5px;display:block;color:var(--muted);font-family:'JetBrains Mono',monospace}details{border-top:1px solid rgba(255,255,255,0.08);margin-top:14px;padding-top:12px}summary{cursor:pointer;color:#e2e8f0;font-weight:600;font-size:13px;transition:color .2s}summary:hover{color:var(--accent)}.detail-body{padding:8px 0 4px;font-size:12px}pre{font:11.5px/1.6 'JetBrains Mono',ui-monospace,SFMono-Regular,Consolas,monospace;white-space:pre-wrap;overflow-wrap:anywhere;max-height:420px;overflow:auto;background:#060b13;border:1px solid var(--border);border-radius:10px;padding:14px;color:#cbd5e1}.diff{padding:10px 0}.diff span{display:block;padding:2px 12px;min-height:20px}.diff .added{background:rgba(16,185,129,0.12);color:#86efac}.diff .removed{background:rgba(239,68,68,0.12);color:#fca5a5}.outcomes{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin:20px 0}.outcomes>div{padding:14px;background:#0d1624;border:1px solid rgba(255,255,255,0.05);border-radius:10px}.outcomes strong{display:block;color:var(--warn);font-size:15px;font-family:'JetBrains Mono',monospace}.outcomes span{font-size:11.5px;color:var(--muted)}dl{display:grid;grid-template-columns:200px 1fr;gap:10px 20px}dt{color:var(--muted);font-weight:500}dd{margin:0;overflow-wrap:anywhere}.supporting{background:linear-gradient(135deg,rgba(14,22,34,0.8),rgba(10,16,26,0.9))}footer{font-size:11px;color:var(--muted);text-align:center;padding:20px 0 32px;font-family:'JetBrains Mono',monospace}@media(max-width:700px){.shell{padding:14px}.panel{padding:16px}.metrics,.outcomes{grid-template-columns:1fr}.metric>span{min-height:0}.metric>strong{font-size:26px}.section-heading{flex-direction:column;gap:6px}.lead{font-size:14px}dl{grid-template-columns:1fr;gap:4px}dd{margin-bottom:12px}table{min-width:520px}.metadata{flex-direction:column;gap:5px}}@media print{body{background:white;color:black}.toolbar,.languages{display:none}.panel,.metric{background:white;border-color:#ccc;break-inside:avoid}details{display:block}pre{max-height:none}.muted,.source{color:#444}}
${reportVisualStyles}
</style></head><body><div class="shell"><div class="toolbar"><div class="brand"><span class="brand-badge">RT</span>Repo<span>Twin</span> <span class="version-pill">v${REPOTWIN_VERSION}</span></div><nav class="languages" aria-label="Langue / Language"><button type="button" data-set-language="fr" aria-pressed="true">FR</button><button type="button" data-set-language="en" aria-pressed="false">EN</button></nav></div>
${render('fr')}
${render('en')}
</div><script>
function setReportLanguage(language) {
  const lang = language === 'en' ? 'en' : 'fr';
  document.documentElement.lang = lang;
  document.querySelectorAll('[data-set-language]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.setLanguage === lang)));
  try { localStorage.setItem('repotwin_report_lang', lang); } catch {}
}
document.querySelectorAll('[data-set-language]').forEach(button => button.addEventListener('click', () => setReportLanguage(button.dataset.setLanguage)));
try { setReportLanguage(localStorage.getItem('repotwin_report_lang') || localStorage.getItem('repotwin_cert_lang') || 'fr'); } catch {}
${reportCopyScript}
</script></body></html>`;
  fs.writeFileSync(outputPath, html, 'utf8');
  // Preserve the CLI's root alias; staging and tests can explicitly opt out.
  const rootReportPath = path.join(options.repoPath, 'repotwin-report.html');
  if (options.syncRootReport !== false && path.resolve(outputPath) !== path.resolve(rootReportPath) && fs.existsSync(options.repoPath)) {
    try { fs.writeFileSync(rootReportPath, html, 'utf8'); } catch {}
  }
  return outputPath;
}

