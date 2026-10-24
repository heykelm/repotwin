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
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'repotwin-mcp-'));
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

describe('RepoTwin MCP safety workflow', () => {
  it('requires a verified candidate and one-time verification token before apply', async () => {
    const repo = repository();
    const twins = fs.mkdtempSync(path.join(os.tmpdir(), 'repotwin-mcp-cache-'));
    directories.push(twins);
    process.env.REPOTWIN_TWINS_DIR = twins;

    const server = createMcpServer(repo);
    const client = new Client({ name: 'test-client', version: '1.0.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    const listed = await client.listTools();
    expect(listed.tools.find(tool => tool.name === 'repotwin_apply_fix')?.annotations?.destructiveHint).toBe(true);

    const created = payload(await client.callTool({
      name: 'repotwin_create_twin',
      arguments: { repoPath: repo }
    }));
    expect(created.candidateId).toEqual(expect.any(String));
    expect(created.validationPlan).toEqual([]);

    const premature = await client.callTool({
      name: 'repotwin_apply_fix',
      arguments: { candidateId: created.candidateId, verificationToken: 'invented', confirmApply: true }
    });
    expect(premature.isError).toBe(true);
    expect(payload(premature).error).toContain('verification token');
    expect(fs.existsSync(path.join(repo, 'AGENTS.md'))).toBe(false);

    const verified = payload(await client.callTool({
      name: 'repotwin_run_checks',
      arguments: { candidateId: created.candidateId, commandConsent: created.commandConsent }
    }));
    expect(verified.canApply).toBe(true);
    expect(verified.verificationToken).toEqual(expect.any(String));

    const wrongToken = await client.callTool({
      name: 'repotwin_apply_fix',
      arguments: { candidateId: created.candidateId, verificationToken: 'wrong', confirmApply: true }
    });
    expect(wrongToken.isError).toBe(true);
    expect(fs.existsSync(path.join(repo, 'AGENTS.md'))).toBe(false);

    fs.writeFileSync(path.join(repo, 'README.md'), 'changed after verification');
    const drifted = await client.callTool({
      name: 'repotwin_apply_fix',
      arguments: { candidateId: created.candidateId, verificationToken: verified.verificationToken, confirmApply: true }
    });
    expect(drifted.isError).toBe(true);
    expect(payload(drifted).error).toContain('Source repository changed');
    fs.writeFileSync(path.join(repo, 'README.md'), '# fixture\n');

    const applied = payload(await client.callTool({
      name: 'repotwin_apply_fix',
      arguments: {
        candidateId: created.candidateId,
        verificationToken: verified.verificationToken,
        confirmApply: true
      }
    }));
    expect(applied.success).toBe(true);
    expect(fs.existsSync(path.join(repo, 'AGENTS.md'))).toBe(true);

    const replayed = await client.callTool({
      name: 'repotwin_apply_fix',
      arguments: {
        candidateId: created.candidateId,
        verificationToken: verified.verificationToken,
        confirmApply: true
      }
    });
    expect(replayed.isError).toBe(true);
    expect(payload(replayed).error).toContain('verification token');

    await client.close();
  });
});
