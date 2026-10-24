import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { installMcpForIde, TargetIde } from '../src/mcp/installer.js';

function target(configPath: string): TargetIde {
  return { id: 'test', name: 'Test IDE', getConfigPath: () => configPath, keyPath: 'mcpServers' };
}

describe('MCP installer safety', () => {
  it('refuses to overwrite malformed configuration', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'repotwin-installer-'));
    const config = path.join(dir, 'mcp.json');
    fs.writeFileSync(config, '{ broken');
    const result = installMcpForIde(target(config), { binPath: process.execPath });
    expect(result.success).toBe(false);
    expect(result.message).toContain('Refusing to overwrite invalid JSON');
    expect(fs.readFileSync(config, 'utf8')).toBe('{ broken');
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('merges atomically and keeps dry-run output limited to RepoTwin', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'repotwin-installer-'));
    const config = path.join(dir, 'mcp.json');
    fs.writeFileSync(config, JSON.stringify({ mcpServers: { private: { env: { TOKEN: 'do-not-print' } } } }));
    const preview = installMcpForIde(target(config), { binPath: process.execPath, dryRun: true });
    expect(preview.success).toBe(true);
    expect(preview.message).not.toContain('do-not-print');

    const installed = installMcpForIde(target(config), { binPath: process.execPath });
    expect(installed.success).toBe(true);
    const parsed = JSON.parse(fs.readFileSync(config, 'utf8'));
    expect(parsed.mcpServers.private.env.TOKEN).toBe('do-not-print');
    expect(parsed.mcpServers.repotwin).toEqual({ command: fs.realpathSync(process.execPath), args: ['mcp'] });
    expect(fs.statSync(config).mode & 0o077).toBe(0);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
