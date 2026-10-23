import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { expect, it } from 'vitest';
import { startDevServer } from '../src/server/dev-server.js';
import { execFileSync } from 'node:child_process';
import vm from 'node:vm';

it('binds loopback, blocks unauthenticated and cross-origin writes, escapes HTML and survives invalid reports', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rt-http-'));
  const report = path.join(dir, 'report.json');
  fs.writeFileSync(report, '[]');
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
    for (const script of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)) {
      expect(() => new vm.Script(script[1])).not.toThrow();
    }
    expect(html).not.toContain('<script>evil()</script>');
    expect(html).toContain('&lt;script&gt;evil()&lt;/script&gt;');
    expect(page.headers.get('access-control-allow-origin')).toBeNull();
    const token = html.match(/const sessionToken = '([a-f0-9]+)'/)?.[1];
    expect(token).toBeTruthy();
    expect((await fetch(`${origin}/api/twin/apply`, { method: 'POST' })).status).toBe(403);
    expect((await fetch(`${origin}/api/twin/apply`, { method: 'POST', headers: { Origin: 'https://evil.example', 'X-RepoTwin-Token': token! } })).status).toBe(403);
    const noCandidate = await fetch(`${origin}/api/twin/apply`, { method: 'POST', headers: { Origin: origin, 'X-RepoTwin-Token': token! } });
    expect((await noCandidate.json() as { error: string }).error).toContain('candidate');
    expect(fs.existsSync(path.join(dir, 'AGENTS.md'))).toBe(false);
    const git = (args: string[]) => execFileSync('git', ['-C', dir, ...args], { stdio: 'pipe' });
    git(['init']); git(['config', 'user.email', 'test@example.com']); git(['config', 'user.name', 'test']);
    git(['add', '.']); git(['commit', '-m', 'fixture']);
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
      expect(created.result.verifiedScore).toBeUndefined();
      expect(created.result.diff).toContain('+<!-- repotwin:start -->');
      expect(created.result.diff).toContain('agent-ready.json');
      expect(created.result.validationPlan.map(command => command.display)).toEqual(['npm run test']);
      expect((await post('apply')).status).toBe(500);
      expect((await post('verify')).status).toBe(409);
      fs.writeFileSync(report, '{invalid');
      const checked = await (await post('verify', created.result.consentToken)).json() as { result: { passed: boolean; testsExecuted: boolean; commandResults: Array<{ status: string; output: string }>; before: { scores: { correctedScore: number } }; after: { scores: { correctedScore: number } } } };
      expect(checked.result.passed).toBe(true);
      expect(checked.result.testsExecuted).toBe(true);
      expect(checked.result.commandResults[0]).toMatchObject({ status: 'passed' });
      expect(checked.result.commandResults[0]?.output).toContain('fixture passed');
      expect(checked.result.after.scores.correctedScore).toBeGreaterThan(checked.result.before.scores.correctedScore);
      fs.writeFileSync(report, '[]');
      const applied = await post('apply');
      const payload = await applied.json() as { ok: boolean; backupDir: string };
      expect(payload.ok).toBe(true);
      expect(fs.existsSync(payload.backupDir)).toBe(true);
      expect(fs.readFileSync(path.join(dir, 'AGENTS.md'), 'utf8')).toContain('repotwin:start');
      expect((await post('apply')).status).toBe(500);
      const second = await (await post('create')).json() as { result: { twinPath: string; consentToken: string } };
      await post('verify', second.result.consentToken);
      fs.appendFileSync(path.join(second.result.twinPath, 'AGENTS.md'), '\nmodified after verification');
      expect((await post('apply')).status).toBe(500);
    } finally {
      fs.rmSync(cache, { recursive: true, force: true });
      if (oldCache === undefined) delete process.env.REPOTWIN_TWINS_DIR;
      else process.env.REPOTWIN_TWINS_DIR = oldCache;
    }
    fs.writeFileSync(report, '{invalid');
    expect((await fetch(origin)).status).toBe(500);
    fs.writeFileSync(report, '[]');
    expect((await fetch(origin)).status).toBe(200);
  } finally {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
    fs.rmSync(dir, { recursive: true, force: true });
  }
}, 20_000);
