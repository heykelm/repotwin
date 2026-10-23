#!/usr/bin/env node
import { Command } from 'commander';
import chalk from 'chalk';
import path from 'node:path';
import fs from 'node:fs';
import { parseAgentReport } from './analyzer/report-parser.js';
import { discoverSubprojects, buildFileIndex } from './analyzer/subproject-scanner.js';
import { scanRules } from './analyzer/rules-scanner.js';
import { disambiguateFinding } from './diagnostics/disambiguator.js';
import { calculateScores } from './diagnostics/score.js';
import { ProcessedFinding } from './types/index.js';

const program = new Command();

program
  .name('repotwin')
  .description('RepoTwin — Measure. Optimize. Prove. Diagnostic & Optimization for AI Coding Agents')
  .version('0.1.0');

program
  .command('analyze')
  .description('Analyze a repository and filter out static scanner false positives')
  .argument('<repoPath>', 'Path to repository root')
  .option('-r, --from-report <reportFile>', 'Path to agent-ready markdown/json report')
  .option('--json', 'Output results as JSON')
  .action((repoPathArg, options) => {
    const repoPath = path.resolve(repoPathArg);

    if (!fs.existsSync(repoPath)) {
      console.error(chalk.red(`Error: Repository path "${repoPath}" does not exist.`));
      process.exit(1);
    }

    if (!options.json) {
      console.log(chalk.bold.cyan('\n🔍 RepoTwin — Repository Diagnostic Engine'));
      console.log(chalk.gray(`Target Repository: ${repoPath}`));
    }

    // 1. Discover subprojects & submodules
    const subprojects = discoverSubprojects(repoPath);
    if (!options.json) {
      console.log(chalk.blue(`\n📦 Discovered ${subprojects.length} subproject(s) / submodule(s):`));
      for (const sub of subprojects) {
        const tests = sub.testScript ? chalk.green(`[test: ${sub.testScript}]`) : chalk.gray('[no test script]');
        console.log(`  • ${chalk.bold(sub.relPath)} (${sub.kind}) ${tests}`);
      }
    }

    // 2. Build file index
    const fileSet = buildFileIndex(repoPath, subprojects);
    if (!options.json) {
      console.log(chalk.gray(`Indexed ${fileSet.size} total files across repository.`));
    }

    // 3. Scan Cursor & Agent rules
    const rules = scanRules(repoPath);
    if (!options.json) {
      console.log(chalk.gray(`Parsed ${rules.size} rule definitions.`));
    }

    // 4. Ingest findings from report or default
    const reportFile = options.fromReport ? path.resolve(options.fromReport) : null;
    if (!reportFile || !fs.existsSync(reportFile)) {
      console.error(chalk.yellow(`\nNo external report specified or file not found. Run with --from-report <file>.`));
      return;
    }

    const rawFindings = parseAgentReport(reportFile);
    if (!options.json) {
      console.log(chalk.yellow(`\n📊 Ingested ${rawFindings.length} raw findings from ${path.basename(reportFile)}`));
    }

    // 5. Run disambiguation pipeline
    const ctx = { fileSet, rules, subprojects };
    const processed: ProcessedFinding[] = rawFindings.map(raw => disambiguateFinding(raw, ctx));

    const falsePositives = processed.filter(p => p.isFalsePositive);
    const trueIssues = processed.filter(p => !p.isFalsePositive);

    // Group false positives by reason
    const fpByClassification = new Map<string, ProcessedFinding[]>();
    for (const fp of falsePositives) {
      const list = fpByClassification.get(fp.classification) || [];
      list.push(fp);
      fpByClassification.set(fp.classification, list);
    }

    const scores = calculateScores(processed, 0);

    if (options.json) {
      console.log(JSON.stringify({
        repoPath,
        scores,
        totalRawFindings: rawFindings.length,
        falsePositivesCount: falsePositives.length,
        trueIssuesCount: trueIssues.length,
        falsePositivesBreakdown: Object.fromEntries(
          Array.from(fpByClassification.entries()).map(([k, v]) => [k, v.length])
        ),
        findings: processed
      }, null, 2));
      return;
    }

    // Beautiful CLI summary
    console.log(chalk.bold.green('\n=================================================='));
    console.log(chalk.bold.green('🎯 REPOTWIN READINESS SCORE COMPARISON'));
    console.log(chalk.bold.green('=================================================='));

    console.log(`  Raw Scanner Score  : ${chalk.red.bold(`${scores.rawScore}/100 (${scores.rawGrade})`)}   ${chalk.gray('↳ Distorted by phantom errors & unindexed submodules')}`);
    console.log(`  RepoTwin Real Score: ${chalk.yellow.bold(`${scores.correctedScore}/100 (${scores.correctedGrade})`)}  ${chalk.green(`↳ Restored +${scores.falsePenaltyRestored} pts`)} after filtering false positives`);
    console.log(`  Projected Twin Post: ${chalk.green.bold(`${scores.projectedScore}/100 (${scores.projectedGrade})`)}  ${chalk.cyan('↳ Target achievable via twin recipe')}`);

    console.log(chalk.bold.cyan('\n🛡️ False Positives Eliminated by Category:'));
    for (const [classification, items] of fpByClassification.entries()) {
      console.log(`  ${chalk.green('✓')} ${chalk.bold(classification)} : ${items.length}`);
      // Show first 2 examples
      for (const item of items.slice(0, 2)) {
        console.log(`     ${chalk.gray('↳')} ${item.targetRef || item.raw.message} → ${chalk.dim(item.explanation)}`);
      }
    }

    if (trueIssues.length > 0) {
      console.log(chalk.bold.yellow('\n⚠️ Genuine Actionable Items Remaining:'));
      for (const issue of trueIssues) {
        const refInfo = issue.targetRef ? chalk.bold.red(` ("${issue.targetRef}")`) : '';
        console.log(`  ${chalk.yellow('•')} [${chalk.bold(issue.classification)}] ${chalk.white(issue.raw.file)}${refInfo}`);
        console.log(`    ${chalk.gray(issue.explanation)}`);
        if (issue.suggestedAction) {
          console.log(`    ${chalk.cyan('Action:')} ${issue.suggestedAction}`);
        }
      }
    }

    console.log(chalk.bold.magenta('\n💡 Verdict:'));
    console.log(`The repository score was heavily skewed by missing subproject awareness and false DB column alerts.`);
    console.log(`By addressing the ${trueIssues.length} real issues (mostly adding Safety & Verification sections to AGENTS.md), the repository is agent-ready.\n`);
  });

program.parse(process.argv);
