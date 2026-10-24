import { auditInstructions } from '../analyzer/instruction-audit.js';
import { ValidationCommand, ValidationResult } from './command-runner.js';

type Audit = ReturnType<typeof auditInstructions>;

export function compareInstructionAudits(before: Audit, after: Audit) {
  const same = (a: Audit['findings'][number], b: Audit['findings'][number]) => a.file === b.file && a.rule === b.rule && a.message === b.message;
  return {
    introduced: after.findings.filter(finding => !before.findings.some(previous => same(previous, finding))),
    resolved: before.findings.filter(previous => !after.findings.some(finding => same(previous, finding)))
  };
}

export function allCommandsPassed(plan: ValidationCommand[], results: ValidationResult[]): boolean {
  return results.length === plan.length && plan.every(command => results.some(result => result.id === command.id && result.status === 'passed'));
}
