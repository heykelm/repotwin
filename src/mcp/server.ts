import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ErrorCode,
  McpError
} from '@modelcontextprotocol/sdk/types.js';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { analyzeRepository } from '../analyzer/analyze-repository.js';
import { discoverSubprojects } from '../analyzer/subproject-scanner.js';
import { generateOptimizationRecipe } from '../generator/recipe-agents-md.js';
import { GeneratedRecipe } from '../generator/recipe-agents-md.js';
import { auditInstructions } from '../analyzer/instruction-audit.js';
import { createCandidateTwin, candidateIsIntact, cleanCandidateIgnoredArtifacts, cleanTwins, TwinResult } from '../twin/worktree-manager.js';
import { applyRecipe, rollbackBackup } from '../generator/apply-recipe.js';
import { generateHtmlReport } from '../report/html-generator.js';
import { buildValidationPlan, runValidationPlan, validationConsentToken, ValidationCommand, ValidationResult } from '../verification/command-runner.js';
import { saveApplicationSnapshot, ApplicationSnapshot } from '../report/application-snapshot.js';
import { SubprojectInfo } from '../types/index.js';
import { REPOTWIN_VERSION } from '../version.js';
import { captureSourceState, assertSourceUnchanged, SourceState } from '../verification/source-state.js';
import { prepareReportStorage } from '../report/safe-storage.js';
import { sieveCommandOutput } from '../verification/compact-sieve.js';
import { auditTokenEfficiency } from '../analysis/token-efficiency.js';
import { compareInstructionAudits, allCommandsPassed } from '../verification/candidate-assessment.js';

interface McpCandidate {
  id: string;
  repoPath: string;
  sourceState: SourceState;
  recipe: GeneratedRecipe;
  twin: TwinResult;
  projects: SubprojectInfo[];
  before: ReturnType<typeof auditInstructions>;
  validationPlan: ValidationCommand[];
  consentToken: string;
  commandResults: ValidationResult[];
  verified: boolean;
  verificationToken?: string;
  verification?: {
    score: number;
    grade: string;
    resolved: Array<{ message: string }>;
    introduced: number;
    remaining: number;
    durationMs: number;
  };
}

/**
 * Starts the official RepoTwin MCP server over Standard I/O (stdio).
 * Exposes repository inspection, candidate worktree twins, command verification, and fix application.
 */
export function createMcpServer(defaultRepoPath: string = process.cwd()): Server {
  const sessionSecret = crypto.randomBytes(32).toString('hex');
  const candidates = new Map<string, McpCandidate>();
  const server = new Server(
    {
      name: 'repotwin',
      version: REPOTWIN_VERSION,
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  function resolvePath(p?: string): string {
    const target = path.resolve(p || defaultRepoPath);
    if (!fs.existsSync(target) || !fs.statSync(target).isDirectory()) {
      throw new McpError(ErrorCode.InvalidParams, `Directory not found: ${target}`);
    }
    return fs.realpathSync(target);
  }

  function requiredString(args: Record<string, unknown>, key: string): string {
    const value = args[key];
    if (typeof value !== 'string' || value.trim() === '') {
      throw new McpError(ErrorCode.InvalidParams, `${key} is required`);
    }
    return value;
  }

  function getCandidate(args: Record<string, unknown>): McpCandidate {
    const id = requiredString(args, 'candidateId');
    const candidate = candidates.get(id);
    if (!candidate) throw new McpError(ErrorCode.InvalidParams, 'Unknown or expired candidateId. Create a new twin.');
    return candidate;
  }

  function fileSha(filePath: string): string {
    return fs.existsSync(filePath)
      ? crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex')
      : '';
  }

  // 1. Tool declarations exposed by RepoTwin
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: [
        {
          name: 'repotwin_analyze',
          description: 'Analyze a Git repository or monorepo: detects subprojects, test/lint commands, agent instruction files (AGENTS.md, rules) and computes AI agent readiness health scores.',
          annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
          inputSchema: {
            type: 'object',
            properties: {
              repoPath: {
                type: 'string',
                description: 'Absolute or relative path to the repository root (defaults to current working directory).'
              }
            }
          }
        },
        {
          name: 'repotwin_create_twin',
          description: 'Create an isolated digital twin (Git worktree) to safely sandbox, inspect, or modify proposed fixes without mutating working tree files.',
          annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
          inputSchema: {
            type: 'object',
            properties: {
              repoPath: {
                type: 'string',
                description: 'Absolute or relative path to the source repository.'
              }
            },
            required: ['repoPath'],
            additionalProperties: false
          }
        },
        {
          name: 'repotwin_run_checks',
          description: 'Execute the previously disclosed verification commands only inside a RepoTwin-managed candidate. Requires the candidate consent token returned at creation.',
          annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
          inputSchema: {
            type: 'object',
            properties: {
              candidateId: {
                type: 'string',
                description: 'Opaque candidate identifier returned by repotwin_create_twin.'
              },
              commandConsent: {
                type: 'string',
                description: 'Consent token returned with the exact command plan by repotwin_create_twin.'
              },
              onlyFailed: {
                type: 'boolean',
                description: 'If true, re-runs only commands that failed in previous attempts.'
              },
              compactOutput: {
                type: 'boolean',
                description: 'If true (default), strips terminal noise, warnings and long stack traces to return minimal, high-precision diagnostics and preserve agent context tokens.'
              },
              lazyLogs: {
                type: 'boolean',
                description: 'If true, returns surgical failure summary and logId without embedding the full raw terminal dump in the JSON response. Full logs can be fetched on demand via repotwin_get_log.'
              }
            },
            required: ['candidateId', 'commandConsent'],
            additionalProperties: false
          }
        },
        {
          name: 'repotwin_get_log',
          description: 'Retrieve full or paginated raw command output for an executed check in a candidate twin on demand, preventing large log dumps from saturating the agent conversation history.',
          annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
          inputSchema: {
            type: 'object',
            properties: {
              candidateId: {
                type: 'string',
                description: 'Candidate identifier returned by repotwin_create_twin or repotwin_prepare_fix.'
              },
              commandId: {
                type: 'string',
                description: 'Command or check identifier (e.g. from failures or passedCommands).'
              },
              tail: {
                type: 'number',
                description: 'Number of lines from the end to retrieve (e.g. 50).'
              },
              offset: {
                type: 'number',
                description: 'Starting line index (0-based).'
              },
              limit: {
                type: 'number',
                description: 'Maximum number of lines to return.'
              }
            },
            required: ['candidateId', 'commandId'],
            additionalProperties: false
          }
        },
        {
          name: 'repotwin_apply_fix',
          description: 'Apply one intact, fully verified candidate to its source repository. Requires the verification token and explicit confirmation. Never certifies commands that were not executed.',
          annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
          inputSchema: {
            type: 'object',
            properties: {
              candidateId: {
                type: 'string',
                description: 'Opaque candidate identifier returned by repotwin_create_twin.'
              },
              verificationToken: {
                type: 'string',
                description: 'One-time token returned only after complete successful verification.'
              },
              confirmApply: {
                type: 'boolean',
                description: 'Must be true to explicitly authorize mutation of the source repository.'
              },
              selectedTools: {
                type: 'array',
                items: { type: 'string' },
                description: 'Optional AI tools used only for token-economy reporting.'
              }
            },
            required: ['candidateId', 'verificationToken', 'confirmApply'],
            additionalProperties: false
          }
        },
        {
          name: 'repotwin_clean_twins',
          description: 'Clean up orphaned or completed Git worktree twins in the RepoTwin cache.',
          annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
          inputSchema: {
            type: 'object',
            properties: {
              repoPath: {
                type: 'string',
                description: 'Path to the source repository.'
              },
              confirmCleanup: {
                type: 'boolean',
                description: 'Must be true to authorize removal of unchanged RepoTwin-managed worktrees.'
              }
            },
            required: ['repoPath', 'confirmCleanup'],
            additionalProperties: false
          }
        },
        {
          name: 'repotwin_prepare_fix',
          description: 'Prepare, sandbox, and verify an AI instruction fix in an isolated Git worktree without modifying any repository files yet. Automatically runs project verification checks in the sandbox, computes the before/after diff of AGENTS.md, generates the HTML report, and returns a verified candidate ready for user review and approval.',
          annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
          inputSchema: {
            type: 'object',
            properties: {
              repoPath: {
                type: 'string',
                description: 'Path to repository root (defaults to configured working directory).'
              },
              executeProjectScripts: {
                type: 'boolean',
                description: 'Optional: execute full project test and build scripts in the sandbox. Defaults to false for fast response.'
              }
            },
            additionalProperties: false
          }
        },
        {
          name: 'repotwin_rollback',
          description: 'Rollback and restore the repository to its exact state before the latest RepoTwin fix (or a specific backupId). 100% reversible, restores original files atomically from .repotwin/backups.',
          annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
          inputSchema: {
            type: 'object',
            properties: {
              repoPath: {
                type: 'string',
                description: 'Path to repository root (defaults to configured working directory).'
              },
              backupId: {
                type: 'string',
                description: 'Optional backup directory identifier. Defaults to the most recent backup.'
              }
            },
            additionalProperties: false
          }
        },
        {
          name: 'repotwin_token_audit',
          description: 'Audit repository instruction weight, context hogs (large files >500 lines), command verbosity, and calculate token savings potential.',
          annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
          inputSchema: {
            type: 'object',
            properties: {
              repoPath: {
                type: 'string',
                description: 'Path to repository root (defaults to configured working directory).'
              }
            },
            additionalProperties: false
          }
        }
      ]
    };
  });

  // 2. Tool execution handler
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args = {} } = request.params;

    try {
      switch (name) {
        case 'repotwin_analyze': {
          const repo = resolvePath(args.repoPath as string | undefined);
          const analysis = analyzeRepository(repo);
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  repoPath: repo,
                  subprojects: analysis.subprojects.map(s => ({
                    name: s.name,
                    path: s.relPath,
                    kind: s.kind,
                    testCommand: s.testScript || null,
                    lintCommand: s.lintScript || null,
                    buildCommand: s.buildScript || null,
                  })),
                  scores: analysis.scores,
                  instructionAudit: analysis.instructionAudit,
                  projectDiscovery: analysis.projectDiscovery,
                  proposedChangesSummary: analysis.recipe.summaryChanges,
                }, null, 2)
              }
            ]
          };
        }

        case 'repotwin_create_twin': {
          const repo = resolvePath(requiredString(args, 'repoPath'));
          const sourceState = captureSourceState(repo);
          const subprojects = discoverSubprojects(repo);
          const before = auditInstructions(repo, subprojects);
          const recipe = generateOptimizationRecipe(repo, subprojects, []);
          const twin = createCandidateTwin(repo, recipe);
          const validationPlan = buildValidationPlan(subprojects);
          const candidateId = crypto.randomUUID();
          const consentToken = validationConsentToken(validationPlan, sessionSecret);
          candidates.set(candidateId, {
            id: candidateId,
            repoPath: repo,
            sourceState,
            recipe,
            twin,
            projects: subprojects,
            before,
            validationPlan,
            consentToken,
            commandResults: [],
            verified: false
          });

          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  success: true,
                  candidateId,
                  sourceCommit: sourceState.commit,
                  sourceHasUncommittedChanges: sourceState.hasUncommittedChanges,
                  executionScope: 'committed-HEAD; uncommitted application files are not copied',
                  twinPath: twin.twinPath,
                  branchName: twin.branchName,
                  filesModified: twin.filesModified,
                  validationPlan: validationPlan.map(command => ({
                    id: command.id,
                    project: command.project,
                    path: command.relPath,
                    kind: command.kind,
                    command: command.display
                  })),
                  commandConsent: consentToken,
                  message: 'Twin created. Review the disclosed command plan, then call repotwin_run_checks with this candidateId and commandConsent.'
                }, null, 2)
              }
            ]
          };
        }

        case 'repotwin_run_checks': {
          const candidate = getCandidate(args);
          candidate.verified = false;
          candidate.verificationToken = undefined;
          assertSourceUnchanged(candidate.repoPath, candidate.sourceState);
          if (!candidateIsIntact(candidate.repoPath, candidate.twin)) {
            throw new Error('Candidate changed before verification. Create a new twin.');
          }
          if (candidate.validationPlan.length > 0 && args.commandConsent !== candidate.consentToken) {
            throw new McpError(ErrorCode.InvalidParams, 'The command consent token does not match the disclosed validation plan.');
          }

          let planToRun = candidate.validationPlan;
          if (args.onlyFailed === true && candidate.commandResults.length > 0) {
            const failedIds = new Set(candidate.commandResults.filter(result => result.status !== 'passed').map(result => result.id));
            planToRun = candidate.validationPlan.filter(command => failedIds.has(command.id));
            if (planToRun.length === 0) planToRun = candidate.validationPlan;
          }
          const dependentProjects = new Set(planToRun.filter(command => command.kind !== 'install').map(command => command.relPath));
          const selectedIds = new Set(planToRun.map(command => command.id));
          planToRun = candidate.validationPlan.filter(command =>
            selectedIds.has(command.id) || (command.kind === 'install' && dependentProjects.has(command.relPath))
          );

          const startedAt = Date.now();
          const after = auditInstructions(candidate.twin.twinPath, candidate.projects);
          const { introduced, resolved } = compareInstructionAudits(candidate.before, after);
          const targetResults = await runValidationPlan(candidate.twin.twinPath, planToRun);
          assertSourceUnchanged(candidate.repoPath, candidate.sourceState);
          if (planToRun.length < candidate.validationPlan.length && candidate.commandResults.length > 0) {
            const byId = new Map(candidate.commandResults.map(result => [result.id, result]));
            for (const result of targetResults) byId.set(result.id, result);
            candidate.commandResults = candidate.validationPlan
              .map(command => byId.get(command.id))
              .filter((result): result is ValidationResult => Boolean(result));
          } else {
            candidate.commandResults = targetResults;
          }

          let cleanupError: string | undefined;
          try {
            cleanCandidateIgnoredArtifacts(candidate.repoPath, candidate.twin);
          } catch (error) {
            cleanupError = error instanceof Error ? error.message : String(error);
          }
          const candidateIntact = candidateIsIntact(candidate.repoPath, candidate.twin);
          const commandsPassed = allCommandsPassed(candidate.validationPlan, candidate.commandResults);
          candidate.verified = commandsPassed && candidateIntact && !cleanupError && introduced.length === 0;
          candidate.verification = {
            score: after.scores.correctedScore,
            grade: after.scores.correctedGrade,
            resolved: resolved.map(finding => ({ message: finding.message })),
            introduced: introduced.length,
            remaining: after.findings.length,
            durationMs: Date.now() - startedAt
          };
          if (candidate.verified) candidate.verificationToken = crypto.randomBytes(32).toString('hex');

          const failed = candidate.commandResults.filter(result => result.status !== 'passed');
          const passed = candidate.commandResults.filter(result => result.status === 'passed');

          const isCompact = args.compactOutput !== false;
          const isLazy = args.lazyLogs === true;
          const failures = failed.map(f => {
            const sieve = isCompact ? sieveCommandOutput(f.output, f.kind, f.status) : undefined;
            return {
              id: f.id,
              project: f.project,
              subprojectPath: f.relPath,
              kind: f.kind,
              status: f.status,
              command: f.display,
              exitCode: f.exitCode,
              durationMs: f.durationMs,
              // The parser is best-effort. Keep the captured diagnostic so an
              // unrecognized or partial extraction cannot hide an error.
              errorOutput: sieve ? sieve.compactOutput : f.output,
              rawOutput: isCompact ? (isLazy ? undefined : f.output) : undefined,
              outputTruncated: f.outputTruncated,
              logAvailableOnDemand: isLazy ? true : undefined,
              totalLogLines: f.output.split('\n').length,
              extractedFailures: sieve && sieve.failures.length > 0 ? sieve.failures : undefined
            };
          });

          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  allPassed: candidate.verified,
                  canApply: candidate.verified,
                  verificationToken: candidate.verificationToken,
                  totalCommands: candidate.validationPlan.length,
                  passedCount: passed.length,
                  failedCount: failed.length,
                  candidateIntact,
                  noInstructionRegression: introduced.length === 0,
                  cleanupError,
                  tokenEfficiency: {
                    compactMode: isCompact,
                    measuredSavings: null,
                    note: 'Failure output includes the captured raw diagnostic; token savings have not been measured. Output may be truncated as indicated per command.'
                  },
                  failures,
                  passedCommands: passed.map(p => ({
                    project: p.project,
                    kind: p.kind,
                    command: p.display,
                    durationMs: p.durationMs,
                  }))
                }, null, 2)
              }
            ]
          };
        }

        case 'repotwin_apply_fix': {
          const candidate = getCandidate(args);
          if (args.confirmApply !== true) throw new McpError(ErrorCode.InvalidParams, 'confirmApply must be true');
          if (!candidate.verified || typeof args.verificationToken !== 'string' || args.verificationToken !== candidate.verificationToken) {
            throw new Error('A successful current verification token is required before applying.');
          }
          assertSourceUnchanged(candidate.repoPath, candidate.sourceState);
          if (!candidateIsIntact(candidate.repoPath, candidate.twin)) throw new Error('Candidate changed after verification.');
          const agentsPath = path.join(candidate.twin.twinPath, 'AGENTS.md');
          const readyPath = path.join(candidate.twin.twinPath, 'agent-ready.json');
          if (fileSha(agentsPath) !== crypto.createHash('sha256').update(candidate.recipe.agentsMdContent).digest('hex') ||
              fileSha(readyPath) !== crypto.createHash('sha256').update(candidate.recipe.agentReadyJsonContent).digest('hex')) {
            throw new Error('Candidate recipe changed after verification.');
          }
          const currentRecipe = generateOptimizationRecipe(candidate.repoPath, discoverSubprojects(candidate.repoPath), []);
          if (currentRecipe.agentsMdContent !== candidate.recipe.agentsMdContent ||
              currentRecipe.agentReadyJsonContent !== candidate.recipe.agentReadyJsonContent) {
            throw new Error('Source repository changed since candidate creation. Create and verify a new twin.');
          }

          const repo = candidate.repoPath;
          const currentAgentsPath = path.join(repo, 'AGENTS.md');
          const currentAgents = fs.existsSync(currentAgentsPath) ? fs.readFileSync(currentAgentsPath, 'utf-8') : '';
          const currentTokens = currentAgents ? Math.round(currentAgents.length / 4) : 0;
          const proposedTokens = candidate.recipe.agentsMdContent ? Math.round(candidate.recipe.agentsMdContent.length / 4) : 0;
          const tokensSaved = Math.max(0, currentTokens - proposedTokens);
          const selectedTools = Array.isArray(args.selectedTools)
            ? args.selectedTools.filter((item): item is string => typeof item === 'string')
            : [];
          prepareReportStorage(repo);
          const backupDir = applyRecipe(repo, candidate.recipe);
          candidate.verified = false;
          candidate.verificationToken = undefined;

          const snapshot: ApplicationSnapshot = {
            id: crypto.randomUUID().slice(0, 8),
            appliedAt: new Date().toISOString(),
            appliedAtFormatted: new Intl.DateTimeFormat('en-US', {
              dateStyle: 'full',
              timeStyle: 'medium'
            }).format(new Date()),
            repoPath: fs.realpathSync(repo),
            repoName: path.basename(repo),
            backupDir,
            baseCommit: candidate.sourceState.commit,
            sourceFingerprint: candidate.sourceState.fingerprint,
            scores: {
              before: {
                score: candidate.before.scores.correctedScore,
                grade: candidate.before.scores.correctedGrade
              },
              after: {
                score: candidate.verification!.score,
                grade: candidate.verification!.grade
              }
            },
            findings: {
              resolvedCount: candidate.verification!.resolved.length,
              resolved: candidate.verification!.resolved,
              remainingCount: candidate.verification!.remaining
            },
            commands: {
              total: candidate.validationPlan.length,
              passed: candidate.commandResults.filter(result => result.status === 'passed').length,
              results: candidate.commandResults.map(result => ({
                id: result.id,
                project: result.project,
                display: result.display,
                kind: result.kind,
                status: result.status,
                durationMs: result.durationMs
              }))
            },
            tokenEconomy: {
              selectedTools,
              tokensSavedPerQuery: tokensSaved,
              totalTokensSaved: tokensSaved,
              percentSaved: currentTokens > 0 ? Math.round((tokensSaved / currentTokens) * 100) : 0,
              totalOriginalTokens: currentTokens,
              totalOptimizedTokens: proposedTokens,
              measurement: 'instruction-size-estimate',
              usageMeasured: false
            },
            filesApplied: ['AGENTS.md', 'agent-ready.json'],
            diff: candidate.twin.diff ?? ''
          };

          const saved = saveApplicationSnapshot(repo, snapshot);

          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  success: true,
                  repoPath: repo,
                  scores: {
                    before: snapshot.scores.before.score,
                    after: snapshot.scores.after.score,
                    grade: snapshot.scores.after.grade
                  },
                  findingsResolved: snapshot.findings.resolvedCount,
                  backupDirectory: backupDir,
                  appliedFiles: snapshot.filesApplied,
                  reports: {
                    localCertificateHtml: saved.htmlPath,
                    localCertificateJson: saved.jsonPath,
                    globalArchiveHtml: saved.globalHtmlPath
                  },
                  message: 'Recipe successfully applied with automatic backup. Official certification reports generated and archived.'
                }, null, 2)
              }
            ]
          };
        }

        case 'repotwin_prepare_fix': {
          const repo = resolvePath(args.repoPath as string | undefined);
          const sourceState = captureSourceState(repo);
          const subprojects = discoverSubprojects(repo);
          const before = auditInstructions(repo, subprojects);
          const recipe = generateOptimizationRecipe(repo, subprojects, []);
          const twin = createCandidateTwin(repo, recipe);
          const validationPlan = buildValidationPlan(subprojects);
          const candidateId = crypto.randomUUID();
          const consentToken = validationConsentToken(validationPlan, sessionSecret);

          const executeScripts = args.executeProjectScripts === true;
          const startedAt = Date.now();
          const targetResults = executeScripts
            ? await runValidationPlan(twin.twinPath, validationPlan)
            : [];
          const after = auditInstructions(twin.twinPath, subprojects);
          const { introduced } = compareInstructionAudits(before, after);

          let cleanupError: string | undefined;
          try {
            cleanCandidateIgnoredArtifacts(repo, twin);
          } catch (error) {
            cleanupError = error instanceof Error ? error.message : String(error);
          }

          const candidateIntact = candidateIsIntact(repo, twin);
          const commandsPassed = executeScripts ? allCommandsPassed(validationPlan, targetResults) : true;
          const verified = commandsPassed && candidateIntact && !cleanupError && introduced.length === 0;
          const verificationToken = verified ? crypto.randomBytes(32).toString('hex') : undefined;

          candidates.set(candidateId, {
            id: candidateId,
            repoPath: repo,
            sourceState,
            recipe,
            twin,
            projects: subprojects,
            before,
            validationPlan,
            consentToken,
            commandResults: targetResults,
            verified,
            verificationToken,
            verification: {
              score: after.scores.correctedScore,
              grade: after.scores.correctedGrade,
              resolved: [],
              introduced: introduced.length,
              remaining: after.findings.length,
              durationMs: Date.now() - startedAt
            }
          });

          // Generate HTML report in repo
          const reportDir = path.join(repo, '.repotwin');
          fs.mkdirSync(reportDir, { recursive: true, mode: 0o700 });
          const reportPath = path.join(reportDir, 'report.html');
          const analysis = analyzeRepository(repo);
          generateHtmlReport({
            repoPath: repo,
            syncRootReport: false,
            scores: analysis.scores,
            subprojects,
            falsePositives: analysis.falsePositives,
            trueIssues: analysis.trueIssues,
            proposedFixes: recipe.summaryChanges,
            newAgentsMd: recipe.agentsMdContent
          }, reportPath);

          const failed = targetResults.filter(r => r.status !== 'passed');
          const passed = targetResults.filter(r => r.status === 'passed');

          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  status: verified ? 'verified_ready_for_review' : 'verification_failed',
                  candidateId,
                  verificationToken: verified ? verificationToken : null,
                  canApply: verified,
                  allChecksPassed: commandsPassed,
                  totalCommandsExecuted: validationPlan.length,
                  passedCommandsCount: passed.length,
                  failedCommandsCount: failed.length,
                  summary: recipe.summaryChanges,
                  proposedAgentsMdSnippet: recipe.agentsMdContent.slice(0, 1500),
                  htmlReportPath: reportPath,
                  twinSandboxPath: twin.twinPath,
                  instructionsForAgent: verified
                    ? `Verification succeeded in the isolated sandbox (${passed.length}/${validationPlan.length} tests passed). Present the proposed changes and ask the user: "All project verification checks passed in the isolated sandbox. Would you like me to apply these AGENTS.md optimizations to your repository?". When the user confirms, call repotwin_apply_fix with candidateId: "${candidateId}", verificationToken: "${verificationToken}", and confirmApply: true.`
                    : `Verification failed in the sandbox (${failed.length} test(s) failed). Review failure details before asking the user.`
                }, null, 2)
              }
            ]
          };
        }

        case 'repotwin_rollback': {
          const repo = resolvePath(args.repoPath as string | undefined);
          const backupId = typeof args.backupId === 'string' && args.backupId.trim() ? args.backupId.trim() : undefined;
          const result = rollbackBackup(repo, backupId);
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  success: true,
                  restoredBackupId: result.backupId,
                  filesRestored: result.filesRestored,
                  message: `Rollback successful. Restored ${result.filesRestored.join(', ')} from backup "${result.backupId}".`
                }, null, 2)
              }
            ]
          };
        }

        case 'repotwin_token_audit': {
          const repo = resolvePath(args.repoPath as string | undefined);
          const subprojects = discoverSubprojects(repo);
          const audit = auditTokenEfficiency(repo, subprojects);
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(audit, null, 2)
              }
            ]
          };
        }

        case 'repotwin_get_log': {
          const candidate = getCandidate(args);
          const commandId = requiredString(args, 'commandId');
          const result = candidate.commandResults.find(r => r.id === commandId);
          if (!result) {
            throw new McpError(ErrorCode.InvalidParams, `Command '${commandId}' not found in candidate execution results.`);
          }

          const allLines = result.output.split('\n');
          let slice = allLines;
          if (typeof args.offset === 'number' && args.offset >= 0) {
            slice = slice.slice(args.offset);
          }
          if (typeof args.limit === 'number' && args.limit > 0) {
            slice = slice.slice(0, args.limit);
          } else if (typeof args.tail === 'number' && args.tail > 0) {
            slice = slice.slice(-args.tail);
          }

          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  commandId: result.id,
                  command: result.display,
                  kind: result.kind,
                  status: result.status,
                  exitCode: result.exitCode,
                  durationMs: result.durationMs,
                  totalLines: allLines.length,
                  linesReturned: slice.length,
                  outputTruncated: result.outputTruncated,
                  log: slice.join('\n')
                }, null, 2)
              }
            ]
          };
        }

        case 'repotwin_clean_twins': {
          if (args.confirmCleanup !== true) throw new McpError(ErrorCode.InvalidParams, 'confirmCleanup must be true');
          const repo = resolvePath(requiredString(args, 'repoPath'));
          const result = cleanTwins(repo);
          for (const [id, candidate] of candidates) {
            if (candidate.repoPath === repo && !fs.existsSync(candidate.twin.twinPath)) candidates.delete(id);
          }
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  cleanedWorktreesCount: result.cleaned,
                  skippedDirtyCount: result.skippedDirty,
                  message: `Cleanup completed: ${result.cleaned} twin(s) removed.`
                }, null, 2)
              }
            ]
          };
        }

        default:
          throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
      }
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      return {
        isError: true,
        content: [
          {
            type: 'text',
            text: JSON.stringify({ error: errMsg }, null, 2)
          }
        ]
      };
    }
  });

  return server;
}

export async function startMcpServer(defaultRepoPath: string = process.cwd()): Promise<void> {
  const server = createMcpServer(defaultRepoPath);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
