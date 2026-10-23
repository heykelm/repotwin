#!/usr/bin/env node
import { Command } from 'commander';
import chalk from 'chalk';
import path from 'node:path';
import fs from 'node:fs';
import { parseAgentReport } from './analyzer/report-parser.js';
import { discoverSubprojects, buildFileIndex, discoverKnownTables } from './analyzer/subproject-scanner.js';
import { scanRules } from './analyzer/rules-scanner.js';
import { disambiguateFinding } from './diagnostics/disambiguator.js';
import { calculateScores, renderProgressBar } from './diagnostics/score.js';
import { generateOptimizationRecipe } from './generator/recipe-agents-md.js';
import { applyRecipe } from './generator/apply-recipe.js';
import { analyzeRepository } from './analyzer/analyze-repository.js';
import { createCandidateTwin, cleanTwins } from './twin/worktree-manager.js';
import { generateHtmlReport } from './report/html-generator.js';
import { startDevServer } from './server/dev-server.js';
import { ProcessedFinding } from './types/index.js';
import { auditInstructions } from './analyzer/instruction-audit.js';

const program = new Command();

program
  .name('repotwin')
  .description('RepoTwin — Measure. Optimize. Prove. Diagnostic & Optimization for AI Coding Agents')
  .version('0.1.0')
  .option('-r, --from-report <reportFile>', 'Path to an agent report')
  .option('--html', 'Generate an interactive HTML report')
  .option('--json', 'Output results as JSON');

type AnalyzeOptions = { fromReport?: string; json?: boolean; html?: boolean; apply?: boolean };

function optionsFrom(...values: unknown[]): AnalyzeOptions {
  const merged: AnalyzeOptions = {};
  for (const value of values) {
    if (!value || typeof value !== 'object') continue;
    const candidate = value as Record<string, unknown> & { opts?: () => Record<string, unknown>; optsWithGlobals?: () => Record<string, unknown> };
    const source = typeof candidate.optsWithGlobals === 'function' ? candidate.optsWithGlobals() : typeof candidate.opts === 'function' ? candidate.opts() : candidate;
    if (typeof source.fromReport === 'string') merged.fromReport = source.fromReport;
    if (typeof source.json === 'boolean') merged.json = source.json;
    if (typeof source.html === 'boolean') merged.html = source.html;
    if (typeof source.apply === 'boolean') merged.apply = source.apply;
  }
  return merged;
}

function assertDirectory(repoPath: string): void {
  if (!fs.existsSync(repoPath) || !fs.statSync(repoPath).isDirectory()) {
    throw new Error(`Repository path is not a directory: ${repoPath}`);
  }
}

function writeFileAtomically(target: string, content: string): void {
  const temporary = `${target}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, content, { encoding: 'utf-8', mode: 0o600 });
  fs.renameSync(temporary, target);
}

function previewOrApplyRecipe(repoPath: string, recipe: ReturnType<typeof generateOptimizationRecipe>, apply: boolean): void {
  const targets = [
    { name: 'AGENTS.md', content: recipe.agentsMdContent },
    { name: 'agent-ready.json', content: recipe.agentReadyJsonContent }
  ];

  console.log(chalk.cyan(`\nProposed changes for ${repoPath}:`));
  for (const target of targets) {
    const exists = fs.existsSync(path.join(repoPath, target.name));
    console.log(`  ${exists ? 'modify' : 'create'} ${target.name}`);
  }

  if (!apply) {
    console.log(chalk.yellow('\nNo file was written. Review the candidate with `repotwin twin create` or rerun with `repotwin fix --apply`.'));
    return;
  }

  const backupDir = applyRecipe(repoPath, recipe);
  console.log(chalk.bold.green(`\nApplied. Existing files, if any, were backed up to ${backupDir}.`));
}

function runAnalyze(repoPathArg?: string, options: AnalyzeOptions = {}) {
  const repoPath = path.resolve(repoPathArg || process.cwd());
  assertDirectory(repoPath);

  const reportFile = options.fromReport ? path.resolve(options.fromReport) : undefined;
  const analysis = analyzeRepository(repoPath, reportFile);
  const { subprojects, processed, falsePositives, trueIssues, scores, recipe } = analysis;

  if (!options.json) {
    console.log(chalk.bold.cyan('\n🔍 RepoTwin — Diagnostic & Optimisation Agent IA'));
    console.log(chalk.gray(`Dépôt analysé : ${repoPath}`));

    console.log(chalk.bold.blue('\n📦 1. ÉTAT DES SOUS-PROJETS :'));
    console.log('┌──────────────────────┬──────────┬─────────────────────────────┬────────────────┐');
    console.log('│ Sous-Projet          │ Type     │ Commande Test Détectée      │ Statut Git     │');
    console.log('├──────────────────────┼──────────┼─────────────────────────────┼────────────────┤');
    for (const sub of subprojects) {
      const namePad = sub.relPath.padEnd(20);
      const kindPad = sub.kind.padEnd(8);
      const testText = sub.testScript ? sub.testScript.slice(0, 27) : 'Aucun test racine';
      const testPad = testText.padEnd(27);
      const statusPad = (sub.isSubmodule ? 'Submodule Git' : 'Dossier standard').padEnd(14);
      console.log(`│ ${chalk.bold(namePad)} │ ${kindPad} │ ${chalk.yellow(testPad)} │ ${chalk.gray(statusPad)} │`);
    }
    console.log('└──────────────────────┴──────────┴─────────────────────────────┴────────────────┘');
  }

  // 2. Build file index & scan rules
  const rawFindings = analysis.findings;

  const fpByClassification = new Map<string, ProcessedFinding[]>();
  for (const fp of falsePositives) {
    const list = fpByClassification.get(fp.classification) || [];
    list.push(fp);
    fpByClassification.set(fp.classification, list);
  }


  if (options.json) {
    console.log(JSON.stringify({
      repoPath,
      scores: scores.evaluated ? scores : null,
      evaluationStatus: scores.evaluated ? 'evaluated' : 'not_evaluated',
      instructionAudit: analysis.instructionAudit,
      subprojects,
      totalRawFindings: rawFindings.length,
      falsePositivesCount: falsePositives.length,
      trueIssuesCount: trueIssues.length,
      falsePositivesBreakdown: Object.fromEntries(
        Array.from(fpByClassification.entries()).map(([k, v]) => [k, v.length])
      ),
      proposedFixes: recipe.summaryChanges
    }, null, 2));
    return;
  }

  // Visual Score Gauges
  if (!scores.evaluated) console.log('Non évalué : aucun rapport fourni. Les valeurs numériques ne constituent pas un audit.');
  if (!scores.evaluated) {
    console.log('Non évalué : fournissez un rapport avec --from-report pour calculer un score.');
  } else {
  const rawBar = chalk.red(renderProgressBar(scores.rawScore));
  const realBar = chalk.yellow(renderProgressBar(scores.correctedScore));
  const projBar = chalk.green(renderProgressBar(scores.projectedScore));

  console.log(chalk.bold.magenta('\n📊 2. BILAN COMPARATIF : SCORE AVANT VS APRÈS'));
  console.log('======================================================================');
  console.log(`  Score brut importé           : ${rawBar}  ${chalk.red.bold(`${scores.rawScore}/100 (${scores.rawGrade})`)}`);
  console.log(`  Score après désambiguïsation : ${realBar} ${chalk.yellow.bold(`${scores.correctedScore}/100 (${scores.correctedGrade})`)}  ${chalk.green(`↳ +${scores.falsePenaltyRestored} pts justifiés`)}`);
  console.log(`  Score sans projection        : ${projBar} ${chalk.green.bold(`${scores.projectedScore}/100 (${scores.projectedGrade})`)}  ${chalk.cyan.bold('↳ aucun gain annoncé sans validation')}`);
  console.log('======================================================================');

  }
  console.log(chalk.bold.cyan(`\n🛡️ 3. DÉTAIL DES ${falsePositives.length} FAUX POSITIFS ÉLIMINÉS :`));
  for (const [classification, items] of fpByClassification.entries()) {
    let frenchCategory = classification;
    if (classification === 'EXISTS_RULE_SCOPE') frenchCategory = 'Fichiers ciblés par la règle Cursor';
    else if (classification === 'SQL_DATABASE_ENTITY') frenchCategory = 'Colonnes de base de données (ex: rides.price)';
    else if (classification === 'EXISTS_SINGLE_MATCH') frenchCategory = 'Fichiers cités sans préfixe de dossier';
    else if (classification === 'PATH_ALIAS') frenchCategory = 'Alias TypeScript (@/components/...)';
    else if (classification === 'PATTERN_OR_I18N') frenchCategory = 'Wildcard ou clé i18n (t.admin.*)';

    console.log(`  ${chalk.green('✓')} ${chalk.bold(frenchCategory)} : ${items.length}`);
    for (const item of items.slice(0, 1)) {
      console.log(`     ${chalk.gray('↳')} ${item.targetRef || item.raw.message} → ${chalk.dim(item.explanation)}`);
    }
  }

  console.log(chalk.bold.yellow('\n💡 4. AMÉLIORATION RECOMMANDÉE :'));
  for (const change of recipe.summaryChanges) {
    console.log(`  ${chalk.cyan('✦')} ${chalk.white(change)}`);
  }

  const approxTokens = (text: string) => Math.ceil(text.length / 4);
  const existingAgentsPath = path.join(repoPath, 'AGENTS.md');
  const existingAgents = fs.existsSync(existingAgentsPath) ? fs.readFileSync(existingAgentsPath, 'utf-8') : '';
  console.log(chalk.bold.green('\n📏 5. FAITS MESURÉS (aucune économie de tokens n\'est estimée) :'));
  console.log(`  ${chalk.green('•')} ${chalk.bold('Références reclassées')}   : ${falsePositives.length} constat(s) du rapport importé`);
  console.log(`  ${chalk.green('•')} ${chalk.bold('AGENTS.md actuel')}       : ${existingAgents ? `${existingAgents.length} car. (~${approxTokens(existingAgents)} tokens)` : 'absent'}`);
  console.log(`  ${chalk.green('•')} ${chalk.bold('AGENTS.md proposé')}      : ${recipe.agentsMdContent.length} car. (~${approxTokens(recipe.agentsMdContent)} tokens, estimation car./4)`);
  console.log(chalk.dim('    Ce fichier peut être chargé dans chaque prompt : un fichier plus long coûte des tokens, il n\'en économise pas.'));

  // HTML Report generation if requested
  if (options.html) {
    const reportDir = path.join(repoPath, '.repotwin');
    fs.mkdirSync(reportDir, { recursive: true, mode: 0o700 });
    const reportPath = path.join(reportDir, 'report.html');
    generateHtmlReport({
      repoPath,
      scores,
      subprojects,
      falsePositives,
      trueIssues,
      proposedFixes: recipe.summaryChanges,
      newAgentsMd: recipe.agentsMdContent
    }, reportPath);

    console.log(chalk.bold.green(`\nHTML report generated: ${chalk.underline(reportPath)}`));
  }

  console.log(chalk.bold.cyan('\n🚀 6. ACTIONS EN 1 CLIC :'));
  console.log(`  • Generate an HTML report: ${chalk.bold.cyan('repotwin analyze --html')}`);
  console.log(`  • Preview the proposed instruction files: ${chalk.bold.yellow('repotwin fix')}`);
  console.log(`  • Apply after review: ${chalk.bold.yellow('repotwin fix --apply')}`);
  console.log(`  • Tester dans un jumeau isolé : ${chalk.bold.yellow(`node dist/index.js twin create "${repoPath}"`)}\n`);
}

program
  .command('analyze [repoPath]')
  .description('Analyze a repository and show before/after readiness scores')
  .option('-r, --from-report <reportFile>', 'Path to an agent report')
  .option('--html', 'Generate an HTML report')
  .option('--json', 'Output results as JSON')
  .action((repoPath, options, command) => {
    // If repoPath was omitted, commander might pass options in repoPath
    if (typeof repoPath === 'object' && repoPath !== null) {
      runAnalyze(process.cwd(), optionsFrom(repoPath, options, command));
    } else {
      runAnalyze(repoPath, optionsFrom(options, command));
    }
  });

program
  .command('fix')
  .description('Preview instruction changes; use --apply to write with backups')
  .argument('[repoPath]', 'Path to repository root (defaults to current directory)')
  .option('--apply', 'Write the generated files after the preview')
  .action((repoPathArg, options, command) => {
    const repoPath = path.resolve(repoPathArg || process.cwd());
    assertDirectory(repoPath);
    const subprojects = discoverSubprojects(repoPath);
    const recipe = generateOptimizationRecipe(repoPath, subprojects, []);
    const parsedOptions = optionsFrom(options, command);
    previewOrApplyRecipe(repoPath, recipe, parsedOptions.apply === true);
  });

program
  .command('twin')
  .description('Manage experimental twins (isolated Git worktrees)')
  .argument('<action>', 'Action to perform: "create", "apply", or "clean"')
  .argument('[repoPath]', 'Path to repository root (defaults to current directory)')
  .action((action, repoPathArg) => {
    const repoPath = path.resolve(repoPathArg || process.cwd());

    if (action === 'clean') {
      const result = cleanTwins(repoPath);
      console.log(chalk.green(`\n🧹 Cleaned up ${result.cleaned} RepoTwin experimental worktrees.`));
      if (result.skippedDirty) console.log(chalk.yellow(`Skipped ${result.skippedDirty} dirty twin(s) to preserve their changes.`));
      return;
    }

    const subprojects = discoverSubprojects(repoPath);
    const recipe = generateOptimizationRecipe(repoPath, subprojects, []);

    if (action === 'create') {
      console.log(chalk.cyan('\n🧬 Creating isolated Candidate Twin (Git Worktree)...'));
      const twin = createCandidateTwin(repoPath, recipe);
      console.log(chalk.green(`\n✅ Twin created successfully!`));
      console.log(`  • Twin Path   : ${chalk.bold(twin.twinPath)}`);
      console.log(`  • Branch      : ${chalk.bold(twin.branchName)}`);
      console.log(`  • Modified    : ${twin.filesModified.join(', ')}`);
      console.log('Candidate created. Review its diff and run verification before applying.');
      console.log(chalk.gray(`Your main branch remains completely untouched.`));
      console.log(`To clean up this twin later, run: node dist/index.js twin clean\n`);
      return;
    }

    if (action === 'apply') {
      throw new Error('`twin apply` is intentionally disabled. Review the isolated twin, then use `repotwin fix --apply` on the target repository.');
    }

    console.error(chalk.red(`Unknown action "${action}". Use "create", "apply", or "clean".`));
  });

program
  .command('ui [repoPath]')
  .alias('studio')
  .description('Launch interactive RepoTwin Studio web UI with live action buttons')
  .option('-p, --port <number>', 'Port to listen on', '4242')
  .option('-r, --from-report <reportFile>', 'Explicit agent report, shared with analyze')
  .action((repoPathArg, options) => {
    const repoPath = path.resolve(repoPathArg || process.cwd());
    const port = parseInt(options.port || '4242', 10);
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Port must be between 1 and 65535');
    assertDirectory(repoPath);
    const reportPath = optionsFrom(options, program).fromReport;
    startDevServer(repoPath, port, reportPath ? path.resolve(reportPath) : undefined);
  });

// Default action: if no command is given, run analyze on current dir or repo
program.command('verify [repoPath]')
  .description('Run fresh instruction-file checks; does not execute project scripts')
  .action((repoPathArg) => {
    const repoPath = path.resolve(repoPathArg || process.cwd());
    assertDirectory(repoPath);
    const result = auditInstructions(repoPath, discoverSubprojects(repoPath));
    console.log(JSON.stringify(result, null, 2));
    if (result.findings.length) process.exitCode = 1;
  });

program
  .argument('[repoPath]', 'Open Studio for a repository from any working directory')
  .action((repoPathArg, options) => {
    const repoPath = path.resolve(repoPathArg || process.cwd());
    assertDirectory(repoPath);
    const parsed = optionsFrom(options, program);
    if (parsed.json || parsed.html || parsed.fromReport) runAnalyze(repoPath, parsed);
    else startDevServer(repoPath);
  });

program.parse(process.argv);
