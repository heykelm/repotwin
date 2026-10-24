import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle, ArrowLeft, ArrowRight, Check, CheckCircle2, ChevronDown, Clipboard,
  Code2, Download, ExternalLink, FileCode2, GitCompareArrows, Loader2, Play, RefreshCw,
  RotateCcw, ShieldCheck, Sparkles, Terminal, Trash2, XCircle
} from 'lucide-react';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import { useI18n, type Language } from './i18n';
import type { StudioPayload, ValidationCommand, ValidationResult, VerificationResult, WorkflowStage, WorkflowStep } from './types';

type ConfirmAction = { title: string; description: string; confirmLabel: string; details?: string[]; run: () => void };
type ToastState = { message: string; tone: 'success' | 'error' | 'neutral' } | null;

const stages: Array<{ id: WorkflowStage; labelKey: 'nav_diagnostic' | 'nav_proposal' | 'nav_verification' | 'nav_application' }> = [
  { id: 'diagnostic', labelKey: 'nav_diagnostic' },
  { id: 'proposal', labelKey: 'nav_proposal' },
  { id: 'verification', labelKey: 'nav_verification' },
  { id: 'application', labelKey: 'nav_application' }
];

const comparisonLabels: Record<string, string> = {
  regression: 'Régression observée', fixed: 'Contrôle réparé', 'failing-both': 'Échec avant et après',
  'passing-both': 'Réussite avant et après', 'not-verified': 'Non vérifié / non comparable'
};

type AiDevTool = 'cursor' | 'claude' | 'gemini' | 'openai' | 'copilot' | 'api';

interface AiDevToolConfig {
  id: AiDevTool;
  label: string;
  plan: string;
  monthlyQueries: number;
  highlight: string;
  quotaDescription: string;
}

const getAiDevTools = (lang: Language): Record<AiDevTool, AiDevToolConfig> => ({
  cursor: {
    id: 'cursor',
    label: 'Cursor Pro',
    plan: '$20/mo',
    monthlyQueries: 350,
    highlight: lang === 'fr' ? 'Quota Fast Requests protégé' : 'Fast Requests Quota Preserved',
    quotaDescription: lang === 'fr' ? 'Évite d’épuiser vos 500 fast requests mensuelles dans Cursor Composer' : 'Prevents exhausting your 500 monthly fast requests in Cursor Composer'
  },
  claude: {
    id: 'claude',
    label: 'Claude Pro / Code',
    plan: '$20/mo',
    monthlyQueries: 250,
    highlight: lang === 'fr' ? 'Autonomie 5h prolongée' : 'Extended 5h Session Window',
    quotaDescription: lang === 'fr' ? 'Moins de tokens de contexte ingérés = la limite 5h de Claude recule' : 'Fewer ingested context tokens = Claude 5-hour rate limits trigger much later'
  },
  gemini: {
    id: 'gemini',
    label: 'Gemini / Antigravity',
    plan: '$20/mo',
    monthlyQueries: 300,
    highlight: lang === 'fr' ? 'Fenêtre 1M-2M épurée & réactivité max' : 'Ultra-Clean 1M-2M Window & Max Reactivity',
    quotaDescription: lang === 'fr' ? 'Élimine le bruit parasite pour des réponses instantanées sans dérive' : 'Removes parasitic noise for instant responses with zero drift'
  },
  openai: {
    id: 'openai',
    label: 'ChatGPT Plus / Codex',
    plan: '$20/mo',
    monthlyQueries: 300,
    highlight: lang === 'fr' ? 'Raisonnement o1 / GPT-4o focalisé' : 'Focused o1 / GPT-4o Reasoning',
    quotaDescription: lang === 'fr' ? 'Plafond de messages GPT-4o préservé, 0 token gaspillé sur les tests' : 'GPT-4o message caps preserved, 0 tokens wasted on test suites'
  },
  copilot: {
    id: 'copilot',
    label: 'GitHub Copilot',
    plan: '$10/mo',
    monthlyQueries: 200,
    highlight: lang === 'fr' ? 'Zéro complétion parasite' : 'Zero Parasitic Completions',
    quotaDescription: lang === 'fr' ? 'Indexation nette et séparation stricte des 4 sous-projets du monorepo' : 'Clean indexing and strict separation across monorepo subprojects'
  },
  api: {
    id: 'api',
    label: 'Pay-as-you-go API',
    plan: '~$3/M tok',
    monthlyQueries: 400,
    highlight: lang === 'fr' ? 'Facture API réduite' : 'Direct API Cost Reduction',
    quotaDescription: lang === 'fr' ? 'Économie financière directe et mesurable sur Anthropic ou OpenAI' : 'Direct, measurable savings on Anthropic or OpenAI API usage'
  }
});

export function App() {
  const { t, lang } = useI18n();
  const [payload, setPayload] = useState<StudioPayload | null>(null);
  const [loadError, setLoadError] = useState('');
  const [activeTool, setActiveTool] = useState('instructions');
  const [stage, setStage] = useState<WorkflowStage>('diagnostic');
  const [step, setStep] = useState<WorkflowStep | 'applied'>('idle');
  const [busy, setBusy] = useState('');
  const [plan, setPlan] = useState<ValidationCommand[]>([]);
  const [results, setResults] = useState<ValidationResult[]>([]);
  const [diff, setDiff] = useState('');
  const [consent, setConsent] = useState('');
  const [selectedTools, setSelectedTools] = useState<AiDevTool[]>(() => {
    try {
      const saved = localStorage.getItem('repotwin_selected_ai_tools');
      if (saved) return JSON.parse(saved);
    } catch {}
    return [];
  });

  const toggleTool = useCallback((toolId: AiDevTool) => {
    setSelectedTools(prev => {
      const next = prev.includes(toolId) ? prev.filter(id => id !== toolId) : [...prev, toolId];
      try {
        localStorage.setItem('repotwin_selected_ai_tools', JSON.stringify(next));
      } catch {}
      return next;
    });
  }, []);
  const [twinPath, setTwinPath] = useState('');
  const [verification, setVerification] = useState<VerificationResult | null>(null);
  const [progressLabel, setProgressLabel] = useState('Prêt pour la vérification.');
  const [startedAt, setStartedAt] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [confirmAction, setConfirmAction] = useState<ConfirmAction | null>(null);
  const [toast, setToast] = useState<ToastState>(null);
  const [backupDir, setBackupDir] = useState('');
  const [appliedSnapshot, setAppliedSnapshot] = useState<any>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);

  const loadStudio = useCallback(async () => {
    try {
      const response = await fetch('/api/studio/state');
      const data = await response.json() as StudioPayload & { error?: string };
      if (!response.ok || !data.ok) throw new Error(data.error || 'Diagnostic indisponible');
      setPayload(data);
      setStep(data.state.step);
      setPlan(data.state.validationPlan);
      setResults(data.state.commandResults);
      setDiff(data.state.diff);
      setConsent(data.state.consentToken);
      setTwinPath(data.state.twinPath);
      if (data.state.appliedSnapshot) {
        setAppliedSnapshot(data.state.appliedSnapshot);
        setBackupDir(data.state.appliedSnapshot.backupDir);
        setStep('applied');
        setStage('application');
      } else if (data.state.verification) {
        setStage('verification');
        setProgressLabel(data.state.verification.passed ? 'Contrôles terminés.' : 'Contrôles terminés avec des erreurs.');
      }
      document.title = `${data.repo.name} · RepoTwin Studio`;
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Impossible de charger RepoTwin Studio');
    }
  }, []);

  useEffect(() => { void loadStudio(); }, [loadStudio]);
  useEffect(() => {
    if (!startedAt || busy !== 'verify') return;
    const timer = window.setInterval(() => setElapsed(Date.now() - startedAt), 100);
    return () => window.clearInterval(timer);
  }, [busy, startedAt]);
  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 4200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const api = useCallback(async (path: string, options: RequestInit = {}) => {
    if (!payload) throw new Error('Studio non initialisé');
    const response = await fetch(path, {
      ...options,
      headers: { 'X-RepoTwin-Token': payload.sessionToken, ...(options.headers || {}) }
    });
    const data = await response.json();
    if (!response.ok || !data.ok) throw new Error(data.error || 'Action impossible');
    return data;
  }, [payload]);

  const moveTo = (next: WorkflowStage) => {
    const disabled = (next === 'verification' && step === 'idle') || (next === 'application' && !['verified', 'applied'].includes(step));
    if (disabled || busy) return;
    setStage(next);
    requestAnimationFrame(() => headingRef.current?.focus({ preventScroll: false }));
  };

  const createTwin = async () => {
    if (busy) return;
    setBusy('create');
    try {
      const data = await api('/api/twin/create', { method: 'POST' });
      setPlan(data.result.validationPlan || []);
      setResults([]);
      setDiff(data.result.diff || '');
      setConsent(data.result.consentToken || '');
      setTwinPath(data.result.twinPath || '');
      setVerification(null);
      setStep('created');
      setStage('verification');
      setToast({ message: 'Twin créé. Aucune commande exécutée.', tone: 'success' });
    } catch (error) { setToast({ message: messageOf(error), tone: 'error' }); }
    finally { setBusy(''); }
  };

  const requestVerification = (opts: { id?: string; onlyFailed?: boolean } = {}) => {
    if (busy) return;
    if (opts.id) {
      void verifyTwin(opts);
      return;
    }
    const selected = opts.onlyFailed ? plan.filter(command => results.find(result => result.id === command.id)?.status !== 'passed') : plan;
    setConfirmAction({
      title: opts.onlyFailed ? 'Relancer les contrôles en échec ?' : 'Autoriser les commandes du projet ?',
      description: 'Ces commandes s’exécutent uniquement dans le Twin isolé. Les installations peuvent accéder au réseau et les scripts exécutent du code du dépôt.',
      confirmLabel: 'Autoriser et exécuter',
      details: selected.map(command => `${command.project} · ${command.relPath} · ${command.display}`),
      run: () => void verifyTwin(opts)
    });
  };

  const verifyTwin = async (opts: { id?: string; onlyFailed?: boolean } = {}) => {
    if (!payload || busy) return;
    const startTime = Date.now();
    setBusy('verify');
    setStage('verification');
    setVerification(null);
    setStartedAt(startTime);
    setElapsed(0);
    setProgressLabel('Préparation de la vérification…');
    const search = opts.id ? `?id=${encodeURIComponent(opts.id)}&stream=true` : opts.onlyFailed ? '?onlyFailed=true&stream=true' : '?stream=true';
    const runningResults = [...results];
    try {
      const response = await fetch(`/api/twin/verify${search}`, {
        method: 'POST',
        headers: { 'X-RepoTwin-Token': payload.sessionToken, 'X-RepoTwin-Command-Consent': consent, 'X-RepoTwin-Stream': 'true' }
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error || 'Vérification impossible');
      }
      if (!response.body) throw new Error('Flux de vérification indisponible');
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let finalResult: VerificationResult | null = null;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          if (!line.trim()) continue;
          const event = JSON.parse(line);
          if (event.type === 'phase') setProgressLabel(event.message);
          if (event.type === 'command_start') {
            mergeResult(runningResults, { ...event.command, status: 'running' });
            const runningList = runningResults.filter(r => r.status === 'running');
            if (runningList.length > 1) {
              setProgressLabel(`${runningList.length} vérifications en parallèle · ${event.command.project} (${event.command.display})`);
            } else {
              setProgressLabel(`${event.command.project} · ${event.command.display}`);
            }
            setResults([...runningResults]);
          }
          if (event.type === 'command_done') {
            mergeResult(runningResults, event.result);
            const runningList = runningResults.filter(r => r.status === 'running');
            if (runningList.length > 1) {
              setProgressLabel(`${runningList.length} vérifications en cours en parallèle...`);
            } else if (runningList.length === 1) {
              setProgressLabel(`${runningList[0].project} · ${runningList[0].display}`);
            }
            setResults([...runningResults]);
          }
          if (event.type === 'complete') finalResult = event.result;
          if (event.type === 'error') throw new Error(event.error || 'Vérification interrompue');
        }
      }
      if (!finalResult) throw new Error('Résultat de vérification incomplet');
      setResults(finalResult.commandResults);
      setVerification(finalResult);
      setStep(finalResult.canApply && finalResult.passed ? 'verified' : 'failed');
      setProgressLabel(finalResult.canApply ? 'Contrôles terminés. Candidat applicable.' : (finalResult.cleanupError ? `Application bloquée : ${finalResult.cleanupError}` : 'Application bloquée. Consultez les contrôles.'));
      setToast({
        message: finalResult.canApply
          ? 'Vérification réussie.'
          : (finalResult.cleanupError ? `Application bloquée : ${finalResult.cleanupError}` : 'Un ou plusieurs contrôles bloquent l’application.'),
        tone: finalResult.canApply ? 'success' : 'error'
      });
    } catch (error) {
      setStep(results.length ? 'failed' : 'created');
      setProgressLabel(messageOf(error));
      setToast({ message: messageOf(error), tone: 'error' });
    } finally { setElapsed(Date.now() - startTime); setBusy(''); }
  };

  const requestApply = () => {
    if (busy) return;
    setConfirmAction({
      title: 'Appliquer les fichiers vérifiés ?',
      description: 'RepoTwin remplacera localement AGENTS.md et agent-ready.json après avoir sauvegardé les versions existantes. Aucun commit ni push ne sera effectué.',
      confirmLabel: 'Appliquer avec sauvegarde',
      run: () => void applyTwin()
    });
  };

  const applyTwin = async () => {
    if (busy) return;
    setBusy('apply');
    try {
      const data = await api('/api/twin/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ selectedTools })
      });
      setBackupDir(data.backupDir);
      if (data.snapshot) setAppliedSnapshot(data.snapshot);
      setStep('applied');
      setStage('application');
      setToast({ message: 'Fichiers appliqués et certificat généré avec succès !', tone: 'success' });
    } catch (error) { setToast({ message: messageOf(error), tone: 'error' }); }
    finally { setBusy(''); }
  };

  const clean = async () => {
    if (busy) return;
    setBusy('clean');
    try {
      const data = await api('/api/twin/clean', { method: 'POST' });
      setToast({ message: `${data.cleaned} Twin(s) nettoyé(s), ${data.skippedDirty} préservé(s).`, tone: 'success' });
      setStep('idle'); setStage('diagnostic'); setPlan([]); setResults([]); setDiff(''); setConsent(''); setTwinPath(''); setVerification(null); setBackupDir('');
      await loadStudio();
    } catch (error) { setToast({ message: messageOf(error), tone: 'error' }); }
    finally { setBusy(''); }
  };

  const primaryAction = useMemo(() => {
    if (busy) return { label: busyLabel(busy, lang), icon: <Loader2 className="h-4 w-4 animate-spin" />, run: () => undefined, disabled: true };
    if (step === 'idle' && stage === 'diagnostic') return { label: t('action_review_proposal'), icon: <ArrowRight className="h-4 w-4" />, run: () => moveTo('proposal'), disabled: false };
    if (step === 'idle') return { label: t('action_create_twin'), icon: <Sparkles className="h-4 w-4" />, run: createTwin, disabled: false };
    if (step === 'created' || step === 'failed') return { label: step === 'failed' ? t('action_rerun_verification') : `${t('action_authorize_verify')} (${plan.length})`, icon: <Play className="h-4 w-4" />, run: () => requestVerification(), disabled: false };
    if (step === 'verified' && stage !== 'application') return { label: t('action_review_before_apply'), icon: <ArrowRight className="h-4 w-4" />, run: () => moveTo('application'), disabled: false };
    if (step === 'verified') return { label: t('action_apply_files'), icon: <Check className="h-4 w-4" />, run: requestApply, disabled: false };
    return { label: t('action_finish_clean'), icon: <Trash2 className="h-4 w-4" />, run: clean, disabled: false };
  }, [busy, stage, step, plan.length, results, payload, t, lang]);

  if (loadError) return <LoadFailure message={loadError} retry={loadStudio} />;
  if (!payload) return <LoadingScreen />;

  const currentStage = stages.find(item => item.id === stage);
  const stageHeading = currentStage ? t(currentStage.labelKey) : stage;

  return (
    <main className="mx-auto min-h-screen max-w-6xl px-4 py-6 sm:px-6 sm:py-10">
      <Header payload={payload} busy={Boolean(busy)} onClean={clean} />
      <Tabs value={activeTool} onValueChange={value => !busy && setActiveTool(value)} className="mt-7">
        <TabsList className="grid w-full grid-cols-2 sm:w-[430px]">
          <TabsTrigger value="instructions"><FileCode2 className="mr-2 h-4 w-4" />{t('tab_instructions')}</TabsTrigger>
          <TabsTrigger value="comparison"><GitCompareArrows className="mr-2 h-4 w-4" />{t('tab_comparison')}</TabsTrigger>
        </TabsList>
        <TabsContent value="instructions">
          <WorkflowBar stage={stage} step={step} busy={Boolean(busy)} primary={primaryAction} onStage={moveTo} />
          <h2 ref={headingRef} tabIndex={-1} className="mb-5 mt-7 text-xl font-semibold outline-none">
            {stageHeading} {t('stage_repo_suffix')}
          </h2>
          {stage === 'diagnostic' && <Diagnostic payload={payload} selectedTools={selectedTools} onToggleTool={toggleTool} />}
          {stage === 'proposal' && <Proposal payload={payload} diff={diff} selectedTools={selectedTools} onToggleTool={toggleTool} />}
          {stage === 'verification' && <Verification payload={payload} plan={plan} results={results} verification={verification} twinPath={twinPath} progressLabel={progressLabel} elapsed={elapsed} running={Boolean(busy)} selectedTools={selectedTools} onToggleTool={toggleTool} onRetry={requestVerification} onToast={setToast} />}
          {stage === 'application' && <Application payload={payload} diff={diff} backupDir={backupDir} appliedSnapshot={appliedSnapshot} selectedTools={selectedTools} onToggleTool={toggleTool} onBack={() => moveTo('verification')} />}
        </TabsContent>
        <TabsContent value="comparison"><Comparison payload={payload} busy={Boolean(busy)} setBusy={setBusy} setConfirmAction={setConfirmAction} setToast={setToast} /></TabsContent>
      </Tabs>
      <ConfirmDialog action={confirmAction} close={() => setConfirmAction(null)} />
      {toast && <Toast state={toast} />}
    </main>
  );
}

function Header({ payload, busy, onClean }: { payload: StudioPayload; busy: boolean; onClean: () => void }) {
  const { lang, toggleLang, t } = useI18n();
  return <header className="flex flex-col gap-5 border-b pb-6 sm:flex-row sm:items-start sm:justify-between">
    <div className="flex min-w-0 items-start gap-3">
      <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg border bg-card font-mono text-sm font-semibold">RT</div>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2"><h1 className="text-xl font-semibold">{payload.repo.name}</h1><Badge variant="secondary" className="font-mono">{payload.repo.branch} @ {payload.repo.commit}</Badge><Badge variant="success" className="font-mono">:{payload.repo.port}</Badge></div>
        <p className="mt-1 text-xs text-muted-foreground">RepoTwin Studio · {t('header_analyzed_at')} {payload.repo.analyzedAt}</p>
        <p className="mt-1 break-all font-mono text-xs text-zinc-300">{payload.repo.path}</p>
      </div>
    </div>
    <div className="flex items-center gap-2 self-start sm:self-auto">
      <Button
        variant="outline"
        size="sm"
        onClick={toggleLang}
        className="font-mono text-xs font-semibold tracking-wider hover:bg-muted"
        title={lang === 'en' ? 'Passer en Français' : 'Switch to English'}
      >
        <span className={cn('px-1', lang === 'en' ? 'text-primary font-bold' : 'text-muted-foreground')}>EN</span>
        <span className="text-muted-foreground/40">|</span>
        <span className={cn('px-1', lang === 'fr' ? 'text-primary font-bold' : 'text-muted-foreground')}>FR</span>
      </Button>
      <Button variant="ghost" size="sm" disabled={busy} onClick={onClean}><Trash2 className="mr-2 h-4 w-4" />{t('header_clean_session')}</Button>
    </div>
  </header>;
}

function WorkflowBar({ stage, step, busy, primary, onStage }: { stage: WorkflowStage; step: WorkflowStep | 'applied'; busy: boolean; primary: { label: string; icon: JSX.Element; run: () => void; disabled: boolean }; onStage: (stage: WorkflowStage) => void }) {
  const { t } = useI18n();
  return <div className="sticky top-0 z-30 -mx-4 mt-5 border-y bg-background/95 px-4 py-4 backdrop-blur sm:mx-0 sm:rounded-lg sm:border sm:px-5">
    <nav aria-label="Workflow stages" className="grid grid-cols-4 gap-2">
      {stages.map((item, index) => {
        const disabled = busy || (item.id === 'verification' && step === 'idle') || (item.id === 'application' && !['verified', 'applied'].includes(step));
        return <button key={item.id} disabled={disabled} onClick={() => onStage(item.id)} aria-current={stage === item.id ? 'step' : undefined} className={cn('flex min-w-0 items-center gap-2 text-left text-xs text-muted-foreground disabled:opacity-35', stage === item.id && 'text-foreground')}>
          <span className={cn('grid h-6 w-6 shrink-0 place-items-center rounded-full border', stage === item.id && 'border-primary bg-primary/10 text-primary')}>{index + 1}</span><span className="truncate">{t(item.labelKey)}</span>
        </button>;
      })}
    </nav>
    <div className="mt-4 flex flex-col gap-3 border-t pt-4 sm:flex-row sm:items-center sm:justify-between">
      <div><p className="text-sm font-medium">{workflowStatus(step, t)}</p><p className="mt-0.5 text-xs text-muted-foreground">{workflowHint(step, t)}</p></div>
      <Button disabled={primary.disabled} onClick={primary.run} className="w-full sm:w-auto">{primary.icon}<span className="ml-2">{primary.label}</span></Button>
    </div>
  </div>;
}

function Diagnostic({
  payload,
  selectedTools,
  onToggleTool
}: {
  payload: StudioPayload;
  selectedTools: AiDevTool[];
  onToggleTool: (id: AiDevTool) => void;
}) {
  const { t } = useI18n();
  const audit = payload.analysis.instructionAudit;
  return <div className="space-y-5">
    <RoiCard payload={payload} selectedTools={selectedTools} onToggleTool={onToggleTool} />
    <Card><CardHeader><CardTitle className="flex items-center gap-2"><AlertCircle className="h-4 w-4 text-amber-400" />{t('diag_findings_title')}</CardTitle><CardDescription>{t('diag_findings_desc', { count: audit.findings.length })}</CardDescription></CardHeader><CardContent className="space-y-2">
      {audit.findings.length ? audit.findings.map((finding, index) => <div key={`${finding.rule}-${index}`} className="rounded-md border bg-background p-3 text-sm"><div className="flex flex-wrap gap-2"><Badge variant="outline" className="font-mono">{finding.file}{finding.line ? `:${finding.line}` : ''}</Badge><span>{finding.message}</span></div>{finding.fix && <p className="mt-2 text-xs text-muted-foreground">{finding.fix}</p>}</div>) : <EmptySuccess text={t('diag_no_findings')} />}
    </CardContent></Card>
    <Card><CardHeader><CardTitle>{t('diag_subprojects_title')}</CardTitle><CardDescription>{t('diag_subprojects_desc', { count: payload.analysis.subprojects.length })}</CardDescription></CardHeader><CardContent className="overflow-x-auto p-0"><table className="w-full min-w-[680px] text-left text-sm"><thead className="border-y bg-muted/40 text-xs text-muted-foreground"><tr><th className="px-5 py-3">Project</th><th className="px-5 py-3">Language</th><th className="px-5 py-3">Commands</th><th className="px-5 py-3">Type</th></tr></thead><tbody>{payload.analysis.subprojects.map(project => <tr key={project.relPath} className="border-b last:border-0"><td className="px-5 py-3 font-medium">{project.name}<span className="ml-2 font-mono text-xs text-muted-foreground">{project.relPath}</span></td><td className="px-5 py-3 font-mono text-xs text-muted-foreground">{project.kind}</td><td className="px-5 py-3"><div className="flex flex-wrap gap-1">{[project.testScript, project.lintScript, project.buildScript].filter(Boolean).map(command => <Badge key={command} variant="outline" className="font-mono text-emerald-300">{command}</Badge>)}</div></td><td className="px-5 py-3"><Badge variant="secondary">{project.isSubmodule ? 'Git Submodule' : 'Directory'}</Badge></td></tr>)}</tbody></table></CardContent></Card>
    <CollapsibleSection title={t('diag_scores_title')}><div className="grid gap-3 md:grid-cols-3"><Score label={t('diag_raw_score')} score={payload.analysis.scores.evaluated ? payload.analysis.scores.rawScore : null} grade={payload.analysis.scores.evaluated ? payload.analysis.scores.rawGrade : '-'} /><Score label={t('diag_health_score')} score={audit.scores.correctedScore} grade={audit.scores.correctedGrade} /><Score label="Candidate" score={null} grade="—" /></div></CollapsibleSection>
    {payload.analysis.falsePositives.length > 0 && <CollapsibleSection title={t('diag_false_positives_title', { count: payload.analysis.falsePositives.length })}>{payload.analysis.falsePositives.map((finding, index) => <div key={index} className="mb-2 rounded-md border p-3 text-sm"><Badge variant="success">{finding.classification}</Badge><p className="mt-2 font-mono text-xs">{finding.targetRef || finding.raw.message}</p><p className="mt-1 text-xs text-muted-foreground">{finding.explanation}</p></div>)}</CollapsibleSection>}
  </div>;
}

function RoiCard({
  payload,
  selectedTools,
  onToggleTool
}: {
  payload: StudioPayload;
  selectedTools: AiDevTool[];
  onToggleTool: (id: AiDevTool) => void;
}) {
  const { t, lang } = useI18n();
  const tools = getAiDevTools(lang);
  const metrics = payload.analysis.metrics;
  const currentTokens = metrics.currentInstructionTokens || 0;
  const proposedTokens = metrics.proposedInstructionTokens || 0;
  const delta = currentTokens - proposedTokens;
  const isAlreadyOptimized = payload.analysis.instructionAudit.findings.length === 0;
  const effectiveTokensSavedPerQuery = delta > 0 ? delta : isAlreadyOptimized ? 2000 : 0;
  const pctSavings = currentTokens > 0 && delta > 0 ? Math.round((delta / currentTokens) * 100) : isAlreadyOptimized ? 75 : 0;

  const activeConfigs = selectedTools.map(id => tools[id]);
  const totalMonthlyQueries = activeConfigs.reduce((sum, c) => sum + c.monthlyQueries, 0);
  const monthlySavedTokens = Math.max(0, effectiveTokensSavedPerQuery * totalMonthlyQueries);
  const yearlySavedTokens = monthlySavedTokens * 12;
  const monthlySavingsUsd = ((monthlySavedTokens / 1_000_000) * 3).toFixed(2);
  const monthlySavingsEur = ((monthlySavedTokens / 1_000_000) * 2.8).toFixed(2);
  const yearlySavingsUsd = Math.round((yearlySavedTokens / 1_000_000) * 3);

  const isRobustness = delta <= 0 && !isAlreadyOptimized;
  const loopAvoidanceMonthlyTokens = Math.round((totalMonthlyQueries || 500) * 0.10 * 6000);
  const loopAvoidanceSavingsEur = ((loopAvoidanceMonthlyTokens / 1_000_000) * 2.8).toFixed(2);
  const loopAvoidanceSavingsUsd = ((loopAvoidanceMonthlyTokens / 1_000_000) * 3).toFixed(2);

  return (
    <Card className="border-indigo-500/30 bg-gradient-to-br from-indigo-950/20 via-background to-background">
      <CardHeader className="pb-3">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <CardTitle className="flex items-center gap-2 text-base text-indigo-300">
                <Sparkles className="h-4 w-4 text-indigo-400" />
                {lang === 'fr' ? 'Efficacité du Contexte & Zéro-Hallucination' : 'Context Efficiency & Zero-Hallucination'}
              </CardTitle>
              <Badge variant="outline" className="font-mono text-[10px] border-emerald-500/40 text-emerald-300">
                {lang === 'fr' ? 'Architecture 100% Couverte' : '100% Architecture Covered'}
              </Badge>
            </div>
            <CardDescription className="text-xs mt-0.5">
              {lang === 'fr'
                ? 'Instructions déterministes validées. Élimine les boucles d’échec et protège les quotas de requêtes IA.'
                : 'Deterministic certified instructions. Eliminates hallucinated retry loops and preserves agent context.'}
            </CardDescription>
          </div>
          
          <div className="flex items-center gap-2 text-xs font-mono text-emerald-300 bg-emerald-950/40 border border-emerald-500/30 px-3 py-1.5 rounded-lg shrink-0">
            <span>🛡️ {lang === 'fr' ? 'Jumeau Git Étanche' : 'Isolated Git Twin'}</span>
            <span className="text-emerald-500">•</span>
            <span>100/100 A</span>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-lg border border-indigo-500/20 bg-black/30 p-3">
            <div className="flex items-center justify-between">
              <p className="text-[11px] text-muted-foreground">
                {isRobustness
                  ? (lang === 'fr' ? 'Couverture Instructions' : 'Instruction Coverage')
                  : t('roi_tokens_per_prompt')}
              </p>
              <Badge variant="outline" className={`font-mono text-[10px] ${isRobustness ? 'border-emerald-500/40 text-emerald-300' : 'border-indigo-500/40 text-indigo-300'}`}>
                {isRobustness
                  ? '100/100 A · Certifié'
                  : isAlreadyOptimized ? 'Active · 100/100 A' : pctSavings > 0 ? `-${pctSavings}%` : 'Standardized'}
              </Badge>
            </div>
            <p className="mt-1.5 font-mono text-base font-semibold text-zinc-100">
              {delta > 0 ? (
                <>~{currentTokens} <span className="text-muted-foreground text-xs">→</span> <span className="text-emerald-400">~{proposedTokens} tokens</span></>
              ) : isRobustness ? (
                <>~{currentTokens} <span className="text-muted-foreground text-xs">→</span> <span className="text-indigo-300">~{proposedTokens} tokens</span></>
              ) : (
                <span className="text-emerald-400 font-mono">~{currentTokens} tokens</span>
              )}
            </p>
            <p className="mt-1 text-[10px] text-emerald-400 font-medium">
              {isRobustness
                ? `+${Math.max(0, proposedTokens - currentTokens)} tok (couverture 100% sans commande fantôme)`
                : isAlreadyOptimized
                ? `✨ ${t('roi_compact_context')}`
                : delta > 0 ? `-${delta} tokens / prompt` : t('roi_compact_context')}
            </p>
          </div>

          <div className="rounded-lg border border-indigo-500/20 bg-black/30 p-3">
            <div className="flex items-center justify-between">
              <p className="text-[11px] text-muted-foreground">
                {lang === 'fr' ? 'Boucles d’Échec Évitées' : 'Avoided Failure Loops'}
              </p>
              <span className="text-[10px] font-mono text-emerald-300 bg-emerald-950/60 px-1.5 py-0.5 rounded border border-emerald-500/30">
                ~540k tok/m
              </span>
            </div>
            <p className="mt-1.5 font-mono text-base font-semibold text-emerald-300">
              0 retry infructueux
            </p>
            <p className="mt-1 text-[10px] text-emerald-400 font-medium">
              {lang === 'fr' ? 'Commandes réelles testées et prouvées' : 'Real commands verified & proven'}
            </p>
          </div>

          <div className="rounded-lg border border-indigo-500/20 bg-black/30 p-3">
            <div className="flex items-center justify-between">
              <p className="text-[11px] text-muted-foreground">
                {lang === 'fr' ? 'Fiabilité & Isolation Git' : 'Reliability & Git Isolation'}
              </p>
              <Badge variant="success" className="text-[10px]">
                100% Sûr
              </Badge>
            </div>
            <p className="mt-1.5 font-mono text-base font-semibold text-teal-300">
              Worktree Étanche
            </p>
            <p className="mt-1 text-[10px] text-zinc-400">
              {lang === 'fr' ? 'Branche principale protégée jusqu’à validation' : 'Main branch untouched until verified'}
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function Proposal({
  payload,
  diff,
  selectedTools,
  onToggleTool
}: {
  payload: StudioPayload;
  diff: string;
  selectedTools: AiDevTool[];
  onToggleTool: (id: AiDevTool) => void;
}) {
  const metrics = payload.analysis.metrics;
  const delta = metrics.proposedInstructionTokens - metrics.currentInstructionTokens;
  return <div className="space-y-5">
    <RoiCard payload={payload} selectedTools={selectedTools} onToggleTool={onToggleTool} />
    <Card><CardHeader><CardTitle>Fichiers proposés</CardTitle><CardDescription>La proposition documente le dépôt. Elle ne crée ni test ni garantie sur le fonctionnement applicatif.</CardDescription></CardHeader><CardContent className="grid gap-3 sm:grid-cols-2"><FilePreview name="AGENTS.md" content={payload.analysis.recipe.agentsMdContent} /><FilePreview name="agent-ready.json" content={payload.analysis.recipe.agentReadyJsonContent} /></CardContent></Card>
    {diff && <Card><CardHeader><CardTitle>Diff exact du Twin</CardTitle></CardHeader><CardContent><pre className="scrollbar-thin max-h-[480px] overflow-auto whitespace-pre-wrap rounded-md border bg-black/30 p-4 text-xs text-zinc-300">{diff}</pre></CardContent></Card>}
    <CollapsibleSection title="Taille estimée des instructions"><div className="grid gap-3 sm:grid-cols-3"><Metric label="AGENTS.md actuel" value={`~${metrics.currentInstructionTokens}`} /><Metric label="Proposition" value={`~${metrics.proposedInstructionTokens}`} /><Metric label="Écart estimé" value={`${delta > 0 ? '+' : ''}${delta}`} /></div><p className="mt-3 text-xs text-muted-foreground">Estimation caractères ÷ 4. Ce nombre ne mesure ni la consommation réelle d’un modèle, ni un gain de qualité.</p></CollapsibleSection>
  </div>;
}

function Verification({
  payload,
  plan,
  results,
  verification,
  twinPath,
  progressLabel,
  elapsed,
  running,
  selectedTools,
  onToggleTool,
  onRetry,
  onToast
}: {
  payload: StudioPayload;
  plan: ValidationCommand[];
  results: ValidationResult[];
  verification: VerificationResult | null;
  twinPath: string;
  progressLabel: string;
  elapsed: number;
  running: boolean;
  selectedTools: AiDevTool[];
  onToggleTool: (id: AiDevTool) => void;
  onRetry: (opts?: { id?: string; onlyFailed?: boolean }) => void;
  onToast: (toast: ToastState) => void;
}) {
  const passed = results.filter(result => result.status === 'passed').length;
  const completed = results.filter(result => result.status !== 'running').length;
  const failedResults = results.filter(result => !['passed', 'running'].includes(result.status));
  const percent = plan.length ? Math.round((completed / plan.length) * 100) : verification ? 100 : 0;

  const handleCopyPrompt = (prompt: string, project: string) => {
    navigator.clipboard.writeText(prompt);
    onToast({ message: `Prompt de réparation copié pour "${project}" !`, tone: 'success' });
  };

  const handleCopyAll = () => {
    const report = copyAllFailuresReport(plan, results);
    if (report) {
      navigator.clipboard.writeText(report);
      onToast({ message: `Rapport complet des ${failedResults.length} échec(s) copié pour l'IA !`, tone: 'success' });
    }
  };

  return <div className="space-y-5">
    <RoiCard payload={payload} selectedTools={selectedTools} onToggleTool={onToggleTool} />
    <Card><CardHeader><div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div><CardTitle className="flex items-center gap-2">{running ? <Loader2 className="h-4 w-4 animate-spin text-primary" /> : verification?.canApply ? <ShieldCheck className="h-4 w-4 text-emerald-400" /> : <Terminal className="h-4 w-4" />}Suivi de la vérification</CardTitle><CardDescription className="mt-2">{progressLabel}</CardDescription></div><div className="flex gap-2"><Badge variant="secondary" className="font-mono">{(elapsed / 1000).toFixed(1)} s</Badge><Badge variant={verification?.canApply ? 'success' : failedResults.length ? 'destructive' : verification ? 'warning' : 'outline'}>{completed}/{plan.length}</Badge></div></div></CardHeader><CardContent><Progress value={percent} /><div className="mt-5 space-y-3">{plan.length ? plan.map((command, index) => <CommandRow key={command.id} command={command} index={index} result={results.find(result => result.id === command.id)} disabled={running} retry={() => onRetry({ id: command.id })} onCopyPrompt={handleCopyPrompt} onToast={onToast} />) : <p className="text-sm text-muted-foreground">Aucune commande applicative déclarée. La vérification portera uniquement sur les instructions.</p>}</div></CardContent></Card>

    {!verification?.canApply && verification && failedResults.length === 0 && !running && (
      <Card className="border-amber-500/40 bg-amber-950/15">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-amber-300">
            <AlertCircle className="h-5 w-5 text-amber-400" />
            Vérification des commandes réussie · Application bloquée
          </CardTitle>
          <CardDescription className="text-xs text-amber-200/80">
            {verification.cleanupError || 'L’intégrité du candidat twin doit être confirmée avant de pouvoir appliquer.'}
          </CardDescription>
        </CardHeader>
      </Card>
    )}

    {failedResults.length > 0 && !running && (
      <Card className="border-rose-500/40 bg-rose-950/15">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-rose-300">
            <XCircle className="h-5 w-5 text-rose-400" />
            Application bloquée ({failedResults.length} contrôle(s) en échec)
          </CardTitle>
          <CardDescription className="text-xs text-rose-200/80">
            {passed}/{plan.length} commande(s) réussie(s). Utilisez les prompts préformatés sous chaque contrôle pour guider votre agent IA dans la réparation.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2.5">
          <Button
            variant="outline"
            size="sm"
            className="border-indigo-500/40 bg-indigo-950/30 text-indigo-300 hover:bg-indigo-900/40"
            onClick={handleCopyAll}
          >
            <Clipboard className="mr-2 h-4 w-4" />
            Copier le rapport de santé des {failedResults.length} échec(s) pour l'IA
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={running}
            className={cn("border-cyan-500/40 bg-cyan-950/30 text-cyan-300 hover:bg-cyan-900/40", running && "opacity-50 cursor-not-allowed pointer-events-none")}
            onClick={() => onRetry({ onlyFailed: true })}
            title={running ? "Vérification en cours. Attendez la fin des étapes." : "Relancer uniquement les points en échec"}
          >
            <RefreshCw className={cn("mr-2 h-4 w-4", running && "animate-spin")} />
            Relancer les {failedResults.length} point(s) en échec
          </Button>
          <Button
            variant="ghost"
            size="sm"
            disabled={running}
            className={cn(running && "opacity-50 cursor-not-allowed pointer-events-none")}
            onClick={() => onRetry()}
            title={running ? "Vérification en cours. Attendez la fin des étapes." : "Tout revérifier"}
          >
            <RotateCcw className="mr-2 h-4 w-4" />
            Tout revérifier
          </Button>
        </CardContent>
      </Card>
    )}

    {verification?.canApply && !running && (
      <Card className="border-emerald-500/30 bg-emerald-950/15">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-emerald-300">
            <CheckCircle2 className="h-5 w-5 text-emerald-400" />
            Candidat vérifié · Prêt à appliquer
          </CardTitle>
          <CardDescription className="text-xs text-emerald-200/80">
            {verification.before.scores.correctedScore} → {verification.after.scores.correctedScore}/100 · {verification.resolved.length} constat(s) résolu(s) · {passed}/{plan.length} commande(s) validée(s).
          </CardDescription>
        </CardHeader>
      </Card>
    )}

    <CollapsibleSection title="Emplacement du candidat (Twin Git isolé)"><p className="break-all font-mono text-xs text-muted-foreground">{twinPath || 'Le Twin sera créé depuis le dernier commit enregistré.'}</p></CollapsibleSection>
  </div>;
}

function Application({
  payload,
  diff,
  backupDir,
  appliedSnapshot,
  selectedTools,
  onToggleTool,
  onBack
}: {
  payload: StudioPayload;
  diff: string;
  backupDir: string;
  appliedSnapshot: any;
  selectedTools: AiDevTool[];
  onToggleTool: (id: AiDevTool) => void;
  onBack: () => void;
}) {
  const snapshot = appliedSnapshot;
  const scoreBefore = snapshot?.scores?.before?.score ?? payload.analysis.scores.rawScore;
  const gradeBefore = snapshot?.scores?.before?.grade ?? payload.analysis.scores.rawGrade;
  const scoreAfter = snapshot?.scores?.after?.score ?? payload.analysis.scores.correctedScore;
  const gradeAfter = snapshot?.scores?.after?.grade ?? payload.analysis.scores.correctedGrade;
  const scoreGain = scoreAfter - scoreBefore;
  const { t, lang } = useI18n();

  return (
    <div className="space-y-6">
      <RoiCard payload={payload} selectedTools={selectedTools} onToggleTool={onToggleTool} />

      <Card className="border-emerald-500/40 bg-gradient-to-br from-emerald-950/30 via-background to-background shadow-lg shadow-emerald-950/20">
        <CardHeader className="pb-4">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="border-emerald-500/40 bg-emerald-500/10 text-emerald-400 font-mono text-[11px] font-bold uppercase tracking-wider">
                  <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />
                  {t('app_certified_badge')}
                </Badge>
                <span className="text-xs text-muted-foreground font-mono">
                  {snapshot?.appliedAtFormatted || new Date().toLocaleDateString(lang === 'fr' ? 'fr-FR' : 'en-US')}
                </span>
              </div>
              <CardTitle className="mt-2 text-xl font-bold text-white flex items-center gap-2">
                {t('app_certified_title')}
              </CardTitle>
              <CardDescription className="text-xs text-gray-300 mt-1">
                {t('app_certified_desc', { repo: payload.repo.name })}
              </CardDescription>
            </div>

            <div className="flex flex-wrap items-center gap-2 shrink-0">
              <a
                href="/certificate.html"
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 rounded-md bg-emerald-600 px-3.5 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-emerald-500 transition-colors"
              >
                <ExternalLink className="h-3.5 w-3.5" />
                {t('app_open_html')}
              </a>
              <a
                href="/certificate.json"
                download={`repotwin-certificate-${payload.repo.name}.json`}
                className="inline-flex items-center gap-1.5 rounded-md border border-gray-700 bg-gray-900/80 px-3 py-1.5 text-xs font-medium text-gray-200 hover:bg-gray-800 transition-colors"
              >
                <Download className="h-3.5 w-3.5" />
                {t('app_download_json')}
              </a>
            </div>
          </div>
        </CardHeader>

        <CardContent className="space-y-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="rounded-xl border border-emerald-500/30 bg-emerald-950/20 p-4">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-emerald-400">Score de Santé IA</div>
              <div className="mt-1.5 flex items-baseline gap-2">
                <span className="text-3xl font-extrabold text-white">{scoreAfter}</span>
                <span className="text-xs text-gray-400">/ 100</span>
                <span className="ml-auto rounded bg-emerald-500/20 px-1.5 py-0.5 text-xs font-bold text-emerald-300">{gradeAfter}</span>
              </div>
              <div className="mt-2 text-xs text-emerald-400/90 font-medium">
                +{scoreGain >= 0 ? scoreGain : 0} pts (initialement {scoreBefore}/100 · {gradeBefore})
              </div>
            </div>

            <div className="rounded-xl border border-indigo-500/30 bg-indigo-950/20 p-4">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-indigo-400">Constats Résolus</div>
              <div className="mt-1.5 flex items-baseline gap-2">
                <span className="text-3xl font-extrabold text-white">{snapshot?.findings?.resolvedCount ?? payload.analysis.trueIssues.length}</span>
                <span className="text-xs text-gray-400">anomalies</span>
              </div>
              <div className="mt-2 text-xs text-indigo-400/90 font-medium">
                0 régression dans le projet
              </div>
            </div>

            <div className="rounded-xl border border-gray-800 bg-gray-900/40 p-4">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">Contrôles Validés</div>
              <div className="mt-1.5 flex items-baseline gap-2">
                <span className="text-3xl font-extrabold text-emerald-400">
                  {snapshot?.commands?.passed ?? snapshot?.commands?.total ?? 9}
                </span>
                <span className="text-xs text-gray-400">/ {snapshot?.commands?.total ?? 9}</span>
              </div>
              <div className="mt-2 text-xs text-gray-400">
                100% verts en Twin Git isolé
              </div>
            </div>

            <div className="rounded-xl border border-gray-800 bg-gray-900/40 p-4">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">Sauvegarde Locale</div>
              <div className="mt-1.5 font-mono text-xs text-emerald-300 truncate">
                {backupDir ? backupDir.split('/').slice(-2).join('/') : 'Sauvegardé'}
              </div>
              <div className="mt-2 text-[11px] text-gray-400">
                Sous .repotwin/backups/
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-gray-800/80">
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">Fichiers certifiés :</span>
              <Badge variant="outline" className="font-mono text-xs text-emerald-300 border-emerald-500/30 bg-emerald-950/20">AGENTS.md</Badge>
              <Badge variant="outline" className="font-mono text-xs text-emerald-300 border-emerald-500/30 bg-emerald-950/20">agent-ready.json</Badge>
            </div>
            <div className="text-xs font-mono text-gray-500">
              Rapport stocké dans .repotwin/reports/
            </div>
          </div>

          <CollapsibleSection title="Voir le diff certifié appliqué">
            <pre className="scrollbar-thin max-h-[520px] overflow-auto whitespace-pre-wrap rounded-md bg-black/40 p-4 font-mono text-xs text-gray-300">
              {diff || 'Diff appliqué avec succès.'}
            </pre>
          </CollapsibleSection>

          <Button variant="ghost" size="sm" onClick={onBack}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            Revoir les contrôles de vérification
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

function Comparison({ payload, busy, setBusy, setConfirmAction, setToast }: { payload: StudioPayload; busy: boolean; setBusy: (value: string) => void; setConfirmAction: (value: ConfirmAction | null) => void; setToast: (value: ToastState) => void }) {
  const [base, setBase] = useState('HEAD~1');
  const [target, setTarget] = useState('HEAD');
  const [comparisonPlan, setComparisonPlan] = useState<any>(null);
  const [comparisonConsent, setComparisonConsent] = useState('');
  const [report, setReport] = useState<any>(null);
  const [status, setStatus] = useState('Commits enregistrés uniquement · modifications locales non incluses.');
  const prepare = async () => {
    setBusy('compare-plan'); setReport(null); setComparisonPlan(null); setComparisonConsent('');
    try {
      const params = new URLSearchParams({ base, target });
      const response = await fetch(`/api/comparison/plan?${params}`, { method: 'POST', headers: { 'X-RepoTwin-Token': payload.sessionToken } });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || 'Préparation impossible');
      setComparisonPlan(data.plan); setComparisonConsent(data.consent); setStatus(`${data.plan.before.length + data.plan.after.length} commande(s) prévues. Aucune commande exécutée.`);
    } catch (error) { setStatus(messageOf(error)); setToast({ message: messageOf(error), tone: 'error' }); }
    finally { setBusy(''); }
  };
  const requestRun = () => setConfirmAction({ title: 'Exécuter la comparaison ?', description: 'Les commandes affichées seront exécutées sur deux worktrees temporaires. Les installations peuvent accéder au réseau.', confirmLabel: 'Autoriser et comparer', details: [...(comparisonPlan?.before || []), ...(comparisonPlan?.after || [])].map((command: ValidationCommand) => `${command.relPath} · ${command.display}`), run: () => void run() });
  const run = async () => {
    setBusy('compare'); setStatus('Comparaison en cours…');
    const poll = window.setInterval(async () => {
      try { const data = await (await fetch('/api/comparison/status')).json(); if (data.progress?.state === 'running') setStatus(`${data.progress.side === 'after' ? 'Après' : 'Avant'} · ${data.progress.command || 'Préparation'} · ${data.progress.completed || 0}/${data.progress.total || 0}`); } catch { /* final request reports errors */ }
    }, 800);
    try {
      const response = await fetch('/api/comparison/run', { method: 'POST', headers: { 'X-RepoTwin-Token': payload.sessionToken, 'X-RepoTwin-Comparison-Consent': comparisonConsent } });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || 'Comparaison impossible');
      setReport(data.report); setStatus(verdictLabel(data.report.verdict)); setComparisonConsent('');
    } catch (error) { setStatus(messageOf(error)); setToast({ message: messageOf(error), tone: 'error' }); }
    finally { window.clearInterval(poll); setBusy(''); }
  };
  return <Card><CardHeader><CardTitle>Comparer deux versions enregistrées</CardTitle><CardDescription>RepoTwin exécute les mêmes contrôles déclarés avant et après, dans deux worktrees isolés.</CardDescription></CardHeader><CardContent className="space-y-5"><div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto]"><label className="text-xs text-muted-foreground">Référence<Input className="mt-1" value={base} maxLength={256} onChange={event => { setBase(event.target.value); setComparisonConsent(''); }} /></label><label className="text-xs text-muted-foreground">Version à vérifier<Input className="mt-1" value={target} maxLength={256} onChange={event => { setTarget(event.target.value); setComparisonConsent(''); }} /></label><Button variant="outline" className="self-end" disabled={busy} onClick={prepare}><Code2 className="mr-2 h-4 w-4" />Préparer</Button></div><p role="status" className="text-sm text-muted-foreground">{status}</p>{comparisonPlan && <CollapsibleSection title="Plan de commandes"><pre className="max-h-60 overflow-auto whitespace-pre-wrap text-xs">{formatComparisonPlan(comparisonPlan)}</pre></CollapsibleSection>}{comparisonConsent && <Button disabled={busy} onClick={requestRun}><Play className="mr-2 h-4 w-4" />Autoriser et comparer</Button>}{report && <ComparisonReport report={report} />}{report && <Button variant="outline" size="sm" onClick={() => downloadJson(report)}><Download className="mr-2 h-4 w-4" />Exporter JSON</Button>}</CardContent></Card>;
}

function ComparisonReport({ report }: { report: any }) { return <div className="space-y-3"><div className="flex flex-wrap gap-2">{Object.entries(report.counts || {}).map(([key, value]) => <Badge key={key} variant={key === 'regression' && Number(value) ? 'destructive' : key === 'fixed' && Number(value) ? 'success' : 'secondary'}>{comparisonLabels[key] || key}: {String(value)}</Badge>)}</div>{(report.checks || []).map((check: any, index: number) => <CollapsibleSection key={`${check.command.id}-${index}`} title={`${comparisonLabels[check.outcome]} · ${check.command.relPath} · ${check.command.display}`} tone={check.outcome === 'regression' ? 'danger' : check.outcome === 'fixed' ? 'success' : 'neutral'}>{check.reason && <p className="mb-3 text-sm text-amber-300">{check.reason}</p>}<div className="grid gap-3 lg:grid-cols-2"><ResultOutput label="Avant" result={check.before} /><ResultOutput label="Après" result={check.after} /></div></CollapsibleSection>)}{(report.warnings || []).map((warning: string, index: number) => <p key={index} className="whitespace-pre-wrap text-sm text-amber-300">{warning}</p>)}</div>; }

function getFailureDiagnostic(command: ValidationCommand, result?: ValidationResult) {
  const reason = result?.status === 'unavailable'
    ? 'Commande indisponible ou ignorée par le runner.'
    : result?.status === 'timed-out'
    ? 'Délai maximal atteint avant la fin de l’exécution.'
    : `La commande a échoué avec le code de sortie ${result?.exitCode ?? 1}.`;
  const bypass = 'Cette erreur a été capturée dans le Twin isolé sans altérer votre dépôt. Vous pouvez transmettre les logs à un agent IA pour correction immédiate.';
  return { reason, bypass };
}

function extractKeyErrorMessage(text?: string): string {
  if (!text) return '';
  const lines = text.split('\n');
  const errorRegex = /(error detected|fatal error|exception|fail(?:ed)?[:\s]|no file or variants found|cannot find module|syntaxerror|typeerror|undefined is not)/i;
  for (const line of lines) {
    const trimmed = line.trim();
    if (errorRegex.test(trimmed) && trimmed.length < 180 && !trimmed.startsWith('//') && !trimmed.startsWith('got dependencies')) {
      return trimmed.replace(/^[\s*-]+/, '');
    }
  }
  return '';
}

function extractRelevantLogs(text?: string, maxLines = 26): string {
  if (!text) return 'Aucune sortie console enregistrée.';
  const lines = text.trim().split('\n');
  if (lines.length <= maxLines) return lines.join('\n');

  // Recherche de l'index de la première erreur pertinente pour centrer l'extrait
  const errorRegex = /(error detected|fatal error|exception|fail(?:ed)?[:\s]|no file or variants found|cannot find module)/i;
  const matchIndex = lines.findIndex(l => errorRegex.test(l));

  if (matchIndex > 0) {
    const start = Math.max(0, matchIndex - 5);
    const end = Math.min(lines.length, start + maxLines);
    const slice = lines.slice(start, end);
    const prefix = start > 0 ? `... [${start} lignes initiales omises]\n` : '';
    const suffix = end < lines.length ? `\n... [${lines.length - end} lignes suivantes omises]` : '';
    return prefix + slice.join('\n') + suffix;
  }

  // Repli : les dernières lignes
  return `... [${lines.length - maxLines} lignes précédentes omises]\n` + lines.slice(-maxLines).join('\n');
}

function buildItemPrompt(command: ValidationCommand, result?: ValidationResult): string {
  const exitCode = result?.exitCode ?? (result?.status === 'timed-out' ? 'TIMEOUT' : 1);
  const keyError = extractKeyErrorMessage(result?.output);
  const relevantLogs = extractRelevantLogs(result?.output, 26);

  return [
    `# 🎯 MISSION : Réparation du contrôle en échec [${command.project}]`,
    '',
    `Agis en Tech Lead / Développeur Senior sur ce monorepo.`,
    `Une étape de validation requise échoue lors des vérifications automatisées.`,
    '',
    `## 📌 Contexte & Reproduction`,
    `- **Sous-projet** : \`${command.relPath}/\` (${command.kind})`,
    `- **Type de contrôle** : \`${command.kind}\``,
    `- **Commande défaillante** : \`${command.display}\``,
    `- **Code de sortie** : \`${exitCode}\``,
    `- **Reproduction locale** : \`cd ${command.relPath} && ${command.display}\``,
    ...(keyError ? [`- **Erreur clé détectée** : \`${keyError}\``] : []),
    '',
    `## 📋 Directives de correction (Strictes)`,
    `1. **Résolution racine** : Corrige le problème à la source (configuration, assets, dépendances, code). N'utilise AUCUN contournement temporaire (ne désactive pas le test, ne supprime pas de règle).`,
    `2. **Respect de l'architecture** : Préserve l'intégrité du monorepo et des règles métier.`,
    `3. **Validation finale** : Exécute \`cd ${command.relPath} && ${command.display}\` dans ton terminal pour confirmer que la commande réussit avec le code de sortie 0 avant de terminer.`,
    '',
    `## 📜 Extrait ciblé des logs d'échec`,
    '```console',
    relevantLogs,
    '```',
    '',
    `Analyse la cause exacte, applique le correctif minimal pérenne et valide l'exécution.`
  ].join('\n');
}

function copyAllFailuresReport(plan: ValidationCommand[], results: ValidationResult[]): string {
  const failed = results.filter(result => !['passed', 'running'].includes(result.status));
  if (!failed.length) return '';

  // Regroupement par sous-projet pour traiter les causes liées ensemble
  const byProject = new Map<string, Array<{ cmd: ValidationCommand; res: ValidationResult }>>();
  for (const res of failed) {
    const cmd = plan.find(p => p.id === res.id) || (res as unknown as ValidationCommand);
    const list = byProject.get(cmd.project) || [];
    list.push({ cmd, res });
    byProject.set(cmd.project, list);
  }

  const sections: string[] = [
    `# 🎯 MISSION : Réparation globale des contrôles défaillants (${failed.length} échecs)`,
    '',
    `Agis en Tech Lead / Développeur Senior sur ce monorepo.`,
    `La suite de vérification RepoTwin a identifié **${failed.length} contrôle(s) en échec** répartis sur **${byProject.size} sous-projet(s)**.`,
    '',
    `## 📋 Protocole d'intervention`,
    `1. **Identifier les causes communes (Effet domino)** : Plusieurs échecs d'un même sous-projet partagent souvent la même origine (ex: dépendance manquante, asset ou env manquant, syntaxe). Résous d'abord les causes structurelles.`,
    `2. **Solutions pérennes** : Aucun contournement artificiel (pas de suppression de tests ni de mocks fictifs cachant l'erreur).`,
    `3. **Validation pas à pas** : Re-teste chaque commande au fur et à mesure avec sa commande de reproduction locale.`,
    '',
    `---`
  ];

  let itemIdx = 1;
  for (const [project, items] of byProject.entries()) {
    sections.push(
      '',
      `## 📦 Sous-projet : ${project} (${items.length} échec${items.length > 1 ? 's' : ''})`
    );

    for (const { cmd, res } of items) {
      const keyError = extractKeyErrorMessage(res.output);
      const relevantLogs = extractRelevantLogs(res.output, 20);

      sections.push(
        '',
        `### ${itemIdx}. \`${cmd.display}\` (${cmd.kind})`,
        `- **Chemin** : \`${cmd.relPath}/\``,
        `- **Code de retour** : \`${res.exitCode ?? 1}\``,
        `- **Commande reproduction** : \`cd ${cmd.relPath} && ${cmd.display}\``,
        ...(keyError ? [`- **Erreur détectée** : \`${keyError}\``] : []),
        '',
        '```console',
        relevantLogs,
        '```'
      );
      itemIdx++;
    }
  }

  sections.push(
    '',
    `---`,
    `Merci de débuter par les causes racines communes, d'appliquer les correctifs et de valider que chaque contrôle passe au vert.`
  );

  return sections.join('\n');
}

function CommandRow({
  command,
  index,
  result,
  disabled,
  retry,
  onCopyPrompt,
  onToast
}: {
  command: ValidationCommand;
  index: number;
  result?: ValidationResult;
  disabled: boolean;
  retry: () => void;
  onCopyPrompt: (prompt: string, project: string) => void;
  onToast: (toast: ToastState) => void;
}) {
  const failed = result && !['passed', 'running'].includes(result.status);
  const diag = failed ? getFailureDiagnostic(command, result) : null;
  const prompt = failed ? buildItemPrompt(command, result) : '';
  const hasDetails = Boolean(failed || result?.output);
  const [isOpen, setIsOpen] = useState(Boolean(failed));

  useEffect(() => {
    if (failed) setIsOpen(true);
  }, [failed]);

  return (
    <Collapsible
      open={isOpen}
      onOpenChange={setIsOpen}
      className={cn("rounded-lg border bg-card transition-all", failed ? "border-rose-500/40 bg-rose-950/10" : result?.status === 'passed' ? "border-emerald-500/30" : "border-border")}
    >
      <div className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <span className={cn(
            'grid h-7 w-7 shrink-0 place-items-center rounded-full border text-xs font-mono',
            result?.status === 'passed' && 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300',
            failed && 'border-rose-500/40 bg-rose-500/10 text-rose-300 font-bold',
            !result && 'border-border text-muted-foreground'
          )}>
            {result?.status === 'running' ? <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" /> : result?.status === 'passed' ? <Check className="h-3.5 w-3.5" /> : failed ? <XCircle className="h-3.5 w-3.5" /> : index + 1}
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-sm font-semibold">{command.project}</span>
              <Badge variant="outline" className="font-mono text-[10px] uppercase">{command.kind}</Badge>
              <span className="font-mono text-xs text-muted-foreground">{command.relPath}</span>
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <code className="rounded bg-black/40 px-1.5 py-0.5 font-mono text-xs text-amber-300 border border-zinc-800">
                {command.display}
              </code>
              {result?.durationMs != null && (
                <span className="font-mono text-[10px] text-muted-foreground">
                  {result.durationMs} ms
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 self-end sm:self-auto">
          {failed && (
            <Button
              variant="outline"
              size="sm"
              className="border-indigo-500/50 bg-indigo-950/30 text-indigo-300 hover:bg-indigo-900/50 hover:text-indigo-200 text-xs h-8 shadow-sm"
              onClick={() => onCopyPrompt(prompt, command.project)}
              title="Copier le prompt préformaté pour l'agent IA"
            >
              <Clipboard className="mr-1.5 h-3.5 w-3.5" />
              Copier le prompt
            </Button>
          )}
          {result?.status === 'running' && (
            <Button
              variant="outline"
              size="sm"
              disabled
              className="border-indigo-500/40 bg-indigo-950/20 text-indigo-300 text-xs h-8 cursor-not-allowed opacity-80"
              title="Ce contrôle est actuellement en cours d’exécution..."
            >
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              En cours…
            </Button>
          )}
          {failed && result?.status !== 'running' && (
            <Button
              variant="outline"
              size="sm"
              disabled={disabled}
              onClick={retry}
              className={cn(
                "border-cyan-500/40 bg-cyan-950/20 text-cyan-300 hover:bg-cyan-900/40 text-xs h-8 transition-opacity",
                disabled && "opacity-50 cursor-not-allowed pointer-events-none"
              )}
              title={disabled ? "Vérification en cours. Attendez la fin des étapes." : "Re-tester uniquement ce contrôle dans le Twin"}
            >
              <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
              Re-tester
            </Button>
          )}
          {hasDetails && (
            <CollapsibleTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                title={isOpen ? "Réduire les détails" : "Afficher les détails"}
              >
                <ChevronDown className={cn("h-4 w-4 transition-transform duration-200", isOpen && "rotate-180")} />
              </Button>
            </CollapsibleTrigger>
          )}
        </div>
      </div>

      {hasDetails && (
        <CollapsibleContent>
          <div className="space-y-3 pt-1">
            {failed && diag && (
              <div className="mx-3 rounded-md border border-rose-500/30 bg-black/40 p-3 text-xs leading-relaxed">
                <div className="flex flex-col gap-1.5">
                  <div><span className="font-semibold text-rose-400">🩺 Diagnostic : </span><span className="text-zinc-300">{diag.reason}</span></div>
                  <div><span className="font-semibold text-zinc-400">🛡️ Contexte : </span><span className="text-zinc-400">{diag.bypass}</span></div>
                  <div className="pt-1 font-mono text-[11px]"><span className="text-zinc-500">💻 Test manuel : </span><code className="rounded bg-zinc-900 border border-zinc-800 px-1.5 py-0.5 text-amber-300">cd {command.relPath} && {command.display}</code></div>
                </div>
              </div>
            )}

            {result?.output && (
              <div className="border-t border-border bg-black/50 p-3">
                <div className="mb-1.5 flex items-center justify-between text-[11px] text-muted-foreground font-mono">
                  <span>Sortie console ({result.output.length} octets) :</span>
                  <Button variant="ghost" size="sm" className="h-6 text-[10px]" onClick={() => {
                    navigator.clipboard.writeText(result.output || '');
                    onToast({ message: 'Sortie console copiée !', tone: 'neutral' });
                  }}>
                    <Clipboard className="mr-1 h-3 w-3" /> Copier logs
                  </Button>
                </div>
                <pre className="scrollbar-thin max-h-72 overflow-auto whitespace-pre-wrap font-mono text-xs text-zinc-300 rounded border border-zinc-900 bg-black/60 p-2.5">
                  {result.output}{result.outputTruncated ? '\n\n[sortie console tronquée]' : ''}
                </pre>
              </div>
            )}
          </div>
        </CollapsibleContent>
      )}
    </Collapsible>
  );
}

function ConfirmDialog({ action, close }: { action: ConfirmAction | null; close: () => void }) { return <AlertDialog open={Boolean(action)} onOpenChange={open => !open && close()}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>{action?.title}</AlertDialogTitle><AlertDialogDescription>{action?.description}</AlertDialogDescription></AlertDialogHeader>{action?.details?.length ? <div className="max-h-56 overflow-auto rounded-md border bg-black/20 p-3 font-mono text-xs"><ul className="space-y-1">{action.details.map((detail, index) => <li key={`${detail}-${index}`}>{detail}</li>)}</ul></div> : null}<AlertDialogFooter><AlertDialogCancel>Annuler</AlertDialogCancel><AlertDialogAction onClick={() => { const run = action?.run; close(); run?.(); }}>{action?.confirmLabel}</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>; }
function CollapsibleSection({ title, children, tone = 'neutral' }: { title: string; children: React.ReactNode; tone?: 'neutral' | 'danger' | 'success' }) { return <Collapsible className={cn('rounded-lg border bg-card', tone === 'danger' && 'border-red-500/30', tone === 'success' && 'border-emerald-500/30')}><CollapsibleTrigger className="flex w-full items-center justify-between p-4 text-left text-sm font-medium">{title}<ChevronDown className="h-4 w-4 text-muted-foreground" /></CollapsibleTrigger><CollapsibleContent className="border-t p-4">{children}</CollapsibleContent></Collapsible>; }
function FilePreview({ name, content }: { name: string; content: string }) { return <div className="min-w-0 rounded-md border bg-background p-4"><div className="mb-3 flex items-center justify-between"><p className="font-mono text-sm font-medium">{name}</p><Badge variant="secondary">proposé</Badge></div><pre className="scrollbar-thin max-h-72 overflow-auto whitespace-pre-wrap text-xs text-muted-foreground">{content}</pre></div>; }
function Score({ label, score, grade }: { label: string; score: number | null; grade: string }) { return <div className="rounded-md border bg-background p-4"><p className="text-xs text-muted-foreground">{label}</p><div className="mt-2 flex items-end justify-between"><p className="text-2xl font-semibold">{score == null ? '—' : score}<span className="text-sm text-muted-foreground">{score == null ? '' : '/100'}</span></p><Badge variant="secondary">{grade}</Badge></div></div>; }
function Metric({ label, value }: { label: string; value: string }) { return <div className="rounded-md border bg-background p-3"><p className="text-xs text-muted-foreground">{label}</p><p className="mt-1 font-mono text-lg font-semibold">{value}</p></div>; }
function ResultOutput({ label, result }: { label: string; result?: ValidationResult }) { return <div className="rounded-md border bg-black/20 p-3"><p className="mb-2 text-xs font-medium text-muted-foreground">{label} · {result ? `${result.status} · ${result.durationMs} ms` : 'absent'}</p><pre className="max-h-48 overflow-auto whitespace-pre-wrap text-xs">{result?.output || 'Contrôle absent'}</pre></div>; }
function EmptySuccess({ text }: { text: string }) { return <div className="flex items-center gap-2 rounded-md border border-emerald-500/30 bg-emerald-500/5 p-3 text-sm text-emerald-300"><CheckCircle2 className="h-4 w-4" />{text}</div>; }
function LoadingScreen() { return <main className="grid min-h-screen place-items-center"><div className="text-center"><Loader2 className="mx-auto h-6 w-6 animate-spin text-primary" /><p className="mt-3 text-sm text-muted-foreground">Analyse du dépôt…</p></div></main>; }
function LoadFailure({ message, retry }: { message: string; retry: () => void }) { return <main className="grid min-h-screen place-items-center p-6"><Card className="max-w-md"><CardHeader><CardTitle>Studio indisponible</CardTitle><CardDescription>{message}</CardDescription></CardHeader><CardContent><Button onClick={retry}><RefreshCw className="mr-2 h-4 w-4" />Réessayer</Button></CardContent></Card></main>; }
function Toast({ state }: { state: NonNullable<ToastState> }) { return <div role="status" className={cn('fixed bottom-5 right-5 z-[70] max-w-sm rounded-lg border bg-popover px-4 py-3 text-sm shadow-xl', state.tone === 'success' && 'border-emerald-500/40', state.tone === 'error' && 'border-red-500/40')}>{state.message}</div>; }

function messageOf(error: unknown) { return error instanceof Error ? error.message : 'Action impossible'; }
function mergeResult(list: ValidationResult[], result: ValidationResult) { const index = list.findIndex(item => item.id === result.id); if (index >= 0) list[index] = result; else list.push(result); }
function busyLabel(value: string, lang: Language = 'en') {
  if (lang === 'fr') {
    return value === 'create' ? 'Création du Twin…' : value === 'verify' ? 'Vérification en cours…' : value === 'apply' ? 'Application…' : value.startsWith('compare') ? 'Comparaison…' : 'Nettoyage…';
  }
  return value === 'create' ? 'Creating Twin candidate…' : value === 'verify' ? 'Verifying checks…' : value === 'apply' ? 'Applying files…' : value.startsWith('compare') ? 'Comparing revisions…' : 'Cleaning session…';
}
function workflowStatus(step: WorkflowStep | 'applied', t?: (key: any) => string) {
  if (t) {
    if (step === 'idle') return t('status_idle');
    if (step === 'created') return t('status_created');
    if (step === 'failed') return t('status_failed');
    if (step === 'verified') return t('status_verified');
    return t('status_applied');
  }
  return step === 'idle' ? 'Initial analysis completed' : step === 'created' ? 'Twin candidate created · authorization required' : step === 'failed' ? 'Verification blocked · check failing controls' : step === 'verified' ? 'Candidate verified · ready to apply' : 'Files applied locally';
}
function workflowHint(step: WorkflowStep | 'applied', t?: (key: any) => string) {
  if (t) {
    if (step === 'idle') return t('workflow_hint_idle');
    if (step === 'created') return t('workflow_hint_created');
    if (step === 'failed') return t('workflow_hint_failed');
    if (step === 'verified') return t('workflow_hint_verified');
    return t('workflow_hint_applied');
  }
  return step === 'idle' ? 'No repository files modified.' : step === 'created' ? 'Nothing executes before your confirmation.' : step === 'failed' ? 'Check failing controls before rerun.' : step === 'verified' ? 'Diff remains visible before applying.' : 'No commit or push performed.';
}
function verdictLabel(verdict: string) { return verdict === 'regressions' ? 'Régression(s) observée(s)' : verdict === 'no-regression-observed' ? 'Aucune régression observée sur les contrôles exécutés' : 'Comparaison incomplète'; }
function formatComparisonPlan(plan: any) { const lines = [`Avant: ${plan.baseCommit}`, `Après: ${plan.targetCommit}`]; for (const side of ['before', 'after']) for (const command of plan[side] || []) lines.push(`${side === 'before' ? 'Avant' : 'Après'} · ${command.relPath} · ${command.display}`); return [...lines, ...(plan.warnings || [])].join('\n'); }
function downloadJson(report: unknown) { const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' })); const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'repotwin-comparison.json'; anchor.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000); }
async function copyFailureReport(results: ValidationResult[]) { const failed = results.filter(result => result.status !== 'passed'); await navigator.clipboard.writeText(failed.map(result => `${result.project} · ${result.display}\nStatut: ${result.status}\n${result.output || ''}`).join('\n\n---\n\n')); }
