import fs from 'node:fs';
import path from 'node:path';
import { SubprojectInfo, ProcessedFinding } from '../types/index.js';

export interface GeneratedRecipe {
  agentsMdContent: string;
  agentReadyJsonContent: string;
  summaryChanges: string[];
}

/**
 * Generates an optimized, canonical AGENTS.md and agent-ready.json
 * based on the discovered subprojects and findings.
 */
export function generateOptimizationRecipe(
  repoPath: string,
  subprojects: SubprojectInfo[],
  findings: ProcessedFinding[]
): GeneratedRecipe {
  const summaryChanges: string[] = [];

  // Read existing AGENTS.md if present
  const existingAgentsMdPath = path.join(repoPath, 'AGENTS.md');
  let existingContent = '';
  if (fs.existsSync(existingAgentsMdPath)) {
    existingContent = fs.readFileSync(existingAgentsMdPath, 'utf-8').trim();
    existingContent = existingContent.replace(/<!-- repotwin:start -->[\s\S]*?<!-- repotwin:end -->\s*/g, '').trim();
  }

  // 1. Build Subprojects & Commands Matrix
  const subprojectRows = subprojects.map(sub => {
    const quotedPath = `'${sub.relPath.replace(/'/g, "'\\''")}'`;
    const testCmd = sub.testScript ? `\`cd ${quotedPath} && ${sub.testScript}\`` : '*(none configured)*';
    const lintCmd = sub.lintScript ? `\`cd ${quotedPath} && ${sub.lintScript}\`` : '*(none configured)*';
    const buildCmd = sub.buildScript ? `\`cd ${quotedPath} && ${sub.buildScript}\`` : '*(none configured)*';
    return `| **${sub.name}** (\`${sub.relPath}/\`) | ${sub.kind} | ${testCmd} | ${lintCmd} | ${buildCmd} |`;
  }).join('\n');

  // 2. Build Safety Boundaries Section
  const safetySection = `
## 🔒 Safety Boundaries (Mandatory for AI Agents)
- **Secrets & Credentials :** NEVER commit, print, or log real secrets, private keys (\`*.p8\`, \`*.pem\`, \`*.key\`), or credentials from environment files (\`.env*\`).
- **Destructive Commands :** NEVER execute destructive database or filesystem operations without explicit user consent.
- **Production Isolation :** Always verify that environment targets development or local mock before executing mutations.
`.trim();

  // 3. Build Verification Section
  const verificationSection = `
## 🧪 Verification & Test Commands
Always verify changes before marking a task complete:

| Subproject | Type | Test Command | Lint Command | Build Command |
| :--- | :--- | :--- | :--- | :--- |
${subprojectRows}
`.trim();

  // 4. Build Architecture & Central Source of Truth Section
  const isSharedRepo = path.basename(repoPath).toLowerCase().includes('shared') || subprojects.some(s => s.name.toLowerCase().includes('shared'));
  const sharedSection = isSharedRepo ? `
## 🧩 Shared Components & Contract Stability (Multi-Project)
- **Shared Library Role :** This repository contains shared components and utilities consumed by multiple downstream projects.
- **Contract Stability :** Never modify or remove exported symbols, component props, or public API signatures without preserving backward compatibility.
- **Build Verification :** Run tests and verify the build before promoting changes to consumer projects.
`.trim() : '';

  const architectureSection = `
## 🗺️ Project Architecture & Rules Centralization
- **Project Structure :** Use the discovered project paths below, including the repository root when listed.
- **Cursor Rules Pointer :** Specific domain rules in \`.cursor/rules/*.mdc\` defer to this document for safety and test commands.
`.trim();

  // Combine into canonical AGENTS.md
  let canonicalAgentsMd = `<!-- repotwin:start -->\n# AI Agent Instructions\n\n`;
  canonicalAgentsMd += `${architectureSection}\n\n`;
  if (sharedSection) canonicalAgentsMd += `${sharedSection}\n\n`;
  canonicalAgentsMd += `${safetySection}\n\n`;
  canonicalAgentsMd += `${verificationSection}\n\n`;

  canonicalAgentsMd += `<!-- repotwin:end -->\n`;
  if (existingContent) canonicalAgentsMd += `\n${existingContent}\n`;

  summaryChanges.push('Adds explicit safety boundaries for secrets and destructive operations');
  summaryChanges.push(`Documents test and build commands for ${subprojects.length} discovered subproject${subprojects.length === 1 ? '' : 's'}`);
  summaryChanges.push('Adds an architecture map for the discovered projects');
  if (isSharedRepo) {
    summaryChanges.push('Adds shared components contract stability rules for multi-project consumers');
  }

  // 5. Build agent-ready.json
  const configPath = path.join(repoPath, 'agent-ready.json');
  const existingConfig = fs.existsSync(configPath) ? JSON.parse(fs.readFileSync(configPath, 'utf-8')) : {};
  if (!existingConfig || typeof existingConfig !== 'object' || Array.isArray(existingConfig)) throw new Error('agent-ready.json must contain an object');
  const agentReadyConfig = {
    ...existingConfig,
    $schema: "https://agent-ready.dev/schema.json",
    version: "1.0",
    monorepo: subprojects.length > 1,
    projects: subprojects.map(s => ({
      name: s.name,
      path: s.relPath,
      language: s.kind,
      test: s.testScript || undefined,
      lint: s.lintScript || undefined,
      build: s.buildScript || undefined
    })),
    verification: Object.fromEntries(subprojects.flatMap(s => {
      const commands = [s.testScript, s.lintScript, s.buildScript].filter((command): command is string => Boolean(command));
      return commands.length ? [[s.relPath, commands.map(command => `cd '${s.relPath.replace(/'/g, "'\\''")}' && ${command}`)]] : [];
    })),
    safety: {
      ...(existingConfig.safety && typeof existingConfig.safety === 'object' && !Array.isArray(existingConfig.safety) ? existingConfig.safety : {}),
      protectedPaths: [...new Set([
        ".env*",
        "*.p8",
        "*.pem",
        "*.key",
        ...(Array.isArray(existingConfig.safety?.protectedPaths) ? existingConfig.safety.protectedPaths.filter((value: unknown) => typeof value === 'string') : [])
      ])]
    }
  };

  const agentReadyJsonContent = JSON.stringify(agentReadyConfig, null, 2);
  summaryChanges.push('Generates agent-ready.json for compatible third-party scanners');

  return {
    agentsMdContent: canonicalAgentsMd,
    agentReadyJsonContent,
    summaryChanges
  };
}
