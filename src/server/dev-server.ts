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
import { createComparisonApi } from './comparison-ui.js';
import { buildValidationPlan, runValidationPlan, validationConsentToken, ValidationCommand, ValidationResult } from '../verification/command-runner.js';
import { saveApplicationSnapshot, ApplicationSnapshot } from '../report/application-snapshot.js';
import { captureSourceState, assertSourceUnchanged, SourceState } from '../verification/source-state.js';
import { prepareReportStorage } from '../report/safe-storage.js';
import { compareInstructionAudits, allCommandsPassed } from '../verification/candidate-assessment.js';

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
    sourceState: SourceState;
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
      remaining: number;
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
        const sourceState = captureSourceState(repoPath);
        const subprojects = discoverSubprojects(repoPath);
        const before = auditInstructions(repoPath, subprojects);
        const recipe = generateOptimizationRecipe(repoPath, subprojects, []);
        const result = createCandidateTwin(repoPath, recipe);
        const validationPlan = buildValidationPlan(subprojects);
        const consentToken = validationConsentToken(validationPlan, sessionToken);
        candidate = { sourceState, recipe, twin: result, projects: subprojects, before, validationPlan, consentToken, commandResults: [], verified: false };

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          ok: true,
          result: {
            ...result,
            sourceCommit: sourceState.commit,
            sourceHasUncommittedChanges: sourceState.hasUncommittedChanges,
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
      assertSourceUnchanged(repoPath, candidate.sourceState);
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
      const { introduced, resolved } = compareInstructionAudits(candidate.before, after);

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

      assertSourceUnchanged(repoPath, candidate.sourceState);
      if (planToRun.length < candidate.validationPlan.length && candidate.commandResults?.length) {
        const resultMap = new Map(candidate.commandResults.map(r => [r.id, r]));
        for (const r of targetResults) {
          resultMap.set(r.id, r);
        }
        candidate.commandResults = candidate.validationPlan.map(cmd => resultMap.get(cmd.id)!).filter(Boolean);
      } else {
        candidate.commandResults = targetResults;
      }

      const commandsPassed = allCommandsPassed(candidate.validationPlan, candidate.commandResults);
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
        remaining: after.findings.length,
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
        assertSourceUnchanged(repoPath, candidate.sourceState);
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
        assertSourceUnchanged(repoPath, candidate.sourceState);
        prepareReportStorage(repoPath);
        const backupDir = applyRecipe(repoPath, candidate.recipe);
        candidate.verified = false;

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
          baseCommit: candidate.sourceState.commit,
          sourceFingerprint: candidate.sourceState.fingerprint,
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
            remainingCount: candidate.verification?.remaining ?? candidate.before.findings.length
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
            tokensSavedPerQuery,
            totalTokensSaved: tokensSavedPerQuery,
            percentSaved,
            totalOriginalTokens: currentTokens,
            totalOptimizedTokens: proposedTokens,
            measurement: 'instruction-size-estimate',
            usageMeasured: false
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
      if (res.headersSent) {
        res.end(JSON.stringify({ type: 'complete', ok: false, error: error instanceof Error ? error.message : 'Verification failed' }) + '\n');
        return;
      }
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
      analyzedAt: new Date().toLocaleTimeString('fr-FR'),
      hasUncommittedChanges: Boolean(gitValue(['status', '--porcelain', '--untracked-files=all', '--', '.', ':(exclude).repotwin'], ''))
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
