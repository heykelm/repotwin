import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import crypto from 'node:crypto';
import { RepositorySnapshot, Finding } from '../types/contracts.js';
import { discoverSubprojects } from '../analyzer/subproject-scanner.js';
import { scanRules } from '../analyzer/rules-scanner.js';

export function getGitInfo(repoPath: string): { commitSha: string; branch: string; isDirty: boolean } {
  try {
    const commitSha = execSync('git rev-parse HEAD', { cwd: repoPath, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    const branch = execSync('git rev-parse --abbrev-ref HEAD', { cwd: repoPath, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    const status = execSync('git status --porcelain', { cwd: repoPath, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    return {
      commitSha: commitSha || 'unknown',
      branch: branch || 'HEAD',
      isDirty: status.length > 0
    };
  } catch {
    return {
      commitSha: 'untracked',
      branch: 'none',
      isDirty: false
    };
  }
}

export function computeRepositoryFingerprint(repoPath: string, commitSha: string): string {
  const hash = crypto.createHash('sha256');
  hash.update(path.resolve(repoPath));
  hash.update(commitSha);
  return hash.digest('hex').substring(0, 16);
}

export function inspectRepository(repoPath: string): RepositorySnapshot {
  const resolved = path.resolve(repoPath);
  const gitInfo = getGitInfo(resolved);
  const fingerprint = computeRepositoryFingerprint(resolved, gitInfo.commitSha);
  const subprojects = discoverSubprojects(resolved);
  const rules = scanRules(resolved);

  // Discover agent instruction files
  const candidateFiles = [
    'AGENTS.md',
    'CLAUDE.md',
    'GEMINI.md',
    '.cursorrules',
    'README.md'
  ];

  const instructionFiles: Array<{ path: string; sizeBytes: number; linesCount: number }> = [];

  for (const rel of candidateFiles) {
    const full = path.join(resolved, rel);
    if (fs.existsSync(full) && fs.statSync(full).isFile()) {
      const content = fs.readFileSync(full, 'utf-8');
      instructionFiles.push({
        path: rel,
        sizeBytes: Buffer.byteLength(content, 'utf-8'),
        linesCount: content.split('\n').length
      });
    }
  }

  // Also check .cursor/rules/* if any
  const cursorRulesDir = path.join(resolved, '.cursor', 'rules');
  if (fs.existsSync(cursorRulesDir) && fs.statSync(cursorRulesDir).isDirectory()) {
    try {
      const files = fs.readdirSync(cursorRulesDir);
      for (const f of files) {
        if (f.endsWith('.md') || f.endsWith('.mdc')) {
          const full = path.join(cursorRulesDir, f);
          const content = fs.readFileSync(full, 'utf-8');
          instructionFiles.push({
            path: path.join('.cursor', 'rules', f),
            sizeBytes: Buffer.byteLength(content, 'utf-8'),
            linesCount: content.split('\n').length
          });
        }
      }
    } catch {
      // ignore read issues
    }
  }

  const findings: Finding[] = [];

  // Static rule: check for excessive instruction volume (> 50KB or > 1200 lines total across prompt files)
  const totalSizeBytes = instructionFiles.reduce((acc, f) => acc + f.sizeBytes, 0);
  if (totalSizeBytes > 50000) {
    findings.push({
      id: 'finding-excessive-instruction-volume',
      ruleId: 'context/instruction-volume',
      severity: 'medium',
      evidenceKind: 'heuristic',
      status: 'suspected',
      summary: `Large instruction volume detected (${Math.round(totalSizeBytes / 1024)} KB across ${instructionFiles.length} files)`,
      locations: instructionFiles.map(f => ({ path: f.path })),
      explanation: 'Extensive instruction contexts increase base prompt size and cache footprint. Verify if legacy rules can be pruned or modularized.',
      suggestedAction: 'Consolidate redundant guidance and archive deprecated agent instructions.'
    });
  }

  // Check for duplicate rules / instructions
  const ruleList = Array.from(rules.values());
  if (ruleList.length > 1) {
    const fileNames = ruleList.map(r => path.basename(r.file));
    const duplicates = fileNames.filter((name, idx) => fileNames.indexOf(name) !== idx);
    if (duplicates.length > 0) {
      findings.push({
        id: 'finding-duplicate-rule-names',
        ruleId: 'context/duplicate-rules',
        severity: 'low',
        evidenceKind: 'heuristic',
        status: 'confirmed',
        summary: `Duplicate rule definitions found for: ${Array.from(new Set(duplicates)).join(', ')}`,
        locations: ruleList.filter(r => duplicates.includes(path.basename(r.file))).map(r => ({ path: r.file })),
        explanation: 'Multiple rule files sharing identical base names across scopes may cause precedence ambiguity for AI agents.',
        suggestedAction: 'Ensure rule scopes and targets are uniquely distinguished.'
      });
    }
  }

  return {
    schemaVersion: '1',
    repoPath: resolved,
    commitSha: gitInfo.commitSha,
    branch: gitInfo.branch,
    isDirty: gitInfo.isDirty,
    fingerprint,
    scannedAt: new Date().toISOString(),
    subprojects: subprojects.map(s => ({
      name: s.name,
      relPath: s.relPath,
      kind: s.kind,
      testScript: s.testScript
    })),
    instructionFiles,
    findings
  };
}
