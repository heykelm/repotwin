import fs from 'node:fs';
import { z } from 'zod';
import { RawFinding, Severity } from '../types/index.js';

const rawFindingSchema = z.object({
  severity: z.enum(['error', 'warning', 'info']).default('info'),
  rule: z.string().default(''),
  message: z.string().default(''),
  file: z.string().default(''),
  fix: z.string().default('')
});

const jsonReportSchema = z.union([
  z.array(rawFindingSchema),
  z.object({ findings: z.array(rawFindingSchema) })
]);

/**
 * Parses an agent-ready markdown report table or JSON export.
 */
export function parseAgentReport(reportPath: string): RawFinding[] {
  if (!fs.existsSync(reportPath)) {
    throw new Error(`Report file not found: ${reportPath}`);
  }

  const content = fs.readFileSync(reportPath, 'utf-8');

  // Try JSON first if file starts with { or [
  const trimmed = content.trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed);
      const validated = jsonReportSchema.parse(parsed);
      const findings = Array.isArray(validated) ? validated : validated.findings;
      return findings.map(finding => ({ ...finding, severity: finding.severity as Severity }));
    } catch (error) {
      throw new Error(`Invalid JSON report: ${error instanceof Error ? error.message : 'unknown error'}`);
    }
  }

  // Parse markdown table
  // Example row: | warning | stale-path-reference | .cursor/rules/b2b-koi.mdc references missing path "rides.price". | .cursor/rules/b2b-koi.mdc | Update or remove the stale path reference. |
  const findings: RawFinding[] = [];
  const lines = content.split('\n');

  let inFindingsSection = false;

  for (const line of lines) {
    const trimmedLine = line.trim();

    if (trimmedLine.startsWith('## Findings')) {
      inFindingsSection = true;
      continue;
    }

    if (inFindingsSection && trimmedLine.startsWith('## ')) {
      // End of findings section
      break;
    }

    if (!trimmedLine.startsWith('|')) continue;

    const parts = trimmedLine
      .split('|')
      .map(p => p.trim())
      .filter((_, idx, arr) => idx > 0 && idx < arr.length - 1);

    if (parts.length < 5) continue;

    const [severityStr, rule, message, file, fix] = parts;

    // Skip table header and separator
    if (severityStr.toLowerCase() === 'severity' || severityStr.includes('---')) {
      continue;
    }

    const severity = (['error', 'warning', 'info'].includes(severityStr.toLowerCase())
      ? severityStr.toLowerCase()
      : 'info') as Severity;

    findings.push({
      severity,
      rule,
      message,
      file,
      fix
    });
  }

  return findings;
}
