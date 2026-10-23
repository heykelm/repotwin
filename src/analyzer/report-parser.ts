import fs from 'node:fs';
import { RawFinding, Severity } from '../types/index.js';

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
      const findings = Array.isArray(parsed) ? parsed : (parsed.findings || []);
      return findings.map((f: any) => ({
        severity: (f.severity || 'info') as Severity,
        rule: f.rule || '',
        message: f.message || '',
        file: f.file || '',
        fix: f.fix || ''
      }));
    } catch {
      // Fallback to markdown table parsing
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
