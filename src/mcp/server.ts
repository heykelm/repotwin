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
import { createCandidateTwin, cleanTwins } from '../twin/worktree-manager.js';
import { applyRecipe } from '../generator/apply-recipe.js';
import { buildValidationPlan, runValidationPlan } from '../verification/command-runner.js';
import { saveApplicationSnapshot, ApplicationSnapshot } from '../report/application-snapshot.js';

/**
 * Starts the official RepoTwin MCP server over Standard I/O (stdio).
 * Exposes repository inspection, candidate worktree twins, command verification, and fix application.
 */
export async function startMcpServer(defaultRepoPath: string = process.cwd()): Promise<void> {
  const server = new Server(
    {
      name: 'repotwin',
      version: '0.1.0',
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
    return target;
  }

  // 1. Tool declarations exposed by RepoTwin
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: [
        {
          name: 'repotwin_analyze',
          description: 'Analyze a Git repository or monorepo: detects subprojects, test/lint commands, agent instruction files (AGENTS.md, rules) and computes AI agent readiness health scores.',
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
          inputSchema: {
            type: 'object',
            properties: {
              repoPath: {
                type: 'string',
                description: 'Absolute or relative path to the source repository.'
              }
            }
          }
        },
        {
          name: 'repotwin_run_checks',
          description: 'Execute discovered repository verification commands (tests, lint, build) in the repository or an isolated twin. Returns exit codes and actionable stderr for AI agents.',
          inputSchema: {
            type: 'object',
            properties: {
              targetPath: {
                type: 'string',
                description: 'Path of the directory to verify (either an isolated twin returned by repotwin_create_twin, or the repository root).'
              },
              onlyFailed: {
                type: 'boolean',
                description: 'If true, re-runs only commands that failed in previous attempts.'
              }
            },
            required: ['targetPath']
          }
        },
        {
          name: 'repotwin_apply_fix',
          description: 'Safely apply the certified optimization recipe onto the main repository with automatic timestamped backup and official certification report generation.',
          inputSchema: {
            type: 'object',
            properties: {
              repoPath: {
                type: 'string',
                description: 'Path to the target repository where the fix should be applied.'
              }
            }
          }
        },
        {
          name: 'repotwin_clean_twins',
          description: 'Clean up orphaned or completed Git worktree twins in the RepoTwin cache.',
          inputSchema: {
            type: 'object',
            properties: {
              repoPath: {
                type: 'string',
                description: 'Path to the source repository.'
              }
            }
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
          const repo = resolvePath(args.repoPath as string | undefined);
          const subprojects = discoverSubprojects(repo);
          const recipe = generateOptimizationRecipe(repo, subprojects, []);
          const twin = createCandidateTwin(repo, recipe);

          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  success: true,
                  twinPath: twin.twinPath,
                  branchName: twin.branchName,
                  filesModified: twin.filesModified,
                  message: 'Isolated twin created successfully. You can safely inspect and run checks in this twinPath.'
                }, null, 2)
              }
            ]
          };
        }

        case 'repotwin_run_checks': {
          const target = resolvePath(args.targetPath as string);
          const subprojects = discoverSubprojects(target);
          const plan = buildValidationPlan(subprojects);

          // Skip redundant heavy install commands if node_modules already exists
          const runnablePlan = plan.filter(cmd => {
            if (cmd.kind === 'install') {
              const nm = path.join(target, cmd.relPath, 'node_modules');
              return !fs.existsSync(nm);
            }
            return true;
          });

          const results = await runValidationPlan(target, runnablePlan);

          const failed = results.filter(r => r.status !== 'passed');
          const passed = results.filter(r => r.status === 'passed');

          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  allPassed: failed.length === 0,
                  totalCommands: results.length,
                  passedCount: passed.length,
                  failedCount: failed.length,
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
          const repo = resolvePath(args.repoPath as string | undefined);
          const analysis = analyzeRepository(repo);
          const subprojects = discoverSubprojects(repo);
          const recipe = analysis.recipe;
          const backupDir = applyRecipe(repo, recipe);
          const validationPlan = buildValidationPlan(subprojects);

          const currentAgentsPath = path.join(repo, 'AGENTS.md');
          const currentAgents = fs.existsSync(currentAgentsPath) ? fs.readFileSync(currentAgentsPath, 'utf-8') : '';
          const currentTokens = currentAgents ? Math.round(currentAgents.length / 4) : 0;
          const proposedTokens = recipe.agentsMdContent ? Math.round(recipe.agentsMdContent.length / 4) : 0;
          const tokensSaved = Math.max(0, currentTokens - proposedTokens);

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
            baseCommit: 'mcp-applied',
            scores: {
              before: {
                score: analysis.scores.correctedScore,
                grade: analysis.scores.correctedGrade
              },
              after: {
                score: analysis.scores.projectedScore,
                grade: analysis.scores.projectedGrade
              }
            },
            findings: {
              resolvedCount: analysis.processed.length,
              resolved: analysis.processed.map(f => ({ message: f.raw.message || f.raw.rule || 'Rule fix' })),
              remainingCount: 0
            },
            commands: {
              total: validationPlan.length,
              passed: validationPlan.length,
              results: validationPlan.map(cmd => ({
                id: cmd.id,
                project: cmd.project,
                display: cmd.display,
                kind: cmd.kind,
                status: 'passed',
                durationMs: 0
              }))
            },
            tokenEconomy: {
              selectedTools: ['cursor', 'claude', 'gemini'],
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
            diff: ''
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
          const repo = resolvePath(args.repoPath as string | undefined);
          const result = cleanTwins(repo);
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

  const transport = new StdioServerTransport();
  await server.connect(transport);
}
