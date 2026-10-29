#!/usr/bin/env node
// Benchmark comparing Raw vs Two-Tier Lazy Logging on Astra's fixtures.
// Run with: node --import tsx scripts/twotier-benchmark.mjs
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createMcpServer } from '../src/mcp/server.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'repotwin-twotier-bench-'));
process.env.REPOTWIN_TWINS_DIR = path.join(temp, 'twins');

const fixtures = [
  {
    name: 'assertion', kind: 'test', script: 'node --test suite.test.cjs',
    source: `const { test } = require('node:test');
const assert = require('node:assert/strict');
test('authorization rejects wrong status', () => assert.equal(401, 200));\n`,
    expected: ['authorization rejects wrong status', '401', '200']
  },
  {
    name: 'multiline', kind: 'test', script: 'node --test suite.test.cjs',
    source: `const { test } = require('node:test');
const assert = require('node:assert/strict');
test('profile object is complete', () => assert.deepEqual({ role: 'viewer', enabled: false, nested: { region: 'eu' } }, { role: 'admin', enabled: true, nested: { region: 'us' } }));\n`,
    expected: ['profile object is complete', 'viewer', 'admin', 'region']
  },
  {
    name: 'multiple-errors', kind: 'test', script: 'node --test suite.test.cjs',
    source: `const { test } = require('node:test');
const assert = require('node:assert/strict');
test('first sentinel', () => assert.equal('ALPHA_ACTUAL', 'ALPHA_EXPECTED'));
test('second sentinel', () => assert.equal('BETA_ACTUAL', 'BETA_EXPECTED'));
test('third sentinel', () => assert.equal('GAMMA_ACTUAL', 'GAMMA_EXPECTED'));\n`,
    expected: ['first sentinel', 'second sentinel', 'third sentinel', 'ALPHA_ACTUAL', 'BETA_ACTUAL', 'GAMMA_ACTUAL']
  },
  {
    name: 'large-logs', kind: 'test', script: 'node --test suite.test.cjs',
    source: `const { test } = require('node:test');
const assert = require('node:assert/strict');
test('large log sentinel', () => { for (let i = 0; i < 1100; i++) console.log('NOISE_' + String(i).padStart(4, '0') + ' ' + 'x'.repeat(80)); assert.equal('LARGE_ACTUAL', 'LARGE_EXPECTED'); });\n`,
    expected: []
  },
  {
    name: 'typescript-errors', kind: 'build', script: `node ${path.join(root, 'node_modules', 'typescript', 'bin', 'tsc')} --noEmit --pretty false`,
    files: {
      'tsconfig.json': JSON.stringify({ compilerOptions: { strict: true, skipLibCheck: true, target: 'ES2022', noEmit: true }, files: ['broken.ts'] }),
      'broken.ts': `const count: number = 'TS_SENTINEL_STRING';\nconst flag: boolean = 42;\n`
    },
    expected: ['broken.ts', 'TS2322']
  }
];

function git(repo, args) {
  execFileSync('git', ['-C', repo, ...args], { stdio: 'ignore' });
}

function textPayload(result) {
  assert.equal(result.isError, undefined, 'MCP call failed');
  return result.content[0].text;
}

function makeRepo(fixture) {
  const repo = path.join(temp, fixture.name);
  fs.mkdirSync(repo);
  git(repo, ['init', '-q']);
  git(repo, ['config', 'user.email', 'bench@example.invalid']);
  git(repo, ['config', 'user.name', 'RepoTwin benchmark']);
  const scripts = { [fixture.kind]: fixture.script };
  fs.writeFileSync(path.join(repo, 'package.json'), JSON.stringify({ name: `bench-${fixture.name}`, version: '1.0.0', scripts }, null, 2));
  if (fixture.source) fs.writeFileSync(path.join(repo, 'suite.test.cjs'), fixture.source);
  for (const [name, content] of Object.entries(fixture.files ?? {})) fs.writeFileSync(path.join(repo, name), content);
  fs.writeFileSync(path.join(repo, 'README.md'), '# Benchmark fixture\n');
  git(repo, ['add', '.']);
  git(repo, ['commit', '-qm', 'fixture']);
  return repo;
}

async function run() {
  console.log('=== BENCHMARK TWO-TIER (Lazy Logs) vs RAW ===\n');
  console.log('| Fixture | Raw Response | Two-Tier Response | Delta Bytes | Sentinels Present in Summary? |');
  console.log('| :--- | ---: | ---: | ---: | :---: |');

  for (const fixture of fixtures) {
    const repo = makeRepo(fixture);
    const server = createMcpServer(repo);
    const client = new Client({ name: 'twotier-benchmark', version: '1.0.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    const created = JSON.parse(textPayload(await client.callTool({ name: 'repotwin_create_twin', arguments: { repoPath: repo } })));
    const args = { candidateId: created.candidateId, commandConsent: created.commandConsent };

    const rawText = textPayload(await client.callTool({ name: 'repotwin_run_checks', arguments: { ...args, compactOutput: false } }));
    const twoTierText = textPayload(await client.callTool({ name: 'repotwin_run_checks', arguments: { ...args, compactOutput: true, lazyLogs: true } }));

    const rawBytes = Buffer.byteLength(rawText);
    const twoTierBytes = Buffer.byteLength(twoTierText);
    const delta = twoTierBytes - rawBytes;
    const deltaPercent = ((delta / rawBytes) * 100).toFixed(1);

    const twoTierJson = JSON.parse(twoTierText);
    const summary = twoTierJson.failures[0]?.errorOutput ?? '';
    const allSentinelsPresent = fixture.expected.every(s => summary.includes(s));

    console.log(`| ${fixture.name} | ${rawBytes} B | ${twoTierBytes} B | ${delta > 0 ? '+' : ''}${delta} B (${deltaPercent}%) | ${allSentinelsPresent ? '✅ Yes' : '⚠️ Partial'} |`);

    await client.close();
  }
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
