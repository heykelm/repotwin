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
  }

  // 1. Build Subprojects & Commands Matrix
  const subprojectRows = subprojects.map(sub => {
    const testCmd = sub.testScript ? `\`cd ${sub.relPath} && ${sub.testScript}\`` : '*(none configured)*';
    const buildCmd = sub.buildScript ? `\`cd ${sub.relPath} && ${sub.buildScript}\`` : '*(none configured)*';
    return `| **${sub.name}** (\`${sub.relPath}/\`) | ${sub.kind} | ${testCmd} | ${buildCmd} |`;
  }).join('\n');

  // 2. Build Safety Boundaries Section
  const safetySection = `
## 🔒 Safety Boundaries (Mandatory for AI Agents)
- **Secrets & Credentials :** NEVER commit, print, or log real secrets, private keys (\`*.p8\`, \`*.pem\`, \`*.key\`), or live API credentials (\`.env.stripe.live\`).
- **Destructive Commands :** NEVER execute destructive database or driver scripts (e.g. \`delete_driver*.js\`, \`clear_stripe_ids*.js\`) without explicit user consent.
- **Production Isolation :** Always verify that environment targets development or local mock before executing mutations.
`.trim();

  // 3. Build Verification Section
  const verificationSection = `
## 🧪 Verification & Test Commands
Always verify changes before marking a task complete:

| Subproject | Type | Test Command | Build Command |
| :--- | :--- | :--- | :--- |
${subprojectRows}
`.trim();

  // 4. Build Architecture & Central Source of Truth Section
  const architectureSection = `
## 🗺️ Project Architecture & Rules Centralization
- **Multi-Project Structure :** This repository contains multiple focused subprojects. Do not look for root configurations. Always navigate into the relevant subproject directory.
- **Cursor Rules Pointer :** Specific domain rules in \`.cursor/rules/*.mdc\` defer to this document for safety and test commands.
`.trim();

  // Combine into canonical AGENTS.md
  let canonicalAgentsMd = `# NiceHub Platform — Canonical AI Agent Instructions\n\n`;
  canonicalAgentsMd += `${architectureSection}\n\n`;
  canonicalAgentsMd += `${safetySection}\n\n`;
  canonicalAgentsMd += `${verificationSection}\n\n`;

  if (existingContent) {
    canonicalAgentsMd += `## 📋 Existing Repository Directives\n${existingContent}\n`;
  }

  summaryChanges.push('Added explicit Safety Boundaries section (protects live keys and destructive scripts)');
  summaryChanges.push('Documented discovered test & build commands across all 4 subprojects');
  summaryChanges.push('Added Architecture map clarifying subprojects location');

  // 5. Build agent-ready.json
  const agentReadyConfig = {
    $schema: "https://agent-ready.dev/schema.json",
    version: "1.0",
    monorepo: true,
    projects: subprojects.map(s => ({
      name: s.name,
      path: s.relPath,
      language: s.kind,
      test: s.testScript || undefined,
      build: s.buildScript || undefined
    })),
    verification: {
      backend: "cd backend && npm test",
      flutter: "cd flutter && flutter test"
    },
    safety: {
      protectedPaths: [
        ".env.stripe.live*",
        "*.p8",
        "*.pem"
      ]
    }
  };

  const agentReadyJsonContent = JSON.stringify(agentReadyConfig, null, 2);
  summaryChanges.push('Generated agent-ready.json configuration for third-party scanners');

  return {
    agentsMdContent: canonicalAgentsMd,
    agentReadyJsonContent,
    summaryChanges
  };
}
