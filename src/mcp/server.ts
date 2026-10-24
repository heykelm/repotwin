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
import { applyRecipe } from '../generator/apply-recipe.js';
import { buildValidationPlan, runValidationPlan, validationConsentToken, ValidationCommand, ValidationResult } from '../verification/command-runner.js';
import { saveApplicationSnapshot, ApplicationSnapshot } from '../report/application-snapshot.js';
import { SubprojectInfo } from '../types/index.js';
import { REPOTWIN_VERSION } from '../version.js';

interface McpCandidate {
  id: string;
  repoPath: string;
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
              }
            },
            required: ['candidateId', 'commandConsent'],
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
                  proposedChangesSummary: analysis.recipe.summaryChanges,
                }, null, 2)
              }
            ]
          };
        }

        case 'repotwin_create_twin': {
          const repo = resolvePath(requiredString(args, 'repoPath'));
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
          const introduced = after.findings.filter(finding => !candidate.before.findings.some(previous =>
            previous.file === finding.file && previous.rule === finding.rule && previous.message === finding.message
          ));
          const resolved = candidate.before.findings.filter(previous => !after.findings.some(finding =>
            previous.file === finding.file && previous.rule === finding.rule && previous.message === finding.message
          ));
          const targetResults = await runValidationPlan(candidate.twin.twinPath, planToRun);
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
          const commandsPassed = candidate.commandResults.length === candidate.validationPlan.length &&
            candidate.validationPlan.every(command => candidate.commandResults.some(result => result.id === command.id && result.status === 'passed'));
          candidate.verified = commandsPassed && candidateIntact && !cleanupError && introduced.length === 0;
          candidate.verification = {
            score: after.scores.correctedScore,
            grade: after.scores.correctedGrade,
            resolved: resolved.map(finding => ({ message: finding.message })),
            introduced: introduced.length,
            durationMs: Date.now() - startedAt
          };
          if (candidate.verified) candidate.verificationToken = crypto.randomBytes(32).toString('hex');

          const failed = candidate.commandResults.filter(result => result.status !== 'passed');
          const passed = candidate.commandResults.filter(result => result.status === 'passed');

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
                  failures: failed.map(f => ({
                    id: f.id,
                    project: f.project,
                    subprojectPath: f.relPath,
                    kind: f.kind,
                    command: f.display,
                    exitCode: f.exitCode,
                    durationMs: f.durationMs,
                    errorOutput: f.output.slice(-2000), // Trailing 2000 characters for agent diagnostics
                  })),
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
            baseCommit: candidate.twin.branchName,
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
              remainingCount: candidate.verification!.introduced
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
              estimatedQueriesPerMonth: 900,
              monthlySavedTokens: tokensSaved * 900,
              yearlySavedTokens: tokensSaved * 900 * 12,
              monthlySavingsUsd: Number(((tokensSaved * 900 / 1_000_000) * 3).toFixed(2)),
              yearlySavingsUsd: Number(((tokensSaved * 900 * 12 / 1_000_000) * 3).toFixed(2))
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
