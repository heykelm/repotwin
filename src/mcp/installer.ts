import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import chalk from 'chalk';

export interface TargetIde {
  id: string;
  name: string;
  getConfigPath: () => string;
  keyPath: 'mcpServers';
}

export const SUPPORTED_IDES: TargetIde[] = [
  {
    id: 'cursor',
    name: 'Cursor',
    getConfigPath: () => path.join(os.homedir(), '.cursor', 'mcp.json'),
    keyPath: 'mcpServers'
  },
  {
    id: 'claude-desktop',
    name: 'Claude Desktop',
    getConfigPath: () => {
      const platform = process.platform;
      if (platform === 'darwin') {
        return path.join(os.homedir(), 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json');
      } else if (platform === 'win32') {
        return path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'Claude', 'claude_desktop_config.json');
      } else {
        return path.join(os.homedir(), '.config', 'Claude', 'claude_desktop_config.json');
      }
    },
    keyPath: 'mcpServers'
  },
  {
    id: 'gemini',
    name: 'Gemini CLI',
    getConfigPath: () => path.join(os.homedir(), '.gemini', 'settings.json'),
    keyPath: 'mcpServers'
  },
  {
    id: 'antigravity',
    name: 'Gemini Antigravity',
    getConfigPath: () => path.join(os.homedir(), '.gemini', 'antigravity-ide', 'mcp_config.json'),
    keyPath: 'mcpServers'
  },
  {
    id: 'windsurf',
    name: 'Windsurf (Codeium)',
    getConfigPath: () => path.join(os.homedir(), '.codeium', 'windsurf', 'mcp_config.json'),
    keyPath: 'mcpServers'
  },
  {
    id: 'claude-code',
    name: 'Claude Code CLI',
    getConfigPath: () => path.join(os.homedir(), '.claude.json'),
    keyPath: 'mcpServers'
  },
  {
    id: 'roo-cline',
    name: 'VS Code Roo Code',
    getConfigPath: () => {
      const platform = process.platform;
      if (platform === 'darwin') {
        return path.join(os.homedir(), 'Library', 'Application Support', 'Code', 'User', 'globalStorage', 'rooveterinaryinc.roo-cline', 'settings', 'cline_mcp_settings.json');
      } else if (platform === 'win32') {
        return path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'Code', 'User', 'globalStorage', 'rooveterinaryinc.roo-cline', 'settings', 'cline_mcp_settings.json');
      } else {
        return path.join(os.homedir(), '.config', 'Code', 'User', 'globalStorage', 'rooveterinaryinc.roo-cline', 'settings', 'cline_mcp_settings.json');
      }
    },
    keyPath: 'mcpServers'
  },
  {
    id: 'cline',
    name: 'VS Code Cline',
    getConfigPath: () => {
      const platform = process.platform;
      if (platform === 'darwin') {
        return path.join(os.homedir(), 'Library', 'Application Support', 'Code', 'User', 'globalStorage', 'saoudrizwan.claude-dev', 'settings', 'cline_mcp_settings.json');
      } else if (platform === 'win32') {
        return path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'Code', 'User', 'globalStorage', 'saoudrizwan.claude-dev', 'settings', 'cline_mcp_settings.json');
      } else {
        return path.join(os.homedir(), '.config', 'Code', 'User', 'globalStorage', 'saoudrizwan.claude-dev', 'settings', 'cline_mcp_settings.json');
      }
    },
    keyPath: 'mcpServers'
  }
];

export interface SetupOptions {
  targets?: string[];
  dryRun?: boolean;
  binPath?: string;
}

function resolveExecutable(requested?: string): string {
  const command = requested || 'repotwin';
  if (command.includes(path.sep) || (process.platform === 'win32' && command.includes('/'))) {
    const absolute = path.resolve(command);
    if (!fs.existsSync(absolute)) throw new Error(`RepoTwin executable not found: ${absolute}`);
    return absolute;
  }
  const extensions = process.platform === 'win32' ? ['', '.cmd', '.exe', '.bat'] : [''];
  for (const directory of (process.env.PATH || '').split(path.delimiter).filter(Boolean)) {
    for (const extension of extensions) {
      const candidate = path.join(directory, `${command}${extension}`);
      try {
        fs.accessSync(candidate, fs.constants.X_OK);
        return fs.realpathSync(candidate);
      } catch {}
    }
  }
  throw new Error(`Executable "${command}" was not found in PATH. Pass --bin with an absolute path.`);
}

function resolveMcpLaunch(requested?: string): { command: string; args: string[] } {
  const executable = resolveExecutable(requested);
  const realExecutable = fs.realpathSync(executable);
  if (realExecutable.endsWith('.js')) {
    return { command: process.execPath, args: [realExecutable, 'mcp'] };
  }
  return { command: executable, args: ['mcp'] };
}

function writeJsonAtomically(target: string, value: Record<string, unknown>): void {
  const temporary = `${target}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
  fs.renameSync(temporary, target);
}

export function detectInstalledIdes(): TargetIde[] {
  return SUPPORTED_IDES.filter(ide => {
    const configPath = ide.getConfigPath();
    const parentDir = path.dirname(configPath);
    // An IDE is detected if its parent directory or config file exists
    return fs.existsSync(parentDir) || fs.existsSync(configPath);
  });
}

export function installMcpForIde(ide: TargetIde, options: SetupOptions = {}): { success: boolean; message: string; path: string } {
  const configPath = ide.getConfigPath();
  const parentDir = path.dirname(configPath);

  let mcpEntry: { command: string; args: string[] };
  try {
    mcpEntry = resolveMcpLaunch(options.binPath);
  } catch (error) {
    return { success: false, message: error instanceof Error ? error.message : String(error), path: configPath };
  }

  try {
    let configData: Record<string, unknown> = {};

    if (fs.existsSync(configPath)) {
      const raw = fs.readFileSync(configPath, 'utf8').trim();
      if (raw.length > 0) {
        try {
          configData = JSON.parse(raw);
        } catch (error) {
          const detail = error instanceof Error ? error.message : String(error);
          throw new Error(`Refusing to overwrite invalid JSON in ${configPath}: ${detail}`);
        }
      }
    }

    if (!configData.mcpServers || typeof configData.mcpServers !== 'object' || Array.isArray(configData.mcpServers)) {
      configData.mcpServers = {};
    }

    const mcpServers = configData.mcpServers as Record<string, unknown>;
    mcpServers.repotwin = mcpEntry;

    if (options.dryRun) {
      return {
        success: true,
        message: `[DRY-RUN] Would register RepoTwin in ${configPath}:\n${JSON.stringify({ repotwin: mcpEntry }, null, 2)}`,
        path: configPath
      };
    }

    if (!fs.existsSync(parentDir)) {
      fs.mkdirSync(parentDir, { recursive: true });
    }

    if (fs.existsSync(configPath)) {
      const backupPath = `${configPath}.bak.${new Date().toISOString().replace(/[:.]/g, '-')}`;
      fs.copyFileSync(configPath, backupPath);
    }

    writeJsonAtomically(configPath, configData);

    return {
      success: true,
      message: `RepoTwin MCP server registered successfully in ${configPath}`,
      path: configPath
    };
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      message: `Failed to write to ${configPath}: ${errMsg}`,
      path: configPath
    };
  }
}

export function runMcpSetup(options: SetupOptions = {}): void {
  console.log(chalk.bold.cyan('\n⚙️  RepoTwin — Universal MCP Configuration Assistant'));
  console.log(chalk.gray('======================================================================'));

  let targetIdes: TargetIde[] = [];

  if (options.targets && options.targets.includes('all')) {
    targetIdes = [...SUPPORTED_IDES];
  } else if (options.targets && options.targets.length > 0) {
    const requested = options.targets.map(t => t.toLowerCase()).map(t => t === 'claude' ? 'claude-desktop' : t);
    targetIdes = SUPPORTED_IDES.filter(ide => requested.includes(ide.id));
    if (targetIdes.length === 0) {
      console.log(chalk.yellow(`No matching IDE found for: ${options.targets.join(', ')}`));
      console.log(`Supported IDEs: ${SUPPORTED_IDES.map(i => i.id).join(', ')}, all`);
      return;
    }
  } else {
    // Auto-detection
    targetIdes = detectInstalledIdes();
    if (targetIdes.length === 0) {
      console.log(chalk.yellow('No existing IDE config directory auto-detected.'));
      console.log('Defaulting to standard configurations (Cursor, Claude, Gemini)...');
      targetIdes = SUPPORTED_IDES.filter(i => ['cursor', 'claude-desktop', 'gemini', 'antigravity'].includes(i.id));
    }
  }

  console.log(`Selected targets: ${chalk.bold(targetIdes.map(i => i.name).join(', '))}`);
  if (options.dryRun) {
    console.log(chalk.magenta('Dry-run mode (--dry-run): no file modifications will be committed.\n'));
  }

  for (const ide of targetIdes) {
    const res = installMcpForIde(ide, options);
    if (res.success) {
      console.log(`${chalk.green('✔')} ${chalk.bold(ide.name)}: ${chalk.dim(res.path)}`);
      if (options.dryRun) {
        console.log(chalk.dim(res.message));
      }
    } else {
      console.log(`${chalk.red('✖')} ${chalk.bold(ide.name)}: ${chalk.red(res.message)}`);
    }
  }

  console.log(chalk.gray('======================================================================'));
  console.log(chalk.green('✨ MCP configuration complete!'));
  console.log('AI agents in these IDEs now have native access to RepoTwin tools:');
  console.log(chalk.cyan('  • repotwin_analyze\n  • repotwin_create_twin\n  • repotwin_run_checks\n  • repotwin_apply_fix\n  • repotwin_clean_twins\n'));
}
