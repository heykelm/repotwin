import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
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
import { createComparisonApi, comparisonPanel, comparisonScript } from './comparison-ui.js';
import { workflowStyles, workflowShell, workflowScript } from './workflow-ui.js';
import { buildValidationPlan, runValidationPlan, validationConsentToken, ValidationCommand, ValidationResult } from '../verification/command-runner.js';
import { saveApplicationSnapshot, ApplicationSnapshot } from '../report/application-snapshot.js';

export function startDevServer(repoPath: string, port = 4242, reportPath?: string) {
  const sessionToken = crypto.randomBytes(32).toString('hex');
  const comparisonApi = createComparisonApi(repoPath, sessionToken);
  let lastAppliedSnapshot: ApplicationSnapshot | undefined;
  try {
    const latestJson = path.join(repoPath, '.repotwin', 'reports', 'repotwin-certificate-latest.json');
    if (fs.existsSync(latestJson)) {
      lastAppliedSnapshot = JSON.parse(fs.readFileSync(latestJson, 'utf-8'));
    }
  } catch {}
  let candidate: {
    recipe: GeneratedRecipe;
    twin: TwinResult;
    projects: SubprojectInfo[];
    before: ReturnType<typeof auditInstructions>;
    validationPlan: ValidationCommand[];
    consentToken: string;
    commandResults: ValidationResult[];
    verified: boolean;
    verification?: {
      score: number;
      grade: string;
      resolved: number;
      introduced: number;
      passed: boolean;
      durationMs: number;
      resolvedList?: Array<{ message: string }>;
    };
  } | undefined;
  let busy = false;
  const server = http.createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self' data:; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
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
    if (await comparisonApi(url, req, res)) return;

    if (url.pathname === '/api/studio/state' && req.method === 'GET') {
      const step = !candidate
        ? (lastAppliedSnapshot ? 'applied' : 'idle')
        : candidate.verified
          ? 'verified'
          : candidate.commandResults.length
            ? 'failed'
            : 'created';
      const state: StudioState = {
        step,
        port: boundPort,
        twinPath: candidate?.twin.twinPath ?? '',
        validationPlan: candidate?.validationPlan ?? [],
        scriptBodies: candidate ? describeScripts(candidate.twin.twinPath, candidate.validationPlan) : {},
        consentToken: candidate?.consentToken ?? '',
        commandResults: candidate?.commandResults ?? [],
        diff: candidate?.twin.diff ?? (lastAppliedSnapshot?.diff ?? ''),
        verification: candidate?.verification,
        appliedSnapshot: lastAppliedSnapshot
      };
      const payload = buildStudioPayload(analyzeRepository(repoPath, reportPath), sessionToken, state);
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: true, ...payload }));
      return;
    }

    // API: Create Twin
    if (url.pathname === '/api/twin/create' && req.method === 'POST') {
      if (candidate) {
        res.writeHead(409, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'Un candidat existe déjà. Vérifiez-le, appliquez-le ou cliquez sur Nettoyer.' }));
        return;
      }
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

      // Source files and credentials stay outside the reviewed candidate.

      const targetId = url.searchParams.get('id');
      const onlyFailed = url.searchParams.get('onlyFailed') === 'true';

      let planToRun = candidate.validationPlan;
      if (targetId) {
        const item = candidate.validationPlan.find(cmd => cmd.id === targetId);
        if (!item) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: `Point de validation inconnu : ${targetId}` }));
          return;
        }
        planToRun = [item];
      } else if (onlyFailed && candidate.commandResults?.length) {
        const failedIds = new Set(candidate.commandResults.filter(r => r.status !== 'passed').map(r => r.id));
        planToRun = candidate.validationPlan.filter(cmd => failedIds.has(cmd.id));
        if (planToRun.length === 0) {
          planToRun = candidate.validationPlan;
        }
      }

      // Cleanup removes installed dependencies; targeted retries need the same
      // approved lockfile installation before running dependent controls again.
      const dependentProjects = new Set(planToRun.filter(command => command.kind !== 'install').map(command => command.relPath));
      const selectedIds = new Set(planToRun.map(command => command.id));
      planToRun = candidate.validationPlan.filter(command =>
        selectedIds.has(command.id) || (command.kind === 'install' && dependentProjects.has(command.relPath))
      );
      const verificationStartedAt = Date.now();
      candidate.verification = undefined;
      const isStreaming = req.headers['x-repotwin-stream'] === 'true' || url.searchParams.get('stream') === 'true';
      if (isStreaming) {
        res.writeHead(200, {
          'Content-Type': 'application/x-ndjson; charset=utf-8',
          'Cache-Control': 'no-cache, no-transform',
          'Connection': 'keep-alive',
          'X-Accel-Buffering': 'no'
        });
        res.write(JSON.stringify({ type: 'phase', phase: 'audit', message: 'Audit des instructions et intégrité du Twin...' }) + '\n');
      }

      const after = auditInstructions(candidate.twin.twinPath, candidate.projects);
      const introduced = after.findings.filter(f => !candidate!.before.findings.some(old => old.file === f.file && old.rule === f.rule && old.message === f.message));
      const resolved = candidate.before.findings.filter(f => !after.findings.some(current => current.file === f.file && current.rule === f.rule && current.message === f.message));

      if (isStreaming) {
        const phaseMsg = targetId
          ? `Re-test ciblé du point ${targetId}...`
          : onlyFailed
            ? `Relance de ${planToRun.length} point(s) en échec...`
            : `Démarrage de la vérification (${planToRun.length} points)...`;
        res.write(JSON.stringify({
          type: 'phase',
          phase: 'commands_start',
          total: planToRun.length,
          message: phaseMsg
        }) + '\n');
      }

      const targetResults = await runValidationPlan(candidate.twin.twinPath, planToRun, {
        onProgress: (evt) => {
          if (isStreaming) {
            res.write(JSON.stringify(evt) + '\n');
          }
        }
      });

      if (planToRun.length < candidate.validationPlan.length && candidate.commandResults?.length) {
        const resultMap = new Map(candidate.commandResults.map(r => [r.id, r]));
        for (const r of targetResults) {
          resultMap.set(r.id, r);
        }
        candidate.commandResults = candidate.validationPlan.map(cmd => resultMap.get(cmd.id)!).filter(Boolean);
      } else {
        candidate.commandResults = targetResults;
      }

      const commandsPassed = candidate.commandResults.length === candidate.validationPlan.length &&
        candidate.validationPlan.every(command => candidate!.commandResults.some(result => result.id === command.id && result.status === 'passed'));
      let cleanedArtifacts: string[] = [];
      let cleanupError: string | undefined;
      try {
        cleanedArtifacts = cleanCandidateIgnoredArtifacts(repoPath, candidate.twin);
      } catch (error) {
        cleanupError = error instanceof Error ? error.message : 'Candidate cleanup failed';
      }
      const candidateIntact = candidateIsIntact(repoPath, candidate.twin);

      // Candidate-only execution cannot establish whether a failure predates the proposal.
      const canApply = commandsPassed && candidateIntact && !cleanupError && introduced.length === 0;
      candidate.verified = canApply;
      candidate.verification = {
        score: after.scores.correctedScore,
        grade: after.scores.correctedGrade,
        resolved: resolved.length,
        introduced: introduced.length,
        passed: canApply,
        durationMs: Date.now() - verificationStartedAt,
        resolvedList: resolved.map(r => ({ message: r.message }))
      };

      const resultPayload = {
        passed: commandsPassed && candidateIntact && !cleanupError && introduced.length === 0,
        canApply: candidate.verified,
        noRegression: introduced.length === 0,
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
      };

      if (isStreaming) {
        res.write(JSON.stringify({ type: 'complete', ok: true, result: resultPayload }) + '\n');
        res.end();
      } else {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, result: resultPayload }));
      }
      return;
    }

    // API: Apply Fix
    if (url.pathname === '/api/twin/apply' && req.method === 'POST') {
      try {
        if (!candidate) throw new Error('Create and review a candidate first');
        if (!candidate.verified) throw new Error('Run candidate verification first');
        if (!candidateIsIntact(repoPath, candidate.twin)) throw new Error('Candidate changed after verification');
        const agentsPath = path.join(candidate.twin.twinPath, 'AGENTS.md');
        const readyPath = path.join(candidate.twin.twinPath, 'agent-ready.json');
        const fileSha = (filePath: string) => fs.existsSync(filePath) ? crypto.createHash('sha256').update(fs.readFileSync(filePath, 'utf-8')).digest('hex') : '';
        const recipeFilesIntact = fileSha(agentsPath) === crypto.createHash('sha256').update(candidate.recipe.agentsMdContent).digest('hex') &&
          fileSha(readyPath) === crypto.createHash('sha256').update(candidate.recipe.agentReadyJsonContent).digest('hex');
        if (!recipeFilesIntact) throw new Error('Candidate changed after verification');
        const recipe = generateOptimizationRecipe(repoPath, discoverSubprojects(repoPath), []);
        if (recipe.agentsMdContent !== candidate.recipe.agentsMdContent || recipe.agentReadyJsonContent !== candidate.recipe.agentReadyJsonContent) {
          throw new Error('Repository changed since candidate creation. Create and review a new candidate.');
        }
        const currentAgents = fs.existsSync(path.join(repoPath, 'AGENTS.md'))
          ? fs.readFileSync(path.join(repoPath, 'AGENTS.md'), 'utf-8')
          : '';
        const currentTokens = currentAgents ? Math.round(currentAgents.length / 4) : 0;
        const proposedTokens = candidate.recipe.agentsMdContent ? Math.round(candidate.recipe.agentsMdContent.length / 4) : 0;
        const tokensSavedPerQuery = Math.max(0, currentTokens - proposedTokens);
        const percentSaved = currentTokens > 0 ? Math.round((tokensSavedPerQuery / currentTokens) * 100) : 0;

        let reqBody: any = {};
        try {
          const raw = await new Promise<string>((resolve) => {
            let data = '';
            req.on('data', chunk => { data += chunk; });
            req.on('end', () => resolve(data));
            req.on('error', () => resolve(''));
          });
          reqBody = raw ? JSON.parse(raw) : {};
        } catch {}

        const selectedTools: string[] = Array.isArray(reqBody.selectedTools) ? reqBody.selectedTools : [];
        const TOOL_MONTHLY_QUERIES: Record<string, number> = {
          cursor: 350,
          claude: 250,
          gemini: 300,
          openai: 300,
          copilot: 200,
          api: 400
        };
        const estimatedQueriesPerMonth = selectedTools.length > 0
          ? selectedTools.reduce((sum, id) => sum + (TOOL_MONTHLY_QUERIES[id] || 250), 0)
          : 500;
        const effectiveTokensSaved = tokensSavedPerQuery > 0 ? tokensSavedPerQuery : (currentTokens > 0 ? 0 : 2000);
        const monthlySavedTokens = effectiveTokensSaved * estimatedQueriesPerMonth;
        const yearlySavedTokens = monthlySavedTokens * 12;
        const monthlySavingsUsd = Number(((monthlySavedTokens / 1_000_000) * 3).toFixed(2));
        const yearlySavingsUsd = Number(((yearlySavedTokens / 1_000_000) * 3).toFixed(2));

        const backupDir = applyRecipe(repoPath, candidate.recipe);

        const snapshot: ApplicationSnapshot = {
          id: crypto.randomUUID().slice(0, 8),
          appliedAt: new Date().toISOString(),
          appliedAtFormatted: new Intl.DateTimeFormat('fr-FR', {
            dateStyle: 'full',
            timeStyle: 'medium'
          }).format(new Date()),
          repoPath: fs.realpathSync(repoPath),
          repoName: path.basename(repoPath),
          backupDir,
          baseCommit: candidate.twin.branchName,
          scores: {
            before: {
              score: candidate.before.scores.correctedScore,
              grade: candidate.before.scores.correctedGrade
            },
            after: {
              score: candidate.verification?.score ?? candidate.before.scores.correctedScore,
              grade: candidate.verification?.grade ?? candidate.before.scores.correctedGrade
            }
          },
          findings: {
            resolvedCount: candidate.verification?.resolved ?? 0,
            resolved: (candidate.verification as any)?.resolvedList || [],
            remainingCount: candidate.verification?.introduced ?? 0
          },
          commands: {
            total: candidate.validationPlan.length,
            passed: (candidate.commandResults || []).filter(r => r.status === 'passed').length,
            results: (candidate.commandResults || []).map(r => ({
              id: r.id,
              project: r.project,
              display: r.display,
              kind: r.kind,
              status: r.status,
              durationMs: r.durationMs
            }))
          },
          tokenEconomy: {
            selectedTools,
            tokensSavedPerQuery: effectiveTokensSaved,
            totalTokensSaved: effectiveTokensSaved,
            percentSaved,
            totalOriginalTokens: currentTokens,
            totalOptimizedTokens: proposedTokens,
            estimatedQueriesPerMonth,
            monthlySavedTokens,
            yearlySavedTokens,
            monthlySavingsUsd,
            yearlySavingsUsd
          },
          filesApplied: ['AGENTS.md', 'agent-ready.json'],
          diff: candidate.twin.diff || ''
        };

        const saved = saveApplicationSnapshot(repoPath, snapshot);
        lastAppliedSnapshot = snapshot;
        candidate = undefined;

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          ok: true,
          backupDir,
          certificatePath: saved.htmlPath,
          certificateUrl: '/certificate.html',
          snapshot
        }));
      } catch (err: any) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: err.message }));
      }
      return;
    }

    // Serve Certificate HTML snapshot
    if (url.pathname === '/certificate.html' || url.pathname === '/api/twin/certificate.html') {
      const certPath = path.join(repoPath, '.repotwin', 'reports', 'repotwin-certificate-latest.html');
      if (fs.existsSync(certPath)) {
        res.setHeader('Content-Security-Policy', "default-src 'self' 'unsafe-inline' https: data:;");
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(fs.readFileSync(certPath, 'utf-8'));
        return;
      }
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Aucun certificat généré pour le moment.');
      return;
    }

    // Serve Certificate JSON snapshot
    if (url.pathname === '/certificate.json' || url.pathname === '/api/twin/certificate.json') {
      const certJson = path.join(repoPath, '.repotwin', 'reports', 'repotwin-certificate-latest.json');
      if (fs.existsSync(certJson)) {
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(fs.readFileSync(certJson, 'utf-8'));
        return;
      }
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'Aucun certificat trouvé' }));
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

    if (url.pathname.startsWith('/assets/')) {
      if (!serveStudioAsset(url.pathname, res)) {
        res.writeHead(404); res.end('Asset not found');
      }
      return;
    }

    // Serve the compiled React + shadcn Studio.
    if (url.pathname === '/' || url.pathname === '/index.html') {
      const html = fs.readFileSync(resolveStudioAsset('index.html'), 'utf8');
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
    console.log(`📁 Dépôt analysé : \x1b[1m${path.basename(repoPath)}\x1b[0m (${repoPath})`);
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

interface StudioState {
  step: 'idle' | 'created' | 'failed' | 'verified' | 'applied';
  port: number;
  twinPath: string;
  validationPlan: ValidationCommand[];
  scriptBodies: Record<string, string>;
  consentToken: string;
  commandResults: ValidationResult[];
  diff: string;
  verification?: {
    score: number;
    grade: string;
    resolved: number;
    introduced: number;
    passed: boolean;
    durationMs: number;
    resolvedList?: Array<{ message: string; classification?: string }>;
  };
  appliedSnapshot?: ApplicationSnapshot;
}

const serverModuleDirectory = path.dirname(fileURLToPath(import.meta.url));

function resolveStudioAsset(relativePath: string): string {
  const candidates = [
    path.resolve(serverModuleDirectory, '..', 'studio', relativePath),
    path.resolve(serverModuleDirectory, '..', '..', 'dist', 'studio', relativePath)
  ];
  const existing = candidates.find(candidatePath => fs.existsSync(candidatePath));
  if (!existing) throw new Error('RepoTwin Studio assets are missing. Run npm run build:studio.');
  return existing;
}

function serveStudioAsset(pathname: string, res: http.ServerResponse): boolean {
  if (!/^\/assets\/[A-Za-z0-9._-]+$/.test(pathname)) return false;
  let assetPath: string;
  try { assetPath = resolveStudioAsset(pathname.slice(1)); } catch { return false; }
  const extension = path.extname(assetPath);
  const contentType = extension === '.js' ? 'text/javascript; charset=utf-8'
    : extension === '.css' ? 'text/css; charset=utf-8'
      : extension === '.map' ? 'application/json; charset=utf-8'
        : 'application/octet-stream';
  res.writeHead(200, { 'Content-Type': contentType, 'Cache-Control': 'no-store' });
  fs.createReadStream(assetPath).pipe(res);
  return true;
}

function buildStudioPayload(input: ReturnType<typeof analyzeRepository>, sessionToken: string, state: StudioState) {
  const gitValue = (args: string[], fallback: string) => {
    try { return execFileSync('git', ['-C', input.repoPath, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 128 * 1024 * 1024 }).trim() || fallback; } catch { return fallback; }
  };
  const currentAgentsPath = path.join(input.repoPath, 'AGENTS.md');
  const currentAgents = fs.existsSync(currentAgentsPath) ? fs.readFileSync(currentAgentsPath, 'utf8') : '';
  const estimatedTokens = (content: string) => Math.ceil(content.length / 4);
  return {
    sessionToken,
    repo: {
      name: path.basename(input.repoPath),
      path: input.repoPath,
      branch: gitValue(['rev-parse', '--abbrev-ref', 'HEAD'], 'hors Git'),
      commit: gitValue(['rev-parse', '--short', 'HEAD'], '-'),
      port: state.port,
      analyzedAt: new Date().toLocaleTimeString('fr-FR')
    },
    analysis: {
      ...input,
      metrics: {
        currentInstructionTokens: currentAgents ? estimatedTokens(currentAgents) : 0,
        proposedInstructionTokens: estimatedTokens(input.recipe.agentsMdContent)
      }
    },
    state
  };
}

function renderInteractiveStudio(input: ReturnType<typeof analyzeRepository>, token: string, state: StudioState): string {
  // JSON embedded in a <script>: escape '<' so no value can close the tag.
  const initialState = JSON.stringify(state).replace(/</g, '\\u003c');
  const gitValue = (args: string[], fallback: string) => {
    try { return execFileSync('git', ['-C', input.repoPath, ...args], { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 128 * 1024 * 1024 }).trim() || fallback; } catch { return fallback; }
  };
  const repoInfo = {
    branch: gitValue(['rev-parse', '--abbrev-ref', 'HEAD'], 'hors Git'),
    commit: gitValue(['rev-parse', '--short', 'HEAD'], '-'),
    port: state.port,
    analyzedAt: new Date().toLocaleTimeString('fr-FR')
  };
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
  <title>${repoName} · RepoTwin Studio</title>
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
    ${workflowStyles}
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
          <div class="flex items-center gap-2 flex-wrap">
            <h1 class="text-xl font-semibold text-zinc-100 tracking-tight" id="repoName">${repoName}</h1>
            <span class="text-[11px] font-mono px-2 py-0.5 rounded-full bg-zinc-800 text-zinc-300 border border-zinc-700" title="Branche et commit analysés">${escapeHtml(repoInfo.branch)} @ ${escapeHtml(repoInfo.commit)}</span>
            <span class="text-[11px] font-mono px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-medium" title="Port du serveur Studio">:${repoInfo.port}</span>
          </div>
          <p class="text-xs text-zinc-400 mt-0.5">RepoTwin Studio · analysé à ${repoInfo.analyzedAt} (rechargez la page pour réanalyser)</p>
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
          <span>Appliquer les fichiers</span>
          <span id="applyBadge" class="text-[10px] bg-zinc-950 text-zinc-500 px-1.5 py-0.5 rounded border border-zinc-800 font-mono">Twin requis</span>
        </button>
        <details id="sessionMenu"><summary>Session</summary><div>
        <button id="cleanTwinBtn" onclick="cleanTwins()" class="px-3 py-2 rounded-lg text-xs font-medium bg-zinc-900/80 hover:bg-zinc-800 text-zinc-300 border border-zinc-800 transition-all flex items-center gap-1.5 active:scale-[0.98]">
          <span>🧹</span> Nettoyer
        </button>
        </div></details>
      </div>
    </header>

    ${workflowShell}

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
    </div>

    <!-- Bilan Tokens & Optimisation Contexte IA (Métrique Reine) -->
    <details id="tokensPanel" class="border-t border-zinc-800 py-4">
      <summary class="cursor-pointer text-xs text-zinc-400">Taille estimée des instructions</summary>
      <section class="pt-4">
      <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <div class="flex items-center gap-2">
            <span class="text-base">🪙</span>
            <h2 class="text-xs font-bold uppercase tracking-wider text-indigo-300">
              Taille de AGENTS.md
            </h2>
            <span class="px-2 py-0.5 text-[10px] rounded-full bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 font-mono font-medium">
              Estimation caractères ÷ 4
            </span>
          </div>
          <p class="text-xs text-zinc-300 mt-1">
            Taille du fichier actuel et de la proposition. Consommation réelle et gain de qualité non mesurés.
          </p>
        </div>

        <div class="flex flex-wrap items-center gap-3">
          <!-- Token count badge -->
          <div class="bg-zinc-950/80 px-4 py-2.5 rounded-lg border border-indigo-500/30 text-left">
            <div class="text-[10px] uppercase font-mono text-zinc-400">Taille AGENTS.md</div>
            <div class="text-sm font-bold text-indigo-300 font-mono mt-0.5">
              ~${currentTokens} → ~${proposedTokens} <span class="text-xs text-zinc-400 font-normal">tokens estimés</span>
            </div>
            <div class="text-[10px] font-mono mt-0.5 ${tokenDelta <= 0 ? 'text-emerald-400 font-medium' : 'text-zinc-400'}">
              ${tokenDelta <= 0 ? 'Réduction estimée du fichier : ' + Math.abs(tokenDelta) + ' tokens' : '+' + tokenDelta + ' tokens estimés dans le fichier proposé'}
            </div>
          </div>

          <!-- Noise eliminated badge -->
          <div class="bg-zinc-950/80 px-4 py-2.5 rounded-lg border border-emerald-500/30 text-left">
            <div class="text-[10px] uppercase font-mono text-zinc-400">Références reclassées</div>
            <div class="text-sm font-bold text-emerald-400 font-mono mt-0.5">
              ${data.falsePositives.length} constat(s) reclassé(s)
            </div>
            <div class="text-[10px] text-zinc-400 font-mono mt-0.5">
              Reclassification heuristique du rapport importé.
            </div>
          </div>
        </div>
      </div>
      </section>
    </details>

    <!-- Scores Comparison Hero (Shadcn Card Grid) -->
    <section id="scoresPanel" class="grid grid-cols-1 md:grid-cols-3 gap-4">
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
        <p class="text-xs text-zinc-400 mt-4 leading-relaxed">${data.instructionAudit.findings.length} constat(s) · ${data.instructionAudit.consistency.files.length} fichier(s) d’instructions inspecté(s).</p>
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

    <!-- Real-time Verification & 9-Points Execution Tracker (Elevated right under Scores Hero) -->
    <section id="verificationProgressSection" class="hidden bg-zinc-900/60 border border-zinc-800 rounded-xl p-6 shadow-xl backdrop-blur transition-all duration-300">
      <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-4 border-b border-zinc-800">
        <div class="flex items-center gap-3">
          <div id="progressSpinner" class="w-10 h-10 rounded-full border-2 border-emerald-500/20 border-t-emerald-400 flex items-center justify-center shrink-0 bg-zinc-950">
            <span id="progressSpinnerIcon" class="text-sm">🛡️</span>
          </div>
          <div>
            <div class="flex items-center gap-2 flex-wrap">
              <h2 class="text-sm font-semibold text-zinc-100 flex items-center gap-2">
                Suivi de Vérification & Exécution du Twin
              </h2>
              <span id="progressPill" class="text-[10px] px-2.5 py-0.5 rounded-full border font-mono font-medium transition-all bg-zinc-800 text-zinc-300 border-zinc-700">
                En attente
              </span>
            </div>
            <p id="progressSubtitle" class="text-xs text-zinc-400 mt-0.5">Prêt pour la validation des points de contrôle.</p>
          </div>
        </div>
        <div class="flex items-center gap-3 text-xs">
          <div class="flex items-center gap-1.5 bg-zinc-950 px-3 py-1.5 rounded-lg border border-zinc-800 text-zinc-300 font-mono">
            <span class="text-zinc-500">Temps :</span>
            <span id="progressTimer" class="text-emerald-400 font-semibold">0.0s</span>
          </div>
          <div class="flex items-center gap-1.5 bg-zinc-950 px-3 py-1.5 rounded-lg border border-zinc-800 text-zinc-300 font-mono">
            <span class="text-zinc-500">Progression :</span>
            <span id="progressFraction" class="text-emerald-400 font-semibold">0 / 0</span>
          </div>
        </div>
      </div>

      <!-- Real-time Progress Bar with Percentage and Current Step Description -->
      <div class="mt-4">
        <div class="flex items-center justify-between text-xs mb-1.5">
          <span id="progressBarLabel" class="text-[11px] text-zinc-300 font-mono truncate mr-2">En attente de confirmation...</span>
          <span id="progressBarPercent" class="text-[11px] font-bold text-emerald-400 font-mono">0%</span>
        </div>
        <div class="w-full bg-zinc-950 rounded-full h-2.5 overflow-hidden border border-zinc-800/90 shadow-inner">
          <div id="progressBarFill" class="bg-gradient-to-r from-emerald-500 via-teal-400 to-cyan-400 h-2.5 rounded-full transition-all duration-300 shadow-sm" style="width: 0%"></div>
        </div>
      </div>

      <!-- Expressive Checklist of Points -->
      <div class="mt-5">
        <div class="flex items-center justify-between mb-3">
          <h3 class="text-xs font-semibold text-zinc-300 uppercase tracking-wider flex items-center gap-2">
            <span>📋</span> Points de Contrôle & Validations (<span id="progressTotalCount">0</span>)
          </h3>
          <span id="validationPlanBadge" class="text-[10px] px-2 py-0.5 rounded border border-amber-500/20 bg-amber-500/10 text-amber-300 font-mono">Consentement requis</span>
        </div>
        <div id="progressItemsList" class="space-y-2"></div>
      </div>

      <!-- Final Verification Summary Banner (shown on completion) -->
      <div id="verificationSummaryBanner" class="hidden mt-5 p-4 rounded-xl border border-emerald-500/30 bg-emerald-950/20 text-xs">
        <div class="flex items-start gap-3">
          <span id="summaryBannerIcon" class="text-lg">🎉</span>
          <div class="flex-1">
            <h4 id="summaryBannerTitle" class="font-semibold text-emerald-300 text-sm">Vérification réussie avec succès</h4>
            <p id="summaryBannerDesc" class="text-zinc-300 mt-1 leading-relaxed"></p>
            <div id="summaryBannerStats" class="mt-3 flex flex-wrap gap-2 text-[11px] font-mono"></div>
            <div id="summaryBannerActions" class="mt-3 flex flex-wrap gap-2"></div>
          </div>
        </div>
      </div>

      <!-- Detailed Raw Verification JSON (collapsible) -->
      <details id="verificationDetailsDetails" class="hidden mt-4 border-t border-zinc-800/80 pt-3">
        <summary class="cursor-pointer text-xs text-zinc-400 hover:text-zinc-200 select-none flex items-center gap-1 font-mono">
          <span>⚙️ Voir les diagnostics bruts de vérification (JSON)</span>
        </summary>
        <pre id="verificationDetails" class="text-xs text-zinc-300 whitespace-pre-wrap overflow-x-auto mt-2 p-3 bg-zinc-950 rounded-lg border border-zinc-800 font-mono"></pre>
      </details>

      <p class="text-[11px] text-zinc-500 mt-4 border-t border-zinc-800/60 pt-3">
        Exécution locale dans le twin, sans shell, avec environnement réduit, sortie limitée et délai maximal. Si un lockfile est présent, une installation reproductible (npm ci…) est d'abord lancée pour garantir la fiabilité des tests.
      </p>
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

    <section id="issuesPanel" class="border-b border-zinc-800 py-5">
      <h2 class="text-sm font-semibold text-zinc-200 mb-3">Points à examiner</h2>
      <ul class="text-xs text-zinc-300 space-y-2">
        ${data.instructionAudit.findings.length ? data.instructionAudit.findings.map(finding => `<li><code>${escapeHtml(finding.file)}${finding.line ? ':' + finding.line : ''}</code> : ${escapeHtml(finding.message)}${finding.fix ? `<p class="text-zinc-400 mt-1">${escapeHtml(finding.fix)}</p>` : ''}</li>`).join('') : '<li>Aucun constat sur les contrôles documentaires couverts.</li>'}
      </ul>
      <details class="mt-4 text-xs text-zinc-300">
        <summary class="cursor-pointer">Instructions par assistant</summary>
        <ul class="mt-3 space-y-2">${data.instructionAudit.consistency.files.map(file => `<li><code>${escapeHtml(file.file)}</code> · ${escapeHtml(file.assistant)} · ${file.bytes} octets · ${escapeHtml(file.scope)}</li>`).join('') || '<li>Aucun fichier reconnu.</li>'}</ul>
        ${data.instructionAudit.consistency.notices.map(notice => `<p class="mt-2 text-amber-300">${escapeHtml(notice)}</p>`).join('')}
      </details>
    </section>

    <!-- Static repository observations -->
    <details id="observationsPanel" class="border-t border-zinc-800 py-4">
      <summary class="cursor-pointer text-xs text-zinc-400">Observations complémentaires</summary>
      <section class="py-4">
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
          <div class="text-zinc-400 font-medium text-[11px]">Taille estimée de AGENTS.md</div>
          <div class="text-2xl font-bold text-indigo-400 mt-1">~${currentTokens} → ~${proposedTokens} tokens</div>
          <div class="text-[11px] text-zinc-400 mt-1">Estimation caractères ÷ 4. Consommation réelle non mesurée.</div>
        </div>
        <div class="p-4 bg-zinc-950/70 border border-zinc-800/80 rounded-lg">
          <div class="text-zinc-400 font-medium text-[11px]">Projets avec validation déclarée</div>
          <div class="text-2xl font-bold text-purple-400 mt-1">${data.subprojects.filter((s: any) => s.testScript || s.lintScript || s.buildScript).length} / ${data.subprojects.length} projets</div>
          <div class="text-[11px] text-zinc-400 mt-1">Tests, lint et builds détectés dans les manifests. Aucun lancement automatique.</div>
        </div>
      </div>
      </section>
    </details>

    <!-- Subprojects Section -->
    <section id="projectsPanel" class="py-5">
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
    <section id="falsePositivesPanel" class="py-5">
      <h2 class="text-xs font-semibold text-zinc-300 mb-4 flex items-center gap-2 uppercase tracking-wider">
        <span>🛡️</span> Faux Positifs Éliminés (${data.falsePositives.length})
      </h2>
      <div class="grid grid-cols-1 md:grid-cols-2 gap-2.5 max-h-80 overflow-y-auto pr-1">
        ${fpCards}
      </div>
    </section>

    <!-- Proposed AGENTS.md Preview -->
    <section id="proposalPanel" class="py-5">
      <div class="flex items-center justify-between mb-4">
        <h2 class="text-xs font-semibold text-zinc-300 flex items-center gap-2 uppercase tracking-wider">
          Proposition pour AGENTS.md
        </h2>
        <span class="text-xs text-zinc-400">Consultez le diff puis vérifiez le candidat.</span>
      </div>
      <div class="bg-zinc-950 rounded-lg p-4 border border-zinc-800/80">
        <pre class="text-xs text-zinc-300 font-mono overflow-x-auto max-h-72"><code>${escapeHtml(data.recipe.agentsMdContent)}</code></pre>
      </div>
    </section>

    <!-- Outil secondaire : Comparaison de deux versions Git (A/B Benchmark) -->
    <div id="comparisonTool">
        ${comparisonPanel}
    </div>

  </div>

  <script nonce="${token}">
    const sessionToken = '${token}';
    let candidateValidationPlan = [];
    let candidateScriptBodies = {};
    let candidateConsentToken = '';
    let candidateCommandResults = [];
    let currentStep = 'idle';

    // Guided flow: only the next valid action is enabled.
    const BTN_BASE = 'px-3.5 py-2 rounded-lg text-xs font-medium transition-all flex items-center gap-2 border ';
    const BTN_STYLE = {
      next: BTN_BASE + 'bg-zinc-100 hover:bg-zinc-200 text-zinc-900 border-zinc-100 shadow-sm active:scale-[0.98] ring-2 ring-emerald-500/40',
      done: BTN_BASE + 'bg-zinc-900 text-emerald-400 border-emerald-500/30 cursor-default',
      locked: BTN_BASE + 'bg-zinc-900 text-zinc-500 border-zinc-800 cursor-not-allowed'
    };
    const STEP_LAYOUT = {
      idle: ['next', 'locked', 'locked'],
      created: ['done', 'next', 'locked'],
      failed: ['done', 'next', 'locked'],
      verified: ['done', 'done', 'next'],
      applied: ['done', 'done', 'done']
    };
    const APPLY_BADGE = {
      idle: 'Twin requis', created: 'Vérification requise', failed: 'Vérification échouée',
      verified: 'Prêt à appliquer', applied: 'Appliqué'
    };

    function setStep(step, operation) {
      const buttons = [document.getElementById('createTwinBtn'), document.getElementById('verifyBtn'), document.getElementById('applyBtn')];
      if (step === 'busy') {
        buttons.forEach(button => { button.disabled = true; });
        updateWorkflow('busy', operation);
        return;
      }
      currentStep = step;
      const layout = STEP_LAYOUT[step];
      buttons.forEach((button, index) => {
        button.className = BTN_STYLE[layout[index]];
        if (index === 1 && (step === 'created' || step === 'verified' || step === 'failed')) {
          button.disabled = false;
        } else {
          button.disabled = layout[index] !== 'next';
        }
      });
      const count = candidateValidationPlan.length;
      buttons[0].textContent = layout[0] === 'done' ? '✓ 1. Twin créé' : '🧬 1. Créer Twin (Worktree)';
      buttons[0].title = layout[0] === 'done' ? 'Un candidat existe déjà. Cliquez sur Nettoyer pour recommencer.' : '';
      const verifyLabel = count ? 'Autoriser & vérifier (' + count + ')' : 'Vérifier les instructions';
      buttons[1].textContent = (step === 'verified' || layout[1] === 'done') ? '↻ 2. Revérifier' : (step === 'failed' ? '↻ 2. Revérifier' : '2. ' + verifyLabel);
      buttons[1].title = step === 'idle' ? "Créez d'abord un Twin" : '';
      buttons[2].title = step === 'verified' ? 'Appliquer le candidat vérifié' : step === 'applied' ? 'Déjà appliqué' : 'Disponible après une vérification réussie';
      document.getElementById('applyBadge').innerText = APPLY_BADGE[step];
      updateWorkflow(step);
    }
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

    function clientEscapeHtml(str) {
      if (typeof str !== 'string') return '';
      return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
    }

    let failedDetails = {};

    function safeCopyToClipboard(text, msg, icon = '📋') {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(() => {
          showToast(msg, icon);
        }).catch(() => fallbackCopy(text, msg, icon));
      } else {
        fallbackCopy(text, msg, icon);
      }
    }

    function fallbackCopy(text, msg, icon) {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      try {
        document.execCommand('copy');
        showToast(msg, icon);
      } catch (err) {
        showToast('Erreur lors de la copie', '❌');
      } finally {
        document.body.removeChild(textarea);
      }
    }

    function getLastLines(str, maxLines = 15) {
      if (!str) return 'Aucune sortie console capturée.';
      const lines = str.trim().split(String.fromCharCode(10));
      return lines.slice(-maxLines).join(String.fromCharCode(10));
    }

    function getFailureDiagnostic(item, state) {
      return {
        reason: state.status === 'unavailable' ? 'Commande indisponible ou ignorée. Consultez sa sortie.' : state.status === 'timed-out' ? 'Délai maximal atteint avant la fin de la commande.' : 'Commande terminée avec le code de sortie ' + state.exitCode + '.',
        bypass: 'Origine à établir. Ce contrôle n’a pas été exécuté sur la référence dans ce parcours.'
      };
    }

    function buildItemPrompt(item, state) {
      const nl = String.fromCharCode(10);
      const fence = String.fromCharCode(96, 96, 96);
      let p = 'Agis en développeur senior pour corriger cette erreur dans le sous-projet "' + item.project + '" :' + nl + nl;
      p += '- Sous-projet : ' + item.project + ' (chemin : ' + item.relPath + ')' + nl;
      p += '- Type de contrôle : ' + item.kind + nl;
      p += '- Commande : ' + item.display + nl;
      p += '- Code de sortie : ' + (state.exitCode || 1) + nl + nl;
      p += "Extrait des logs console de l'échec :" + nl;
      p += fence + 'console' + nl;
      p += getLastLines(state.output, 20) + nl;
      p += fence + nl + nl;
      p += "Merci d'analyser la cause exacte, d'expliquer le problème et de fournir le correctif minimal pour que cette commande réussisse dans le sous-projet.";
      return p;
    }

    function copyItemAiPrompt(id) {
      const data = failedDetails[id];
      if (!data) return;
      const prompt = buildItemPrompt(data.item, data.state);
      safeCopyToClipboard(prompt, 'Prompt de réparation copié pour "' + data.item.project + '" !', '🤖');
    }

    function copyAllFailuresReport() {
      const ids = Object.keys(failedDetails);
      if (!ids.length) return;
      const nl = String.fromCharCode(10);
      const fence = String.fromCharCode(96, 96, 96);
      const tick = String.fromCharCode(96);
      let r = '# Rapport de santé RepoTwin — Commandes défaillantes' + nl + nl;
      r += "Voici la liste des " + ids.length + " commande(s) qui échouent actuellement dans le dépôt. Merci d'analyser chaque cas et de proposer les correctifs correspondants :" + nl + nl;
      ids.forEach((id, idx) => {
        const { item, state } = failedDetails[id];
        r += '## ' + (idx + 1) + '. [' + item.project + '] ' + tick + item.display + tick + nl;
        r += '- **Chemin** : ' + tick + item.relPath + tick + ' (' + item.kind + ')' + nl;
        r += '- **Code de retour** : ' + tick + (state.exitCode || 1) + tick + nl;
        r += '- **Reproduction locale** : ' + tick + 'cd ' + item.relPath + ' && ' + item.display + tick + nl + nl;
        r += fence + 'console' + nl;
        r += getLastLines(state.output, 15) + nl;
        r += fence + nl + nl;
      });
      safeCopyToClipboard(r, "Rapport complet des " + ids.length + " échec(s) copié pour l'IA !", '📄');
    }

    function renderProgressItems(plan, states = {}) {
      const list = document.getElementById('progressItemsList');
      if (!list) return;
      list.replaceChildren();
      failedDetails = {};
      const count = plan.length;
      document.getElementById('progressTotalCount').innerText = count;

      if (!count) {
        const empty = document.createElement('div');
        empty.className = 'rounded-lg border border-zinc-800 bg-zinc-950/60 p-4 text-xs text-zinc-400';
        empty.innerHTML = '<span>ℹ️ Aucune commande applicative détectée. La phase portera sur le contrôle documentaire, la sécurité, et l&#039;intégrité des instructions du Twin.</span>';
        list.appendChild(empty);
        document.getElementById('validationPlanBadge').innerText = 'Contrôle documentaire';
        document.getElementById('progressFraction').innerText = '0 / 1';
        return;
      }

      const kindPills = {
        install: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
        test: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
        lint: 'bg-purple-500/10 text-purple-400 border-purple-500/20',
        build: 'bg-amber-500/10 text-amber-400 border-amber-500/20'
      };

      plan.forEach((item, index) => {
        const state = states[item.id] || { status: 'pending' };
        let borderClass = 'border-zinc-800/80 bg-zinc-950/40';
        let iconHtml = '<span class="text-zinc-500 font-mono text-[11px]">' + (index + 1) + '</span>';
        let iconBg = 'bg-zinc-900 border-zinc-800';
        let statusBadge = '<span class="text-[10px] px-2 py-0.5 rounded border border-zinc-800 bg-zinc-900 text-zinc-400 font-mono">En attente</span>';

        if (state.status === 'running') {
          borderClass = 'border-cyan-500/50 bg-cyan-950/20 ring-1 ring-cyan-500/40 shadow-sm shadow-cyan-500/10';
          iconHtml = '<span class="inline-block animate-spin text-xs text-cyan-400 font-bold">⟳</span>';
          iconBg = 'bg-cyan-950 border-cyan-500/40';
          statusBadge = '<span class="text-[10px] px-2 py-0.5 rounded border border-cyan-500/40 bg-cyan-500/10 text-cyan-300 font-mono flex items-center gap-1.5"><span class="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-ping"></span>En cours</span>';
        } else if (state.status === 'passed') {
          borderClass = 'border-emerald-500/30 bg-emerald-950/10';
          iconHtml = '<span class="text-emerald-400 font-bold text-xs">✓</span>';
          iconBg = 'bg-emerald-950/40 border-emerald-500/40';
          statusBadge = '<span class="text-[10px] px-2 py-0.5 rounded border border-emerald-500/30 bg-emerald-500/10 text-emerald-400 font-mono font-medium">✓ Validé · ' + (state.durationMs || 0) + ' ms</span>';
        } else if (state.status === 'failed' || state.status === 'timed-out') {
          borderClass = 'border-rose-500/40 bg-rose-950/20';
          iconHtml = '<span class="text-rose-400 font-bold text-xs">×</span>';
          iconBg = 'bg-rose-950/40 border-rose-500/40';
          statusBadge = '<span class="text-[10px] px-2 py-0.5 rounded border border-rose-500/30 bg-rose-500/10 text-rose-400 font-mono font-medium">× ' + (state.status === 'timed-out' ? 'Timeout' : 'Échec (' + state.exitCode + ')') + ' · ' + (state.durationMs || 0) + ' ms</span>';
        } else if (state.status === 'unavailable') {
          borderClass = 'border-amber-500/30 bg-amber-950/10';
          iconHtml = '<span class="text-amber-400 text-xs">⊘</span>';
          iconBg = 'bg-amber-950/40 border-amber-500/40';
          statusBadge = '<span class="text-[10px] px-2 py-0.5 rounded border border-amber-500/30 bg-amber-500/10 text-amber-400 font-mono">Ignoré</span>';
        }

        const kindClass = kindPills[item.kind] || 'bg-zinc-800 text-zinc-400 border-zinc-700';
        const row = document.createElement('div');
        row.className = 'rounded-lg border ' + borderClass + ' p-3 transition-all duration-200 flex flex-col gap-2';

        const scriptBody = candidateScriptBodies[item.id] ? '  →  ' + candidateScriptBodies[item.id] : '';

        let inner = '<div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">';
        inner += '<div class="flex items-center gap-2.5 flex-wrap">';
        inner += '<span class="w-6 h-6 rounded-full border text-xs flex items-center justify-center font-mono shrink-0 ' + iconBg + '">' + iconHtml + '</span>';
        inner += '<span class="font-mono text-xs font-semibold text-zinc-200">' + clientEscapeHtml(item.project) + '</span>';
        inner += '<span class="text-[10px] uppercase font-mono px-1.5 py-0.5 rounded border ' + kindClass + '">' + clientEscapeHtml(item.kind) + '</span>';
        inner += '<span class="text-xs text-zinc-400 font-mono">' + clientEscapeHtml(item.relPath) + '</span>';
        inner += '</div>';
        inner += '<div class="flex items-center gap-2.5 flex-wrap">';
        inner += '<code class="text-xs text-amber-300 font-mono bg-zinc-950 px-2 py-1 rounded border border-zinc-800/80">' + clientEscapeHtml(item.display + scriptBody) + '</code>';
        inner += statusBadge;
        inner += '</div></div>';

        if (state.output) {
          inner += '<details class="mt-1 border-t border-zinc-800/80 pt-2">';
          inner += '<summary class="cursor-pointer text-[11px] text-zinc-400 hover:text-zinc-200 select-none flex items-center gap-1.5 font-mono">';
          inner += '<span>Voir la sortie console' + (state.outputTruncated ? ' · sortie tronquée' : '') + '</span>';
          inner += '</summary>';
          inner += '<pre class="mt-2 p-3 rounded-lg bg-zinc-950 text-[11px] text-zinc-300 font-mono whitespace-pre-wrap overflow-x-auto max-h-52 border border-zinc-800 shadow-inner">' + clientEscapeHtml(state.output) + '</pre>';
          inner += '</details>';
        }

        if (state.status === 'failed' || state.status === 'timed-out') {
          failedDetails[item.id] = { item, state };
          const diag = getFailureDiagnostic(item, state);
          inner += '<div class="mt-2 p-3 rounded-lg border border-rose-500/30 bg-zinc-950/80 flex flex-col gap-2.5">';
          inner += '<div class="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">';
          inner += '<div class="text-[11px] text-zinc-300 font-sans leading-relaxed space-y-1">';
          inner += '<div><span class="font-semibold text-rose-400">🩺 Diagnostic : </span>' + clientEscapeHtml(diag.reason) + '</div>';
          inner += '<div><span class="font-semibold text-zinc-400">Comparaison à la référence : </span>' + clientEscapeHtml(diag.bypass) + '</div>';
          inner += '<div class="text-zinc-400 font-mono text-[10px] pt-0.5"><span class="text-zinc-500">💻 Test manuel : </span><code class="text-amber-300 bg-zinc-900 px-1.5 py-0.5 rounded border border-zinc-800">cd ' + clientEscapeHtml(item.relPath) + ' &amp;&amp; ' + clientEscapeHtml(item.display) + '</code></div>';
          inner += '</div>';
          inner += '<div class="flex items-center gap-2 flex-wrap shrink-0">';
          inner += '<button type="button" data-prompt-id="' + clientEscapeHtml(item.id) + '" class="ai-prompt-btn px-3 py-1.5 rounded-lg text-xs font-medium bg-indigo-600 hover:bg-indigo-500 text-white flex items-center gap-1.5 shadow-sm active:scale-[0.98] transition-all">';
          inner += '<span>📋</span> Copier le prompt';
          inner += '</button>';
          inner += '<button type="button" data-retest-id="' + clientEscapeHtml(item.id) + '" class="retest-btn px-3 py-1.5 rounded-lg text-xs font-medium bg-zinc-900 hover:bg-zinc-800 text-cyan-300 border border-cyan-500/40 flex items-center gap-1.5 shadow-sm active:scale-[0.98] transition-all">';
          inner += '<span>↻</span> Re-tester ce point';
          inner += '</button>';
          inner += '</div>';
          inner += '</div>';
          inner += '</div>';
        }

        row.innerHTML = inner;
        list.appendChild(row);
      });

      list.querySelectorAll('.ai-prompt-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          const id = btn.getAttribute('data-prompt-id');
          if (id) copyItemAiPrompt(id);
        });
      });

      list.querySelectorAll('.retest-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const id = btn.getAttribute('data-retest-id');
          if (id) retestItem(id);
        });
      });
    }

    async function createTwin() {
      if (currentStep !== 'idle') return;
      setStep('busy', 'create');
      document.getElementById('targetScoreDisplay').innerText = 'Non vérifié';
      document.getElementById('targetGrade').innerText = '-';
      document.getElementById('verificationStatus').innerText = 'Vérification requise. Aucune commande exécutée.';
      document.getElementById('verificationProgressSection').classList.add('hidden');
      document.getElementById('verificationSummaryBanner').classList.add('hidden');
      document.getElementById('verificationDetailsDetails').classList.add('hidden');
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
          candidateCommandResults = [];
          const warnings = data.result.submoduleWarnings || [];
          const initialized = data.result.submodulesInitialized || [];
          document.getElementById('twinVerifiedBadge').innerText = 'Candidat créé depuis HEAD. Aucune commande exécutée.'
            + (initialized.length ? ' Submodules copiés localement : ' + initialized.join(', ') + '.' : '')
            + (warnings.length ? ' ⚠️ Submodules manquants (leurs commandes échoueront) : ' + warnings.join(' ; ') : '');

          if (data.result.diff) {
            document.getElementById('diffSection').classList.remove('hidden');
            document.getElementById('diffContent').innerText = data.result.diff;
            document.getElementById('applicationDiffContent').textContent = data.result.diff;
          }

          document.getElementById('progressBarFill').style.width = '0%';
          document.getElementById('progressBarPercent').innerText = '0%';
          document.getElementById('progressBarLabel').innerText = 'Prêt pour vérification (' + candidateValidationPlan.length + ' points)';
          document.getElementById('progressFraction').innerText = '0 / ' + candidateValidationPlan.length;
          document.getElementById('progressPill').innerText = candidateValidationPlan.length ? 'Prêt (' + candidateValidationPlan.length + ' points)' : 'Prêt';
          document.getElementById('progressPill').className = 'text-[10px] px-2.5 py-0.5 rounded-full border font-mono font-medium bg-zinc-800 text-zinc-300 border-zinc-700';
          document.getElementById('progressTimer').innerText = '0.0s';
          renderProgressItems(candidateValidationPlan);
          const progressSec = document.getElementById('verificationProgressSection');
          progressSec.classList.remove('hidden');
          setStep('created');
          showWorkflowStage('verification', true);
        } else {
          showToast('Erreur: ' + data.error, '❌');
          setStep('idle');
        }
      } catch (err) {
        showToast('Erreur réseau', '❌');
        setStep('idle');
      }
    }

    async function verifyTwin(opts = {}) {
      if (workflowBusy) return;
      if (currentStep !== 'created' && currentStep !== 'failed' && currentStep !== 'verified') return;
      if (candidateValidationPlan.length && !opts.id && !opts.onlyFailed && currentStep === 'created') {
        const nl = String.fromCharCode(10);
        const commands = candidateValidationPlan.map(item => item.relPath + ': ' + item.display + (candidateScriptBodies[item.id] ? '  →  ' + candidateScriptBodies[item.id] : '')).join(nl);
        const accepted = confirm('RepoTwin va exécuter ces commandes dans la copie isolée :' + nl + nl + commands + nl + nl + 'Elles peuvent exécuter du code du projet et accéder au réseau. Continuer ?');
        if (!accepted) return;
      }
      const previousStep = currentStep;
      showWorkflowStage('verification', true);
      setStep('busy', 'verify');

      let queryParams = '?stream=true';
      if (opts.id) {
        queryParams += '&id=' + encodeURIComponent(opts.id);
      } else if (opts.onlyFailed) {
        queryParams += '&onlyFailed=true';
      }

      document.getElementById('targetScoreDisplay').innerText = 'Vérification...';
      const progressSec = document.getElementById('verificationProgressSection');
      progressSec.classList.remove('hidden');
      document.getElementById('verificationSummaryBanner').classList.add('hidden');

      const startTime = Date.now();
      const timerEl = document.getElementById('progressTimer');
      const timerInterval = setInterval(() => {
        if (timerEl) timerEl.innerText = ((Date.now() - startTime) / 1000).toFixed(1) + 's';
      }, 100);

      document.getElementById('progressBarFill').style.width = '0%';
      document.getElementById('progressBarPercent').innerText = '0%';
      document.getElementById('progressBarFill').className = 'bg-gradient-to-r from-emerald-500 via-teal-400 to-cyan-400 h-2.5 rounded-full transition-all duration-300 shadow-sm';
      document.getElementById('progressBarLabel').innerText = opts.id ? 'Re-test ciblé du point...' : (opts.onlyFailed ? 'Relance des points en échec...' : 'Initialisation de la vérification...');
      document.getElementById('progressPill').innerText = 'Exécution en cours...';
      document.getElementById('progressPill').className = 'text-[10px] px-2.5 py-0.5 rounded-full border font-mono font-medium bg-cyan-500/10 text-cyan-300 border-cyan-500/30';
      document.getElementById('progressSpinner').className = 'w-10 h-10 rounded-full border-2 border-cyan-500/20 border-t-cyan-400 animate-spin flex items-center justify-center shrink-0 bg-zinc-950';
      document.getElementById('progressSpinnerIcon').innerText = '⚡';

      const itemStates = Object.fromEntries(candidateCommandResults.map(result => [result.id, result]));
      if (opts.id) {
        itemStates[opts.id] = { status: 'running' };
        renderProgressItems(candidateValidationPlan, itemStates);
      }

      try {
        const response = await fetch('/api/twin/verify' + queryParams, {
          method: 'POST',
          headers: {
            'X-RepoTwin-Token': sessionToken,
            'X-RepoTwin-Command-Consent': candidateConsentToken,
            'X-RepoTwin-Stream': 'true'
          }
        });

        if (!response.ok && response.status !== 200) {
          const errData = await response.json().catch(() => ({}));
          throw new Error(errData.error || 'Erreur lors de la vérification');
        }

        const contentType = response.headers.get('content-type') || '';
        let check = null;

        if (contentType.includes('ndjson') && response.body) {
          const reader = response.body.getReader();
          const decoder = new TextDecoder('utf-8');
          let buffer = '';

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split(String.fromCharCode(10));
            buffer = lines.pop();

            for (const line of lines) {
              const trimmed = line.trim();
              if (!trimmed) continue;
              let evt;
              try { evt = JSON.parse(trimmed); } catch (e) { continue; }

              if (evt.type === 'phase') {
                document.getElementById('progressBarLabel').innerText = evt.message;
                document.getElementById('progressSubtitle').innerText = evt.message;
              } else if (evt.type === 'command_start') {
                const total = evt.total || candidateValidationPlan.length || 1;
                const idx = evt.index;
                itemStates[evt.command.id] = { status: 'running' };
                renderProgressItems(candidateValidationPlan, itemStates);

                const percent = Math.round((idx / total) * 100);
                document.getElementById('progressBarFill').style.width = percent + '%';
                document.getElementById('progressBarPercent').innerText = percent + '%';
                document.getElementById('progressFraction').innerText = idx + ' / ' + total;
                document.getElementById('progressBarLabel').innerText = 'Point ' + (idx + 1) + '/' + total + ' : ' + evt.command.project + ' · ' + evt.command.display;
                document.getElementById('progressSubtitle').innerText = 'Exécution : ' + evt.command.project + ' (' + evt.command.display + ')...';
              } else if (evt.type === 'command_done') {
                const total = evt.total || candidateValidationPlan.length || 1;
                const idx = evt.index;
                itemStates[evt.command.id] = evt.result;
                renderProgressItems(candidateValidationPlan, itemStates);

                const percent = Math.round(((idx + 1) / total) * 100);
                document.getElementById('progressBarFill').style.width = percent + '%';
                document.getElementById('progressBarPercent').innerText = percent + '%';
                document.getElementById('progressFraction').innerText = (idx + 1) + ' / ' + total;
                document.getElementById('progressBarLabel').innerText = (idx + 1 < total) ? 'Point ' + (idx + 1) + '/' + total + ' validé' : 'Tous les points exécutés';
              } else if (evt.type === 'complete') {
                check = evt.result;
              } else if (evt.type === 'error') {
                throw new Error(evt.error || "Erreur lors de l'exécution");
              }
            }
          }
        } else {
          const data = await response.json();
          if (!data.ok) throw new Error(data.error);
          check = data.result;
        }

        clearInterval(timerInterval);
        if (timerEl) timerEl.innerText = ((Date.now() - startTime) / 1000).toFixed(1) + 's';

        if (!check) throw new Error('Résultat de vérification incomplet');

        document.getElementById('targetScoreDisplay').innerText = check.after.scores.correctedScore;
        document.getElementById('targetGrade').innerText = check.after.scores.correctedGrade;
        const passedCommands = (check.commandResults || []).filter(result => result.status === 'passed').length;
        const totalCmds = (check.commandResults || []).length;
        const commandSummary = totalCmds ? passedCommands + '/' + totalCmds + ' commande(s) réussie(s)' : 'contrôle documentaire effectué';
        const summary = check.before.scores.correctedScore + ' → ' + check.after.scores.correctedScore + '/100 · ' + check.resolved.length + ' constat(s) résolu(s) · ' + commandSummary + '.';

        document.getElementById('verificationStatus').innerText = summary;
        document.getElementById('twinVerifiedBadge').innerText = summary;

        document.getElementById('progressBarFill').style.width = '100%';
        document.getElementById('progressBarPercent').innerText = '100%';
        document.getElementById('progressFraction').innerText = totalCmds + ' / ' + totalCmds;
        const canApply = Boolean(check.canApply ?? check.passed);
        const noRegression = (check.introduced?.length || 0) === 0;
        const isReadyToApply = Boolean(check.passed && canApply && check.candidateIntact && !check.cleanupError && noRegression);

        document.getElementById('targetScoreDisplay').innerText = check.after.scores.correctedScore;
        document.getElementById('targetGrade').innerText = check.after.scores.correctedGrade;

        document.getElementById('progressBarFill').className = isReadyToApply
          ? 'bg-gradient-to-r from-emerald-500 to-teal-400 h-2.5 rounded-full transition-all duration-300 shadow-sm'
          : 'bg-gradient-to-r from-amber-500 to-rose-500 h-2.5 rounded-full transition-all duration-300 shadow-sm';

        document.getElementById('progressSpinner').className = isReadyToApply
          ? 'w-10 h-10 rounded-full bg-emerald-500/20 border-2 border-emerald-500 flex items-center justify-center shrink-0 text-emerald-400 font-bold'
          : 'w-10 h-10 rounded-full bg-rose-500/20 border-2 border-rose-500 flex items-center justify-center shrink-0 text-rose-400 font-bold';
        document.getElementById('progressSpinnerIcon').innerText = isReadyToApply ? '✓' : '×';
        document.getElementById('progressPill').className = isReadyToApply
          ? (check.passed ? 'text-[10px] px-2.5 py-0.5 rounded-full border font-mono font-medium bg-emerald-500/10 text-emerald-400 border-emerald-500/30' : 'text-[10px] px-2.5 py-0.5 rounded-full border font-mono font-medium bg-cyan-500/10 text-cyan-300 border-cyan-500/30')
          : 'text-[10px] px-2.5 py-0.5 rounded-full border font-mono font-medium bg-rose-500/10 text-rose-400 border-rose-500/30';
        document.getElementById('progressPill').innerText = isReadyToApply
          ? '✓ Vérification terminée (' + passedCommands + '/' + totalCmds + ')'
          : '× Échec (' + (totalCmds - passedCommands) + ' point(s))';
        document.getElementById('progressSubtitle').innerText = isReadyToApply
          ? (totalCmds ? 'Toutes les commandes déclarées ont réussi.' : 'Contrôles documentaires terminés. Aucun contrôle applicatif déclaré.')
          : 'Un contrôle a échoué ou le candidat a été altéré.';
        document.getElementById('progressBarLabel').innerText = isReadyToApply ? 'Contrôles terminés' : 'Contrôles terminés avec des erreurs';
        document.getElementById('validationPlanBadge').innerText = isReadyToApply ? '✓ Prêt à appliquer' : 'À corriger';

        // Re-render items with final states
        if (check.commandResults) {
          candidateCommandResults = check.commandResults;
          const finalStates = {};
          check.commandResults.forEach(r => { finalStates[r.id] = r; });
          renderProgressItems(candidateValidationPlan, finalStates);
        }

        // Summary Banner
        const banner = document.getElementById('verificationSummaryBanner');
        banner.classList.remove('hidden');
        if (check.passed) {
          banner.className = 'mt-5 p-4 rounded-xl border border-emerald-500/30 bg-emerald-950/20 text-xs shadow-sm';
          document.getElementById('summaryBannerIcon').innerText = '🎉';
          document.getElementById('summaryBannerTitle').innerText = totalCmds ? passedCommands + '/' + totalCmds + ' commandes réussies' : 'Instructions vérifiées · aucun contrôle applicatif exécuté';
          document.getElementById('summaryBannerDesc').innerText = check.resolved.length + ' constat(s) documentaire(s) résolu(s). Candidat intact. Examinez les fichiers avant application.';
        } else {
          banner.className = 'mt-5 p-4 rounded-xl border border-rose-500/30 bg-rose-950/20 text-xs shadow-sm';
          document.getElementById('summaryBannerIcon').innerText = '⚠️';
          document.getElementById('summaryBannerTitle').innerText = 'Application bloquée';
          document.getElementById('summaryBannerDesc').innerText = 'Consultez les contrôles en échec et les erreurs d’intégrité. Sans exécution sur la référence, leur origine reste à établir.';
        }

        const statsContainer = document.getElementById('summaryBannerStats');
        statsContainer.replaceChildren();
        const statPills = [
          'Score : ' + check.before.scores.correctedScore + ' → ' + check.after.scores.correctedScore + '/100',
          'Résolus : ' + check.resolved.length,
          'Nouveaux constats : ' + check.introduced.length,
          'Commandes : ' + passedCommands + '/' + totalCmds,
          'Twin intact : ' + (check.candidateIntact ? 'Oui' : 'Non')
        ];
        statPills.forEach(text => {
          const pill = document.createElement('span');
          pill.className = 'px-2 py-0.5 rounded bg-zinc-900 border border-zinc-800 text-zinc-300';
          pill.textContent = text;
          statsContainer.appendChild(pill);
        });

        const actionsContainer = document.getElementById('summaryBannerActions');
        if (actionsContainer) {
          actionsContainer.replaceChildren();
          const failedCount = totalCmds - passedCommands;
          if (failedCount > 0) {
            const copyAllBtn = document.createElement('button');
            copyAllBtn.type = 'button';
            copyAllBtn.className = 'px-3 py-1.5 rounded-lg text-xs font-medium bg-zinc-900 hover:bg-zinc-800 text-indigo-300 border border-indigo-500/40 flex items-center gap-2 shadow-sm transition-all active:scale-[0.98]';
            copyAllBtn.innerHTML = '<span>📄</span> Copier le rapport de santé des ' + failedCount + ' échec(s) pour l’IA';
            copyAllBtn.addEventListener('click', () => copyAllFailuresReport());
            actionsContainer.appendChild(copyAllBtn);

            const retestFailedBtn = document.createElement('button');
            retestFailedBtn.type = 'button';
            retestFailedBtn.className = 'px-3 py-1.5 rounded-lg text-xs font-medium bg-zinc-900 hover:bg-zinc-800 text-cyan-300 border border-cyan-500/40 flex items-center gap-2 shadow-sm transition-all active:scale-[0.98]';
            retestFailedBtn.innerHTML = '<span>⚡</span> Relancer les ' + failedCount + ' point(s) en échec';
            retestFailedBtn.addEventListener('click', () => retestFailed());
            actionsContainer.appendChild(retestFailedBtn);
          }
          const retestAllBtn = document.createElement('button');
          retestAllBtn.type = 'button';
          retestAllBtn.className = 'px-3 py-1.5 rounded-lg text-xs font-medium bg-zinc-900 hover:bg-zinc-800 text-zinc-300 border border-zinc-700 flex items-center gap-2 shadow-sm transition-all active:scale-[0.98]';
          retestAllBtn.innerHTML = '<span>🔄</span> Tout revérifier';
          retestAllBtn.addEventListener('click', () => verifyTwin({ forceAll: true }));
          actionsContainer.appendChild(retestAllBtn);
        }

        document.getElementById('verificationDetails').textContent = JSON.stringify({ scope: check.scope, resolved: check.resolved, remaining: check.after.findings, introduced: check.introduced, candidateIntact: check.candidateIntact, cleanedArtifacts: check.cleanedArtifacts }, null, 2);
        document.getElementById('verificationDetailsDetails').classList.remove('hidden');

        setStep(isReadyToApply ? 'verified' : 'failed');
        showToast(isReadyToApply ? 'Vérification terminée. Examinez les fichiers avant application.' : 'Application bloquée : consultez les résultats.', isReadyToApply ? '✓' : '!');
      } catch (error) {
        clearInterval(timerInterval);
        showToast(error.message || 'Vérification impossible', '!');
        document.getElementById('targetScoreDisplay').innerText = 'Non vérifié';
        document.getElementById('progressBarLabel').innerText = 'Erreur : ' + (error.message || 'inconnue');
        document.getElementById('progressBarFill').className = 'bg-rose-500 h-2.5 rounded-full';
        setStep(previousStep);
      }
    }

    async function retestItem(id) {
      showToast('Re-test du point en cours...', '↻');
      await verifyTwin({ id });
    }

    async function retestFailed() {
      showToast('Relance des points en échec...', '⚡');
      await verifyTwin({ onlyFailed: true });
    }

    async function applyFix() {
      if (currentStep !== 'verified') return;
      if (!confirm('Appliquer la recette prévisualisée aux fichiers du dépôt avec sauvegarde ?')) return;
      setStep('busy', 'apply');
      showToast('Application des modifications...', '⏳');
      try {
        const res = await fetch('/api/twin/apply', { method: 'POST', headers: { 'X-RepoTwin-Token': sessionToken } });
        const data = await res.json();
        if (data.ok) {
          showToast('Fichiers appliqués avec sauvegarde. Cliquez sur Nettoyer pour recommencer.', '✓');
          setStep('applied');
          document.getElementById('applicationResult').textContent = 'Fichiers appliqués. Sauvegarde : ' + data.backupDir;
          showWorkflowStage('application', true);
        } else {
          showToast('Erreur: ' + data.error, '❌');
          setStep('verified');
        }
      } catch (err) {
        showToast('Erreur réseau', '❌');
        setStep('verified');
      }
    }

    async function cleanTwins() {
      if (workflowBusy) return;
      const previousStep = currentStep;
      setStep('busy', 'clean');
      document.getElementById('sessionMenu').open = false;
      showToast('Nettoyage des worktrees...', '🧹');
      try {
        const res = await fetch('/api/twin/clean', { method: 'POST', headers: { 'X-RepoTwin-Token': sessionToken } });
        const data = await res.json();
        if (!data.ok) throw new Error(data.error);
        showToast(data.cleaned + ' nettoyé(s), ' + data.skippedDirty + ' préservé(s).', '✓');
        document.getElementById('twinBanner').classList.add('hidden');
        document.getElementById('diffSection').classList.add('hidden');
        document.getElementById('verificationProgressSection').classList.add('hidden');
        document.getElementById('verificationSummaryBanner').classList.add('hidden');
        document.getElementById('verificationDetailsDetails').classList.add('hidden');
        document.getElementById('targetScoreDisplay').innerText = 'Non vérifié';
        document.getElementById('targetGrade').innerText = '-';
        document.getElementById('verificationStatus').innerText = 'Aucune validation exécutée.';
        candidateValidationPlan = [];
        candidateScriptBodies = {};
        candidateConsentToken = '';
        candidateCommandResults = [];
        setStep('idle');
        if (previousStep === 'applied') { window.location.reload(); return; }
        showWorkflowStage('diagnostic', true);
      } catch (err) {
        setStep(previousStep);
        showToast(err.message || 'Nettoyage impossible', '❌');
      }
    }

    ${workflowScript}
    initializeWorkflow();
    // Restore the server's current step (e.g. after a page reload).
    const initialState = ${initialState};
    if (initialState.step !== 'idle') {
      candidateValidationPlan = initialState.validationPlan;
      candidateScriptBodies = initialState.scriptBodies;
      candidateConsentToken = initialState.consentToken;
      candidateCommandResults = initialState.commandResults;
      document.getElementById('twinBanner').classList.remove('hidden');
      document.getElementById('twinPathLabel').innerText = initialState.twinPath;
      document.getElementById('twinVerifiedBadge').innerText = 'Candidat de la session en cours (page rechargée).';
      const restoredStates = Object.fromEntries(initialState.commandResults.map(result => [result.id, result]));
      renderProgressItems(candidateValidationPlan, restoredStates);
      document.getElementById('verificationProgressSection').classList.remove('hidden');
      if (initialState.diff) {
        document.getElementById('diffContent').textContent = initialState.diff;
        document.getElementById('applicationDiffContent').textContent = initialState.diff;
        document.getElementById('diffSection').classList.remove('hidden');
      }
      if (initialState.verification) {
        const completed = initialState.commandResults.length;
        const passed = initialState.commandResults.filter(result => result.status === 'passed').length;
        document.getElementById('progressPill').textContent = initialState.verification.passed ? 'Vérification terminée' : 'Application bloquée';
        document.getElementById('progressBarLabel').textContent = 'Contrôles terminés';
        document.getElementById('validationPlanBadge').textContent = initialState.verification.passed ? 'Vérifié' : 'À corriger';
        document.getElementById('progressSpinnerIcon').textContent = initialState.verification.passed ? '✓' : '×';
        document.getElementById('progressTimer').textContent = (initialState.verification.durationMs / 1000).toFixed(1) + 's';
        document.getElementById('progressSubtitle').textContent = passed + '/' + completed + ' commande(s) réussie(s). Résultats conservés dans cette session.';
        document.getElementById('progressFraction').textContent = completed + ' / ' + candidateValidationPlan.length;
        document.getElementById('progressBarPercent').textContent = '100%';
        document.getElementById('progressBarFill').style.width = '100%';
        document.getElementById('targetScoreDisplay').textContent = initialState.verification.score;
        document.getElementById('targetGrade').textContent = initialState.verification.grade;
      }
    }
    setStep(initialState.step);
    showWorkflowStage(initialState.step === 'idle' ? 'diagnostic' : 'verification');
    ${comparisonScript}
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
