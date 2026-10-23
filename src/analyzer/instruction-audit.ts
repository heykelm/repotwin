import fs from 'node:fs';
import path from 'node:path';
import { RawFinding, SubprojectInfo } from '../types/index.js';
import { calculateScores } from '../diagnostics/score.js';

/** A fresh, narrowly scoped audit of instruction files, not of application correctness. */
export function auditInstructions(repoPath: string, projects: SubprojectInfo[]) {
  const findings: RawFinding[] = [];
  const add = (rule: string, file: string, message: string) => findings.push({ rule, file, message, severity: 'warning', fix: '' });
  const agentsPath = path.join(repoPath, 'AGENTS.md');
  const agents = fs.existsSync(agentsPath) ? fs.readFileSync(agentsPath, 'utf8') : '';
  if (!agents.trim()) add('missing-agent-instructions', 'AGENTS.md', 'No central agent instructions found.');
  if (!/secret|credential|confidentiel/i.test(agents) || !/destruct|consent|approval/i.test(agents)) {
    add('missing-safety-section', 'AGENTS.md', 'Secret handling and destructive-operation boundaries are not both documented.');
  }
  if (!/verification|vérification|test commands|tests/i.test(agents)) {
    add('missing-verification-section', 'AGENTS.md', 'No verification guidance found.');
  }
  for (const project of projects) {
    if (project.testScript && (!agents.includes(project.testScript) || (project.relPath !== '.' && !agents.includes(project.relPath)))) {
      add('undocumented-test-command', 'AGENTS.md', `Test command not documented for ${project.relPath}: ${project.testScript}`);
    }
  }
  if (!projects.some(project => project.testScript)) {
    add('missing-test-command', 'package manifests', 'No test command detected. Writing documentation does not create tests.');
  }
  const configPath = path.join(repoPath, 'agent-ready.json');
  try {
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    if (!config || typeof config !== 'object' || Array.isArray(config)) throw new Error('object required');
  } catch {
    add('invalid-agent-config', 'agent-ready.json', 'Agent configuration is missing or is not a JSON object.');
  }
  const scores = calculateScores(findings.map(raw => ({ raw, classification: 'UNKNOWN' as const, isFalsePositive: false, confidence: 1, explanation: raw.message })), true);
  return { scope: 'instruction-files' as const, findings, scores, testsExecuted: false as const };
}
