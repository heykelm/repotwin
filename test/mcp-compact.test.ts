import { afterEach, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createMcpServer } from '../src/mcp/server.js';

const directories: string[] = [];

function git(repo: string, args: string[]): void {
  execFileSync('git', ['-C', repo, ...args], { stdio: 'ignore' });
}

function repository(): string {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'repotwin-mcp-compact-'));
  directories.push(repo);
  git(repo, ['init']);
  git(repo, ['config', 'user.email', 'test@example.com']);
  git(repo, ['config', 'user.name', 'RepoTwin test']);
  fs.writeFileSync(path.join(repo, 'README.md'), '# fixture\n');
  git(repo, ['add', 'README.md']);
  git(repo, ['commit', '-m', 'initial']);
  return repo;
}

function payload(result: Awaited<ReturnType<Client['callTool']>>): any {
  const first = result.content[0];
  if (!first || first.type !== 'text') throw new Error('Expected text result');
  return JSON.parse(first.text);
}

afterEach(() => {
  delete process.env.REPOTWIN_TWINS_DIR;
  for (const directory of directories.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

describe('MCP Compact & Token Efficiency Tools', () => {
  it('exposes repotwin_token_audit tool and returns repository token score', async () => {
    const repo = repository();
    fs.writeFileSync(path.join(repo, 'AGENTS.md'), '# Test Instructions\nKeep clean.\n');

    const server = createMcpServer(repo);
    const client = new Client({ name: 'test-client-audit', version: '1.0.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    const tools = await client.listTools();
    const tokenAuditTool = tools.tools.find(t => t.name === 'repotwin_token_audit');
    expect(tokenAuditTool).toBeDefined();

    const result = payload(await client.callTool({
      name: 'repotwin_token_audit',
      arguments: { repoPath: repo }
    }));

    expect(result.score).toBeGreaterThanOrEqual(90);
    expect(result.grade).toBe('A');
    expect(result.totalInstructionTokens).toBeGreaterThan(0);
    expect(result.recommendations.length).toBeGreaterThan(0);

    await client.close();
  });

  it('runs repotwin_run_checks with compact mode enabled by default', async () => {
    const repo = repository();
    const twins = fs.mkdtempSync(path.join(os.tmpdir(), 'repotwin-mcp-cache-'));
    directories.push(twins);
    process.env.REPOTWIN_TWINS_DIR = twins;

    const server = createMcpServer(repo);
    const client = new Client({ name: 'test-client-compact-checks', version: '1.0.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    const created = payload(await client.callTool({
      name: 'repotwin_create_twin',
      arguments: { repoPath: repo }
    }));

    const verified = payload(await client.callTool({
      name: 'repotwin_run_checks',
      arguments: { candidateId: created.candidateId, commandConsent: created.commandConsent }
    }));

    expect(verified.canApply).toBe(true);
    expect(verified.tokenEfficiency).toBeDefined();
    expect(verified.tokenEfficiency.compactMode).toBe(true);

    await client.close();
  });

  it('compacts real command failure output without losing diagnostic essentials', async () => {
    const repo = repository();
    const twins = fs.mkdtempSync(path.join(os.tmpdir(), 'repotwin-mcp-cache-'));
    directories.push(twins);
    process.env.REPOTWIN_TWINS_DIR = twins;

    fs.writeFileSync(path.join(repo, 'package.json'), JSON.stringify({
      name: 'failing-test-pkg',
      scripts: {
        test: 'node -e "console.error(\'FAIL test/auth.test.ts\\n  ● Auth > should login\\n    AssertionError: expected 401 to deeply equal 200\\n      at test/auth.test.ts:15:10\\n\'); process.exit(1)"'
      }
    }, null, 2));
    git(repo, ['add', 'package.json']);
    git(repo, ['commit', '-m', 'add test script']);

    const server = createMcpServer(repo);
    const client = new Client({ name: 'test-client-failing-compact', version: '1.0.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    const created = payload(await client.callTool({
      name: 'repotwin_create_twin',
      arguments: { repoPath: repo }
    }));

    const verified = payload(await client.callTool({
      name: 'repotwin_run_checks',
      arguments: { candidateId: created.candidateId, commandConsent: created.commandConsent }
    }));

    expect(verified.canApply).toBe(false);
    expect(verified.failedCount).toBe(1);
    expect(verified.failures).toHaveLength(1);
    expect(verified.failures[0].errorOutput).toContain('test/auth.test.ts:15');
    expect(verified.failures[0].errorOutput).toContain('expected 401 to deeply equal 200');
    expect(verified.tokenEfficiency.compactMode).toBe(true);
    expect(verified.tokenEfficiency.rawErrorCharacters).toBeGreaterThan(0);

    await client.close();
  });
});

