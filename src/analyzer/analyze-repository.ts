import { discoverSubprojects, buildFileIndex, discoverKnownTables } from './subproject-scanner.js';
import { scanRules } from './rules-scanner.js';
import { parseAgentReport } from './report-parser.js';
import { disambiguateFinding } from '../diagnostics/disambiguator.js';
import { calculateScores } from '../diagnostics/score.js';
import { generateOptimizationRecipe } from '../generator/recipe-agents-md.js';
import { auditInstructions } from './instruction-audit.js';

export function analyzeRepository(repoPath: string, reportPath?: string) {
  const subprojects = discoverSubprojects(repoPath);
  const fileSet = buildFileIndex(repoPath, subprojects);
  const rules = scanRules(repoPath);
  const knownTables = discoverKnownTables(repoPath, fileSet);
  const findings = reportPath ? parseAgentReport(reportPath) : [];
  const processed = findings.map(raw => disambiguateFinding(raw, { fileSet, rules, subprojects, knownTables }));
  return {
    repoPath,
    subprojects,
    findings,
    processed,
    falsePositives: processed.filter(f => f.isFalsePositive),
    trueIssues: processed.filter(f => !f.isFalsePositive),
    scores: calculateScores(processed, reportPath !== undefined),
    recipe: generateOptimizationRecipe(repoPath, subprojects, processed),
    instructionAudit: auditInstructions(repoPath, subprojects)
  };
}
