export const workflowStyles = `
  [hidden] { display: none !important; }
  * { letter-spacing: 0 !important; }
  .workspace-tabs { display: flex; gap: 24px; border-bottom: 1px solid #27272a; }
  .workspace-tabs button { padding: 12px 0; color: #a1a1aa; border-bottom: 2px solid transparent; font-size: 13px; }
  .workspace-tabs button[aria-selected="true"] { color: #fafafa; border-bottom-color: #34d399; }
  .workflow-bar { position: sticky; top: 0; z-index: 30; background: #101012; border-bottom: 1px solid #3f3f46; padding: 16px 0; margin-bottom: 24px; }
  .workflow-steps { display: grid; grid-template-columns: repeat(4,minmax(0,1fr)); gap: 8px; margin-bottom: 16px; }
  .workflow-steps button { display: flex; align-items: center; gap: 8px; color: #a1a1aa; font-size: 12px; padding: 4px 0; min-width: 0; text-align: left; }
  .workflow-steps button span:first-child { display: grid; place-items: center; width: 24px; height: 24px; border: 1px solid #52525b; border-radius: 50%; flex-shrink: 0; }
  .workflow-steps button[aria-current="step"] { color: #fafafa; }
  .workflow-steps button[aria-current="step"] span:first-child { border-color: #34d399; background: #10352a; color: #6ee7b7; }
  .workflow-steps button:disabled { opacity: .4; cursor: not-allowed; }
  .workflow-action-row { display: flex; align-items: center; justify-content: space-between; gap: 20px; }
  .workflow-action-row > div:first-child { min-width: 0; }
  #workflowStatus { font-size: 13px; font-weight: 600; color: #f4f4f5; }
  #workflowHint { margin-top: 4px; font-size: 12px; color: #a1a1aa; overflow-wrap: anywhere; }
  #workflowActions { display: flex; flex-shrink: 0; min-height: 40px; align-items: center; }
  #workflowActions button { border-radius: 6px; min-height: 40px; padding: 10px 16px; background: #f4f4f5; color: #18181b; border: 1px solid #f4f4f5; font-size: 12px; font-weight: 600; box-shadow: none; }
  #workflowActions button:disabled { opacity: .55; cursor: wait; }
  #workflowActions #applyBadge { display: none; }
  .workflow-content { min-height: 350px; }
  .workflow-content > section, .workflow-content > details, .workflow-content > div { margin-top: 24px; }
  .workflow-content > :first-child { margin-top: 0; }
  #workflowStageHeading { font-size: 18px; font-weight: 600; outline: none; margin-bottom: 20px; scroll-margin-top: calc(var(--workflow-bar-height,140px) + 20px); }
  #workspaceShell section { border-radius: 8px; }
  #workflowDetails { border-top: 1px solid #27272a; padding-top: 18px; margin-top: 24px; }
  #workflowDetails summary { cursor: pointer; font-size: 12px; color: #a1a1aa; }
  #workflowDetails > section { margin-top: 16px; }
  #comparisonWorkspace { padding-top: 24px; }
  #sessionMenu { position: relative; font-size: 12px; color: #a1a1aa; }
  #sessionMenu summary { cursor: pointer; padding: 8px; }
  #sessionMenu[open] > div { position: absolute; right: 0; top: 34px; z-index: 40; min-width: 200px; padding: 8px; background: #18181b; border: 1px solid #3f3f46; border-radius: 6px; }
  #twinPathLabel, #applicationResult { overflow-wrap: anywhere; }
  #progressBarLabel { white-space: normal; overflow-wrap: anywhere; }
  @media (max-width: 600px) {
    body { padding: 16px !important; }
    .workflow-action-row { flex-direction: column; align-items: stretch; gap: 12px; }
    #workflowActions, #workflowActions button { width: 100%; justify-content: center; }
    .workflow-steps { gap: 4px; }
    .workflow-steps button { flex-direction: column; align-items: flex-start; gap: 4px; font-size: 11px; }
    .workspace-tabs { gap: 20px; }
    #workspaceShell section { padding: 16px; }
  }
  @media (prefers-reduced-motion: reduce) {
    *, *::before, *::after { scroll-behavior: auto !important; transition: none !important; animation: none !important; }
  }
`;

export const workflowShell = `
  <div id="workspaceShell" hidden>
    <div class="workspace-tabs" role="tablist" aria-label="Outils du dépôt">
      <button id="instructionsTab" role="tab" aria-selected="true" aria-controls="instructionsWorkspace">Instructions du dépôt</button>
      <button id="comparisonTab" role="tab" aria-selected="false" aria-controls="comparisonWorkspace" tabindex="-1">Comparer deux versions</button>
    </div>
    <div id="instructionsWorkspace" role="tabpanel" aria-labelledby="instructionsTab">
      <div id="workflowBar" class="workflow-bar">
        <nav class="workflow-steps" aria-label="Étapes du candidat">
          <button data-workflow-stage="diagnostic"><span>1</span><span>Diagnostic</span></button>
          <button data-workflow-stage="proposal"><span>2</span><span>Proposition</span></button>
          <button data-workflow-stage="verification" disabled><span>3</span><span>Vérification</span></button>
          <button data-workflow-stage="application" disabled><span>4</span><span>Application</span></button>
        </nav>
        <div class="workflow-action-row">
          <div><p id="workflowStatus" role="status" aria-live="polite"></p><p id="workflowHint"></p></div>
          <div id="workflowActions">
            <button id="reviewProposalBtn">Examiner la proposition</button>
            <button id="reviewApplicationBtn" hidden>Examiner avant application</button>
            <button id="finishWorkflowBtn" hidden>Terminer et nettoyer</button>
          </div>
        </div>
      </div>
      <h2 id="workflowStageHeading" tabindex="-1">Diagnostic du dépôt</h2>
      <div id="diagnosticStage" class="workflow-content"></div>
      <div id="proposalStage" class="workflow-content" hidden></div>
      <div id="verificationStage" class="workflow-content" hidden></div>
      <div id="applicationStage" class="workflow-content" hidden>
        <section class="border border-zinc-800 p-5">
          <h3 class="text-sm font-semibold">Fichiers de la proposition</h3>
          <ul class="text-sm text-zinc-300 mt-4 space-y-2"><li><code>AGENTS.md</code></li><li><code>agent-ready.json</code></li></ul>
          <p id="applicationResult" class="text-xs text-zinc-400 mt-4">Application locale avec sauvegarde des fichiers existants.</p>
          <details class="mt-4 text-xs text-zinc-300"><summary class="cursor-pointer">Voir le diff à appliquer</summary><pre id="applicationDiffContent" class="mt-3 max-h-80 overflow-auto whitespace-pre-wrap"></pre></details>
          <button id="backToResultsBtn" class="text-xs text-emerald-300 mt-4 underline">Revoir les résultats</button>
        </section>
      </div>
    </div>
    <div id="comparisonWorkspace" role="tabpanel" aria-labelledby="comparisonTab" hidden></div>
  </div>
`;

export const workflowScript = `
    let workflowStage = 'diagnostic';
    let workflowBusy = false;
    const workflowTitles = { diagnostic: 'Diagnostic du dépôt', proposal: 'Proposition de modification', verification: 'Vérification du candidat', application: 'Application locale' };
    const workflowActions = ['reviewProposalBtn', 'createTwinBtn', 'verifyBtn', 'reviewApplicationBtn', 'applyBtn', 'finishWorkflowBtn'];
    function placeWorkflowSection(id, destination) {
      const element = document.getElementById(id);
      if (element) document.getElementById(destination).appendChild(element);
    }
    function setWorkspace(tabName) {
      if (workflowBusy) return;
      for (const name of ['instructions', 'comparison']) {
        const selected = name === tabName;
        const tab = document.getElementById(name + 'Tab');
        tab.setAttribute('aria-selected', String(selected));
        tab.tabIndex = selected ? 0 : -1;
        document.getElementById(name + 'Workspace').hidden = !selected;
      }
    }
    function showWorkflowStage(stage, focus = false) {
      const stepButton = document.querySelector('[data-workflow-stage="' + stage + '"]');
      if (workflowBusy || !stepButton || stepButton.disabled) return;
      workflowStage = stage;
      document.getElementById('proposalPanel').hidden = Boolean(document.getElementById('diffContent').textContent);
      for (const key of Object.keys(workflowTitles)) {
        document.getElementById(key + 'Stage').hidden = key !== stage;
        const button = document.querySelector('[data-workflow-stage="' + key + '"]');
        if (key === stage) button.setAttribute('aria-current', 'step'); else button.removeAttribute('aria-current');
      }
      document.getElementById('workflowStageHeading').textContent = workflowTitles[stage];
      updateWorkflow(currentStep);
      if (focus) {
        const heading = document.getElementById('workflowStageHeading');
        heading.focus({ preventScroll: true });
        const top = heading.getBoundingClientRect().top;
        const sticky = document.getElementById('workflowBar').getBoundingClientRect().bottom;
        if (top < sticky + 12 || top > window.innerHeight - 100) heading.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
      }
    }
    function updateWorkflow(step, operation) {
      workflowBusy = step === 'busy';
      document.getElementById('workflowBar').setAttribute('aria-busy', String(workflowBusy));
      document.getElementById('cleanTwinBtn').disabled = workflowBusy;
      for (const id of ['instructionsTab', 'comparisonTab']) document.getElementById(id).disabled = workflowBusy;
      document.querySelectorAll('[data-workflow-stage]').forEach(button => {
        const stage = button.getAttribute('data-workflow-stage');
        button.disabled = workflowBusy || (stage === 'verification' && currentStep === 'idle') || (stage === 'application' && !['verified', 'applied'].includes(currentStep));
      });
      if (workflowBusy) {
        workflowActions.forEach(id => { document.getElementById(id).disabled = true; });
        const message = { create: 'Création du Twin en cours…', verify: 'Vérifications en cours…', apply: 'Application des fichiers en cours…', clean: 'Nettoyage du candidat en cours…' };
        document.getElementById('workflowStatus').textContent = message[operation] || 'Opération en cours…';
        document.getElementById('workflowHint').textContent = 'La progression et les résultats apparaissent dans cette étape.';
        return;
      }
      let action;
      let status;
      let hint;
      if (step === 'idle') {
        action = workflowStage === 'proposal' ? 'createTwinBtn' : 'reviewProposalBtn';
        status = workflowStage === 'proposal' ? 'Proposition prête à examiner' : 'Analyse initiale terminée';
        hint = workflowStage === 'proposal' ? 'Le Twin contiendra la proposition, à partir du dernier commit enregistré.' : 'Aucun fichier du dépôt modifié.';
      } else if (step === 'created') {
        action = 'verifyBtn'; status = 'Twin créé · en attente de votre autorisation';
        hint = 'Rien ne s’exécute encore. ' + candidateValidationPlan.length + ' commande(s) prévue(s).';
      } else if (step === 'failed') {
        action = 'verifyBtn'; status = 'Vérification terminée · application bloquée';
        hint = 'Consultez les contrôles en échec. Leur origine reste à établir sans comparaison avec la référence.';
      } else if (step === 'verified') {
        action = workflowStage === 'application' ? 'applyBtn' : 'reviewApplicationBtn';
        status = 'Vérifications terminées · candidat applicable';
        hint = 'Les résultats et le diff restent accessibles avant application.';
      } else {
        action = 'finishWorkflowBtn'; status = 'Fichiers appliqués localement';
        hint = 'La sauvegarde est conservée. Aucun commit ni push effectué.';
      }
      workflowActions.forEach(id => {
        const button = document.getElementById(id);
        button.hidden = id !== action;
        if (id === action) button.disabled = false;
      });
      document.getElementById('createTwinBtn').textContent = 'Créer le Twin';
      document.getElementById('verifyBtn').textContent = step === 'failed' ? 'Relancer les vérifications' : candidateValidationPlan.length ? 'Autoriser et vérifier (' + candidateValidationPlan.length + ')' : 'Vérifier les instructions';
      document.getElementById('workflowStatus').textContent = status;
      document.getElementById('workflowHint').textContent = hint;
    }
    function initializeWorkflow() {
      for (const id of ['createTwinBtn', 'verifyBtn', 'applyBtn']) placeWorkflowSection(id, 'workflowActions');
      for (const id of ['issuesPanel', 'projectsPanel', 'observationsPanel']) placeWorkflowSection(id, 'diagnosticStage');
      const metrics = document.createElement('details'); metrics.id = 'workflowDetails';
      const summary = document.createElement('summary'); summary.textContent = 'Scores documentaires et rapport importé';
      metrics.appendChild(summary); document.getElementById('diagnosticStage').appendChild(metrics);
      placeWorkflowSection('scoresPanel', 'workflowDetails'); placeWorkflowSection('falsePositivesPanel', 'workflowDetails');
      for (const id of ['proposalPanel', 'diffSection', 'tokensPanel']) placeWorkflowSection(id, 'proposalStage');
      placeWorkflowSection('verificationProgressSection', 'verificationStage');
      const candidateDetails = document.createElement('details'); candidateDetails.className = 'text-xs text-zinc-400 mt-4';
      const candidateSummary = document.createElement('summary'); candidateSummary.textContent = 'Emplacement du candidat';
      candidateDetails.appendChild(candidateSummary); document.getElementById('verificationStage').appendChild(candidateDetails);
      candidateDetails.appendChild(document.getElementById('twinBanner'));
      document.getElementById('comparisonWorkspace').appendChild(document.getElementById('comparisonTool'));
      document.getElementById('reviewProposalBtn').addEventListener('click', () => showWorkflowStage('proposal', true));
      document.getElementById('reviewApplicationBtn').addEventListener('click', () => showWorkflowStage('application', true));
      document.getElementById('backToResultsBtn').addEventListener('click', () => showWorkflowStage('verification', true));
      document.getElementById('finishWorkflowBtn').addEventListener('click', () => cleanTwins());
      for (const name of ['instructions', 'comparison']) {
        const tab = document.getElementById(name + 'Tab');
        tab.addEventListener('click', () => setWorkspace(name));
        tab.addEventListener('keydown', event => {
          if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
          event.preventDefault();
          const next = event.key === 'Home' ? 'instructions' : event.key === 'End' ? 'comparison' : name === 'instructions' ? 'comparison' : 'instructions';
          setWorkspace(next); document.getElementById(next + 'Tab').focus();
        });
      }
      document.querySelectorAll('[data-workflow-stage]').forEach(button => button.addEventListener('click', () => showWorkflowStage(button.getAttribute('data-workflow-stage'), true)));
      const bar = document.getElementById('workflowBar');
      new ResizeObserver(() => document.documentElement.style.setProperty('--workflow-bar-height', bar.offsetHeight + 'px')).observe(bar);
      document.getElementById('workspaceShell').hidden = false;
    }
`;
