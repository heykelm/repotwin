import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { expect, it } from 'vitest';
import { startDevServer } from '../src/server/dev-server.js';
import { execFileSync } from 'node:child_process';

it('binds loopback, blocks unauthenticated and cross-origin writes, escapes HTML and survives invalid reports', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rt-http-'));
  const report = path.join(dir, 'report.json');
  fs.writeFileSync(report, '[]');
  fs.writeFileSync(path.join(dir, 'GEMINI.md'), 'Use `npm run obsolete`.');
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({
    name: '<script>evil()</script>',
    scripts: { test: "node -e \"console.log('fixture passed')\"" }
  }));
  const server = startDevServer(dir, 0, report);
  try {
    await once(server, 'listening');
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing address');
    expect(address.address).toBe('127.0.0.1');
    const origin = `http://127.0.0.1:${address.port}`;
    const page = await fetch(origin);
    const html = await page.text();
    const studioStateResponse = await fetch(`${origin}/api/studio/state`);
    const studioState = await studioStateResponse.json() as {
      sessionToken: string;
      repo: { name: string };
      analysis: { instructionAudit: { findings: Array<{ file: string; line?: number }> } };
    };
    const assetPath = html.match(/src="(\/assets\/[^"]+\.js)"/)?.[1];
    expect(assetPath).toBeTruthy();
    expect((await fetch(origin + assetPath)).headers.get('content-type')).toContain('text/javascript');
    expect(html).not.toContain('<script>evil()</script>');
    expect(html).toContain('id="root"');
    expect(html).not.toContain('cdn.tailwindcss.com');
    expect(page.headers.get('content-security-policy')).toContain("script-src 'self'");
    expect(page.headers.get('content-security-policy')).not.toContain('cdn.tailwindcss.com');
    expect(studioStateResponse.headers.get('content-type')).toContain('application/json');
    expect(studioState.analysis.instructionAudit.findings).toContainEqual(expect.objectContaining({ file: 'GEMINI.md', line: 1 }));
    expect(html).not.toContain('tokens/prompt');
    expect(html).not.toContain('100% sûre');
    expect(page.headers.get('access-control-allow-origin')).toBeNull();
    const token = studioState.sessionToken;
    expect(token).toBeTruthy();
    expect((await fetch(`${origin}/api/twin/apply`, { method: 'POST' })).status).toBe(403);
    expect((await fetch(`${origin}/api/twin/apply`, { method: 'POST', headers: { Origin: 'https://evil.example', 'X-RepoTwin-Token': token! } })).status).toBe(403);
    const noCandidate = await fetch(`${origin}/api/twin/apply`, { method: 'POST', headers: { Origin: origin, 'X-RepoTwin-Token': token! } });
    expect((await noCandidate.json() as { error: string }).error).toContain('candidate');
    expect(fs.existsSync(path.join(dir, 'AGENTS.md'))).toBe(false);
    const git = (args: string[]) => execFileSync('git', ['-C', dir, ...args], { stdio: 'pipe' });
    git(['init']); git(['config', 'user.email', 'test@example.com']); git(['config', 'user.name', 'test']);
    git(['add', '.']); git(['commit', '-m', 'fixture']);
    const comparisonUrl = `${origin}/api/comparison`;
    expect((await fetch(`${comparisonUrl}/run`, { method: 'POST' })).status).toBe(403);
    const comparisonHeaders = { Origin: origin, 'X-RepoTwin-Token': token! };
    expect((await fetch(`${comparisonUrl}/run`, { method: 'POST', headers: comparisonHeaders })).status).toBe(409);
    const preview = await (await fetch(`${comparisonUrl}/plan?base=HEAD&target=HEAD`, { method: 'POST', headers: comparisonHeaders })).json() as { ok: boolean; consent: string; plan: { baseCommit: string; targetCommit: string } };
    expect(preview.ok).toBe(true);
    expect(preview.plan.baseCommit).toBe(preview.plan.targetCommit);
    const comparison = await (await fetch(`${comparisonUrl}/run`, { method: 'POST', headers: { ...comparisonHeaders, 'X-RepoTwin-Comparison-Consent': preview.consent } })).json() as { report: { verdict: string; counts: Record<string, number> } };
    expect(comparison.report.verdict).toBe('no-regression-observed');
    expect(comparison.report.counts['passing-both']).toBe(1);
    const comparisonStatus = await (await fetch(`${comparisonUrl}/status`)).json() as { progress: { state: string } };
    expect(comparisonStatus.progress.state).toBe('done');
    const oldCache = process.env.REPOTWIN_TWINS_DIR;
    const cache = fs.mkdtempSync(path.join(os.tmpdir(), 'rt-http-cache-'));
    process.env.REPOTWIN_TWINS_DIR = cache;
    const post = (action: string, commandConsent?: string) => fetch(`${origin}/api/twin/${action}`, {
      method: 'POST',
      headers: {
        Origin: origin,
        'X-RepoTwin-Token': token!,
        ...(commandConsent ? { 'X-RepoTwin-Command-Consent': commandConsent } : {})
      }
    });
    try {
      const created = await (await post('create')).json() as { result: { status: string; diff: string; verifiedScore?: number; twinPath: string; consentToken: string; validationPlan: Array<{ display: string }> } };
      expect(created.result.status).toBe('created');
      expect((await post('create')).status).toBe(409);
      expect(created.result.verifiedScore).toBeUndefined();
      expect(created.result.diff).toContain('+<!-- repotwin:start -->');
      expect(created.result.diff).toContain('agent-ready.json');
      expect(created.result.validationPlan.map(command => command.display)).toEqual(['npm run test']);
      expect((await post('apply')).status).toBe(500);
      expect((await post('verify')).status).toBe(409);
      fs.writeFileSync(report, '{invalid');
      const checked = await (await post('verify', created.result.consentToken)).json() as { result: { passed: boolean; testsExecuted: boolean; commandResults: Array<{ status: string; output: string }>; before: { scores: { correctedScore: number } }; after: { scores: { correctedScore: number }; findings: Array<{ file: string; rule: string }> } } };
      expect(checked.result.passed).toBe(true);
      expect(checked.result.testsExecuted).toBe(true);
      expect(checked.result.commandResults[0]).toMatchObject({ status: 'passed' });
      expect(checked.result.commandResults[0]?.output).toContain('fixture passed');
      expect(checked.result.after.scores.correctedScore).toBeGreaterThan(checked.result.before.scores.correctedScore);
      expect(checked.result.after.findings).toContainEqual(expect.objectContaining({ file: 'GEMINI.md', rule: 'instruction-missing-script' }));
      fs.writeFileSync(report, '[]');
      const restoredState = await (await fetch(origin + '/api/studio/state')).json() as {
        state: { step: string; commandResults: Array<{ output: string }> };
      };
      expect(restoredState.state.step).toBe('verified');
      expect(restoredState.state.commandResults).toHaveLength(1);
      expect(restoredState.state.commandResults[0].output).toContain('fixture passed');
      const applied = await post('apply');
      const payload = await applied.json() as { ok: boolean; backupDir: string };
      expect(payload.ok).toBe(true);
      expect(fs.existsSync(payload.backupDir)).toBe(true);
      expect(fs.readFileSync(path.join(dir, 'AGENTS.md'), 'utf8')).toContain('repotwin:start');
      expect((await post('apply')).status).toBe(500);
      const second = await (await post('create')).json() as { result: { twinPath: string; consentToken: string } };
      const streamRes = await fetch(`${origin}/api/twin/verify`, {
        method: 'POST',
        headers: {
          Origin: origin,
          'X-RepoTwin-Token': token!,
          'X-RepoTwin-Command-Consent': second.result.consentToken,
          'X-RepoTwin-Stream': 'true'
        }
      });
      expect(streamRes.headers.get('content-type')).toContain('application/x-ndjson');
      const streamText = await streamRes.text();
      const events = streamText.split('\n').filter(Boolean).map(line => JSON.parse(line));
      expect(events.some((e: any) => e.type === 'phase')).toBe(true);
      expect(events.some((e: any) => e.type === 'command_start')).toBe(true);
      expect(events.some((e: any) => e.type === 'command_done')).toBe(true);
      expect(events.find((e: any) => e.type === 'complete')?.ok).toBe(true);
      fs.appendFileSync(path.join(second.result.twinPath, 'AGENTS.md'), '\nmodified after verification');
      expect((await post('apply')).status).toBe(500);
    } finally {
      fs.rmSync(cache, { recursive: true, force: true });
      if (oldCache === undefined) delete process.env.REPOTWIN_TWINS_DIR;
      else process.env.REPOTWIN_TWINS_DIR = oldCache;
    }
    fs.writeFileSync(report, '{invalid');
    expect((await fetch(origin + '/api/studio/state')).status).toBe(500);
    fs.writeFileSync(report, '[]');
    expect((await fetch(origin + '/api/studio/state')).status).toBe(200);
  } finally {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
    fs.rmSync(dir, { recursive: true, force: true });
  }
}, 40_000);

it('blocks application when a command fails without claiming the failure predates the proposal', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rt-failed-control-'));
  const cache = fs.mkdtempSync(path.join(os.tmpdir(), 'rt-failed-cache-'));
  const previousCache = process.env.REPOTWIN_TWINS_DIR;
  process.env.REPOTWIN_TWINS_DIR = cache;
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'failure', scripts: { test: 'node -e "process.exit(1)"', lint: 'node -e "process.exit(0)"' } }));
  const git = (args: string[]) => execFileSync('git', ['-C', dir, ...args], { stdio: 'pipe' });
  git(['init']); git(['config', 'user.email', 'test@example.com']); git(['config', 'user.name', 'test']);
  git(['add', '.']); git(['commit', '-m', 'fixture']);
  const server = startDevServer(dir, 0);
  try {
    await once(server, 'listening');
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing address');
    const origin = 'http://127.0.0.1:' + address.port;
    const studioState = await (await fetch(origin + '/api/studio/state')).json() as { sessionToken: string };
    const token = studioState.sessionToken;
    const headers = { Origin: origin, 'X-RepoTwin-Token': token };
    const created = await (await fetch(origin + '/api/twin/create', { method: 'POST', headers })).json() as { result: { consentToken: string; validationPlan: Array<{ id: string; kind: string }> } };
    const lintId = created.result.validationPlan.find(command => command.kind === 'lint')!.id;
    const partial = await (await fetch(origin + '/api/twin/verify?id=' + lintId, { method: 'POST', headers: { ...headers, 'X-RepoTwin-Command-Consent': created.result.consentToken } })).json() as { result: { canApply: boolean; commandsPassed: boolean } };
    expect(partial.result.commandsPassed).toBe(false);
    expect(partial.result.canApply).toBe(false);
    const checked = await (await fetch(origin + '/api/twin/verify', { method: 'POST', headers: { ...headers, 'X-RepoTwin-Command-Consent': created.result.consentToken } })).json() as { result: { canApply: boolean; candidateIntact: boolean; commandResults: Array<{ status: string }> } };
    expect(checked.result.canApply).toBe(false);
    expect(checked.result.candidateIntact).toBe(true);
    expect(checked.result.commandResults[0].status).toBe('failed');
    expect((await fetch(origin + '/api/twin/apply', { method: 'POST', headers })).status).toBe(500);
    expect(fs.existsSync(path.join(dir, 'AGENTS.md'))).toBe(false);
  } finally {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
    fs.rmSync(cache, { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
    if (previousCache === undefined) delete process.env.REPOTWIN_TWINS_DIR; else process.env.REPOTWIN_TWINS_DIR = previousCache;
  }
}, 20_000);
