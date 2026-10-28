#!/usr/bin/env node
// Local, provider-free benchmark of full repotwin_run_checks MCP responses.
// Run with: node --import tsx scripts/context-benchmark.mjs
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createMcpServer } from '../src/mcp/server.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputDir = path.join(root, 'docs', 'benchmarks');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'repotwin-context-bench-'));
const priorTwinsDir = process.env.REPOTWIN_TWINS_DIR;
process.env.REPOTWIN_TWINS_DIR = path.join(temp, 'twins');
fs.mkdirSync(outputDir, { recursive: true });

const fixtures = [
  {
    name: 'success', kind: 'test', script: 'node --test suite.test.cjs',
    source: `const { test } = require('node:test');
const assert = require('node:assert/strict');
test('arithmetic works', () => assert.equal(2 + 2, 4));
test('strings work', () => assert.match('repotwin', /twin/));\n`,
    expected: []
  },
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
    expected: ['NOISE_0000'],
    diagnosticMarkersAfterCaptureLimit: ['large log sentinel', 'LARGE_ACTUAL', 'LARGE_EXPECTED']
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
  assert.equal(result.content.length, 1);
  assert.equal(result.content[0].type, 'text');
  return result.content[0].text;
}
function size(text) {
  return { characters: text.length, utf8Bytes: Buffer.byteLength(text), estimatedTokens4Chars: Math.ceil(text.length / 4) };
}
function hash(text) {
  return crypto.createHash('sha256').update(text).digest('hex');
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

async function one(fixture) {
  const repo = makeRepo(fixture);
  const server = createMcpServer(repo);
  const client = new Client({ name: 'context-benchmark', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  try {
    const created = JSON.parse(textPayload(await client.callTool({ name: 'repotwin_create_twin', arguments: { repoPath: repo } })));
    const args = { candidateId: created.candidateId, commandConsent: created.commandConsent };
    const compactText = textPayload(await client.callTool({ name: 'repotwin_run_checks', arguments: { ...args, compactOutput: true } }));
    const rawText = textPayload(await client.callTool({ name: 'repotwin_run_checks', arguments: { ...args, compactOutput: false } }));
    const compact = JSON.parse(compactText);
    const raw = JSON.parse(rawText);
    assert.equal(compact.totalCommands, 1);
    assert.equal(raw.totalCommands, 1);
    const observedOutput = compact.failures[0]?.rawOutput ?? '';
    const rawObservedOutput = raw.failures[0]?.errorOutput ?? '';
    const diagnostics = fixture.expected.map(sentinel => ({
      sentinel,
      inCompactFullResponse: compactText.includes(sentinel),
      inRawFullResponse: rawText.includes(sentinel),
      inCompactSummary: compact.failures[0]?.errorOutput?.includes(sentinel) ?? false
    }));
    assert(diagnostics.every(d => d.inCompactFullResponse && d.inRawFullResponse), `${fixture.name}: expected diagnostic absent`);
    const diagnosticsAfterCaptureLimit = (fixture.diagnosticMarkersAfterCaptureLimit ?? []).map(sentinel => ({
      sentinel,
      inCompactFullResponse: compactText.includes(sentinel),
      inRawFullResponse: rawText.includes(sentinel),
      inCompactSummary: compact.failures[0]?.errorOutput?.includes(sentinel) ?? false
    }));
    // Match the two modes on the exact same command output. The ordinary MCP
    // calls above execute the command twice and may differ in runner timings.
    const matchedRaw = structuredClone(compact);
    matchedRaw.tokenEfficiency.compactMode = false;
    for (const failure of matchedRaw.failures) {
      failure.errorOutput = failure.rawOutput;
      delete failure.rawOutput;
      delete failure.extractedFailures;
    }
    const matchedRawText = JSON.stringify(matchedRaw, null, 2);
    if (fixture.name === 'assertion' && !process.argv.includes('--preserve-pair')) {
      fs.writeFileSync(path.join(outputDir, 'assertion-compact-mcp.json'), compactText + '\n');
      fs.writeFileSync(path.join(outputDir, 'assertion-raw-matched-mcp.json'), matchedRawText + '\n');
    }
    return {
      name: fixture.name,
      kind: fixture.kind,
      command: fixture.script,
      status: compact.failures[0]?.status ?? 'passed',
      outputTruncated: compact.failures[0]?.outputTruncated ?? false,
      diagnosticChecks: diagnostics,
      diagnosticsAfterCaptureLimit,
      capturedRawOutput: { characters: observedOutput.length, utf8Bytes: Buffer.byteLength(observedOutput) },
      compactSummaryOutput: compact.failures[0] ? size(compact.failures[0].errorOutput) : null,
      extractedFailureCount: compact.failures[0]?.extractedFailures?.length ?? 0,
      observed: {
        compactFullResponse: size(compactText),
        rawFullResponse: size(rawText),
        deltaBytes: Buffer.byteLength(compactText) - Buffer.byteLength(rawText),
        deltaEstimatedTokens: Math.ceil(compactText.length / 4) - Math.ceil(rawText.length / 4),
        sameCapturedCommandOutput: observedOutput === rawObservedOutput,
        compactRawOutputSha256: hash(observedOutput),
        rawModeOutputSha256: hash(rawObservedOutput),
        durationMs: { compact: compact.failures[0]?.durationMs ?? compact.passedCommands[0]?.durationMs, raw: raw.failures[0]?.durationMs ?? raw.passedCommands[0]?.durationMs }
      },
      matchedSameRun: {
        compactFullResponse: size(compactText),
        rawFullResponse: size(matchedRawText),
        deltaBytes: Buffer.byteLength(compactText) - Buffer.byteLength(matchedRawText),
        deltaEstimatedTokens: Math.ceil(compactText.length / 4) - Math.ceil(matchedRawText.length / 4)
      }
    };
  } finally {
    await client.close();
  }
}

try {
  const rows = [];
  for (const fixture of fixtures) {
    rows.push(await one(fixture));
    console.log(`${fixture.name}: ${rows.at(-1).matchedSameRun.deltaBytes >= 0 ? '+' : ''}${rows.at(-1).matchedSameRun.deltaBytes} B compact vs raw (matched run)`);
  }
  const data = {
    benchmark: 'RepoTwin full MCP response, local provider-free',
    generatedAt: new Date().toISOString(),
    node: process.version,
    sourceRevision: execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
    sourceSha256: Object.fromEntries(['src/mcp/server.ts', 'src/verification/compact-sieve.ts'].map(file => [file, hash(fs.readFileSync(path.join(root, file)))])),
    tokenizer: 'No provider tokenizer used; estimatedTokens4Chars is ceil(JavaScript UTF-16 characters/4), not billed tokens.',
    sameRunMethod: 'Matched raw payload derived from the actual compact MCP response by applying the current server noncompact field mapping; independent noncompact MCP call validates the real shape but runs the command again.',
    rows
  };
  fs.writeFileSync(path.join(outputDir, 'context-benchmark.json'), JSON.stringify(data, null, 2) + '\n');
  console.log(`Results: ${path.join(outputDir, 'context-benchmark.json')}`);
} finally {
  if (priorTwinsDir === undefined) delete process.env.REPOTWIN_TWINS_DIR;
  else process.env.REPOTWIN_TWINS_DIR = priorTwinsDir;
  fs.rmSync(temp, { recursive: true, force: true });
}
