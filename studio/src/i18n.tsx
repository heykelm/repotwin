import { useState, createContext, useContext, ReactNode } from 'react';

export type Language = 'en' | 'fr';

export const translations = {
  en: {
    // Nav & Stages
    nav_diagnostic: 'Diagnostic',
    nav_proposal: 'Proposal',
    nav_verification: 'Verification',
    nav_application: 'Application',
    stage_repo_suffix: 'for repository',
    tab_instructions: 'Repository Instructions',
    tab_comparison: 'Compare Two Versions',

    // Header & Actions
    header_analyzed_at: 'analyzed at',
    header_clean_session: 'Clean Session',
    action_review_proposal: 'Review Proposal',
    action_create_twin: 'Create Twin Candidate',
    action_authorize_verify: 'Authorize & Verify',
    action_rerun_verification: 'Rerun Verification',
    action_review_before_apply: 'Review Before Apply',
    action_apply_files: 'Apply with Backup',
    action_finish_clean: 'Finish & Clean',
    action_clean: 'Clean Worktrees',
    action_retry_failed: 'Retry Failed Only',
    action_retry_all: 'Rerun All Checks',

    // Status & Badges
    status_idle: 'Initial analysis completed',
    status_created: 'Twin candidate created · authorization required',
    status_verified: 'Candidate verified · ready to apply',
    status_failed: 'Verification blocked · check failing controls',
    status_applied: 'Files applied locally with backup',

    workflow_hint_idle: 'No repository files have been modified.',
    workflow_hint_created: 'Nothing executes before your explicit confirmation.',
    workflow_hint_failed: 'Check failing controls before rerunning.',
    workflow_hint_verified: 'Diff remains visible before applying.',
    workflow_hint_applied: 'Applied locally. No commit or push performed.',

    // Diagnostic
    diag_findings_title: 'Points to Review',
    diag_findings_desc: '{count} documentation finding(s), without executing project code.',
    diag_no_findings: 'No documentation findings.',
    diag_subprojects_title: 'Detected Subprojects & Validations',
    diag_subprojects_desc: '{count} recognized project scope(s). Commands are not executed yet.',
    diag_scores_title: 'Documentation Scores & Imported Report',
    diag_false_positives_title: 'Reclassified Observations ({count})',
    diag_health_score: 'Agent Instruction Health Score',
    diag_findings_resolved: 'Anomalies to resolve',
    diag_subprojects_detected: 'Subprojects detected',
    diag_false_positives: 'False positives eliminated',
    diag_raw_score: 'Raw Scanner Score',
    diag_true_issues: 'Issues to Fix',

    // ROI & Tokens
    roi_title: 'Token Economy & AI Subscriptions ROI',
    roi_subtitle: 'Check your active dev AI subscriptions to calculate cumulative token savings & quota ROI:',
    roi_no_selection: 'No subscription selected',
    roi_tools_combined: '{count} subscriptions combined',
    roi_tokens_per_prompt: 'Tokens / prompt (Context)',
    roi_compact_context: 'Compact context shared across all your AI tools',
    roi_monthly_savings: 'Cumulative Savings (~{queries} req/m)',
    roi_yearly_badge: '{usd} $/yr',
    roi_zero_tools_prompt: 'Check one or more subscriptions above to calculate your ROI',
    roi_benefits: 'Cumulative Benefits ({count})',
    roi_benefits_empty: 'Enable Cursor, Claude, Gemini, ChatGPT or Copilot to see specific quotas saved.',

    // Verification
    verify_title: 'Verification Tracking',
    verify_parallel_running: '{count} checks running in parallel',
    verify_subproject_concurrency: 'Safe subproject concurrency enabled',
    verify_copy_prompt: 'Copy health report for AI repair',
    verify_all_passed: 'All {count} commands passed with 0 regression.',
    verify_blocked_title: 'Application Blocked ({count} failing check(s))',
    verify_blocked_desc: '{passed}/{total} commands passed. Use preformatted prompts below each check to guide your AI agent in fixing issues.',

    // Application & Certificate
    app_certified_title: 'Applied Files & Certified Snapshot',
    app_certified_badge: 'Optimization & Deployment Certificate',
    app_certified_desc: 'Optimal instruction configuration applied to {repo}. A tamper-proof backup and verification proof have been saved.',
    app_open_html: 'Open HTML Certificate',
    app_download_json: 'Audit JSON',
    app_before_after: 'Before / After Evolution',
    app_score_gain: '+{gain} pts (initially {before}/100 · {grade})',
    app_zero_regression: '0 regression across project commands',
    app_controls_passed: '100% green in isolated Git Twin',
    app_backup_path: 'Stored under .repotwin/backups/',
    app_view_diff: 'View certified applied diff',
    app_review_checks: 'Review verification checks',

    // Comparison Tab
    comp_title: 'Compare Two Revisions',
    comp_btn: 'Authorize & Compare',

    // Lang toggle
    lang_toggle: 'FR'
  },
  fr: {
    // Nav & Stages
    nav_diagnostic: 'Diagnostic',
    nav_proposal: 'Proposition',
    nav_verification: 'Vérification',
    nav_application: 'Application',
    stage_repo_suffix: 'du dépôt',
    tab_instructions: 'Instructions du dépôt',
    tab_comparison: 'Comparer deux versions',

    // Header & Actions
    header_analyzed_at: 'analysé à',
    header_clean_session: 'Nettoyer la session',
    action_review_proposal: 'Examiner la proposition',
    action_create_twin: 'Créer le Twin',
    action_authorize_verify: 'Autoriser et vérifier',
    action_rerun_verification: 'Relancer les vérifications',
    action_review_before_apply: 'Examiner avant application',
    action_apply_files: 'Appliquer les fichiers',
    action_finish_clean: 'Terminer et nettoyer',
    action_clean: 'Nettoyer les Twins',
    action_retry_failed: 'Relancer les échecs',
    action_retry_all: 'Tout revérifier',

    // Status & Badges
    status_idle: 'Analyse initiale terminée',
    status_created: 'Twin créé · autorisation requise',
    status_verified: 'Candidat vérifié · prêt à examiner',
    status_failed: 'Vérification terminée · application bloquée',
    status_applied: 'Fichiers appliqués localement avec sauvegarde',

    workflow_hint_idle: 'Aucun fichier du dépôt modifié.',
    workflow_hint_created: 'Rien ne s’exécute avant votre confirmation.',
    workflow_hint_failed: 'Consultez les contrôles en échec avant une relance.',
    workflow_hint_verified: 'Le diff reste visible avant application.',
    workflow_hint_applied: 'Aucun commit ni push effectué.',

    // Diagnostic
    diag_findings_title: 'Points à examiner',
    diag_findings_desc: '{count} constat(s) documentaire(s), sans exécuter le code du projet.',
    diag_no_findings: 'Aucun constat documentaire.',
    diag_subprojects_title: 'Sous-projets et validations détectées',
    diag_subprojects_desc: '{count} périmètre(s) reconnus. Ces commandes ne sont pas encore exécutées.',
    diag_scores_title: 'Scores documentaires et rapport importé',
    diag_false_positives_title: 'Observations reclassées ({count})',
    diag_health_score: 'Score de Santé des Instructions IA',
    diag_findings_resolved: 'Anomalies à corriger',
    diag_subprojects_detected: 'Sous-projets détectés',
    diag_false_positives: 'Faux positifs éliminés',
    diag_raw_score: 'Score Brut Scanner',
    diag_true_issues: 'Anomalies Réelles',

    // ROI & Tokens
    roi_title: 'Bilan Tokens & Optimisation IA',
    roi_subtitle: 'Cochez vos forfaits actifs pour simuler vos économies et quotas réels :',
    roi_no_selection: 'Aucun forfait sélectionné',
    roi_tools_combined: '{count} forfaits combinés',
    roi_tokens_per_prompt: 'Tokens / prompt (Contexte)',
    roi_compact_context: 'Contexte compact partagé par tous vos outils',
    roi_monthly_savings: 'Gain cumulé (~{queries} req/m)',
    roi_yearly_badge: '{usd} $/an',
    roi_zero_tools_prompt: 'Cochez un ou plusieurs forfaits ci-dessus pour calculer votre ROI',
    roi_benefits: 'Bénéfices cumulés ({count})',
    roi_benefits_empty: 'Activez Cursor, Claude, Gemini, ChatGPT ou Copilot pour voir les quotas spécifiques préservés.',

    // Verification
    verify_title: 'Suivi de la vérification',
    verify_parallel_running: '{count} vérifications en parallèle',
    verify_subproject_concurrency: 'Concurrence sécurisée par sous-projet active',
    verify_copy_prompt: 'Copier le rapport de santé pour l’IA',
    verify_all_passed: 'Les {count} commandes ont réussi avec 0 régression.',
    verify_blocked_title: 'Application bloquée ({count} contrôle(s) en échec)',
    verify_blocked_desc: '{passed}/{total} commande(s) réussie(s). Utilisez les prompts préformatés sous chaque contrôle pour guider votre agent IA dans la réparation.',

    // Application & Certificate
    app_certified_title: 'Fichiers Appliqués & Snapshot Figé',
    app_certified_badge: 'Certificat d’Optimisation & Déploiement',
    app_certified_desc: 'La configuration optimale a été appliquée sur votre projet {repo}. Une sauvegarde locale et un certificat de preuve ont été générés.',
    app_open_html: 'Ouvrir le Certificat HTML',
    app_download_json: 'Audit JSON',
    app_before_after: 'Évolution Avant / Après',
    app_score_gain: '+{gain} pts (initialement {before}/100 · {grade})',
    app_zero_regression: '0 régression dans le projet',
    app_controls_passed: '100% verts en Twin Git isolé',
    app_backup_path: 'Sous .repotwin/backups/',
    app_view_diff: 'Voir le diff certifié appliqué',
    app_review_checks: 'Revoir les contrôles de vérification',

    // Comparison Tab
    comp_title: 'Comparer Deux Versions',
    comp_btn: 'Autoriser et comparer',

    // Lang toggle
    lang_toggle: 'EN'
  }
} as const;

export type TranslationKey = keyof typeof translations.en;

interface I18nContextType {
  lang: Language;
  setLang: (lang: Language) => void;
  toggleLang: () => void;
  t: (key: TranslationKey, vars?: Record<string, string | number>) => string;
}

export const I18nContext = createContext<I18nContextType>({
  lang: 'en',
  setLang: () => {},
  toggleLang: () => {},
  t: (key: TranslationKey) => key
});

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Language>(() => {
    try {
      const saved = localStorage.getItem('repotwin_lang');
      if (saved === 'fr' || saved === 'en') return saved;
    } catch {}
    return 'en'; // English is default for Open Source
  });

  const setLang = (next: Language) => {
    setLangState(next);
    try {
      localStorage.setItem('repotwin_lang', next);
    } catch {}
  };

  const toggleLang = () => {
    setLang(lang === 'en' ? 'fr' : 'en');
  };

  const t = (key: TranslationKey, vars?: Record<string, string | number>): string => {
    const dict = (translations[lang] as Record<string, string>) || (translations.en as Record<string, string>);
    let str: string = dict[key] || (translations.en as Record<string, string>)[key] || key;
    if (vars) {
      for (const [k, v] of Object.entries(vars)) {
        str = str.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v));
      }
    }
    return str;
  };

  return (
    <I18nContext.Provider value={{ lang, setLang, toggleLang, t }}>
      {children}
    </I18nContext.Provider>
  );
}

export function useI18n() {
  return useContext(I18nContext);
}
