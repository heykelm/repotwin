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
    id: 'claude',
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
    name: 'Gemini / Antigravity',
    getConfigPath: () => path.join(os.homedir(), '.gemini', 'config', 'mcp_config.json'),
    keyPath: 'mcpServers'
  },
  {
    id: 'windsurf',
    name: 'Windsurf (Codeium)',
    getConfigPath: () => path.join(os.homedir(), '.codeium', 'windsurf', 'mcp_config.json'),
    keyPath: 'mcpServers'
  }
];

export interface SetupOptions {
  targets?: string[];
  dryRun?: boolean;
  binPath?: string;
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

  const executable = options.binPath || 'repotwin';

  const mcpEntry = {
    command: executable,
    args: ['mcp']
  };

  try {
    let configData: Record<string, unknown> = {};

    if (fs.existsSync(configPath)) {
      const raw = fs.readFileSync(configPath, 'utf8').trim();
      if (raw.length > 0) {
        try {
          configData = JSON.parse(raw);
        } catch {
          configData = {};
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
        message: `[DRY-RUN] Would write to ${configPath}:\n${JSON.stringify(configData, null, 2)}`,
        path: configPath
      };
    }

    if (!fs.existsSync(parentDir)) {
      fs.mkdirSync(parentDir, { recursive: true });
    }

    if (fs.existsSync(configPath)) {
      const backupPath = `${configPath}.bak`;
      fs.copyFileSync(configPath, backupPath);
    }

    fs.writeFileSync(configPath, JSON.stringify(configData, null, 2) + '\n', 'utf8');

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

  if (options.targets && options.targets.length > 0 && !options.targets.includes('all')) {
    const requested = options.targets.map(t => t.toLowerCase());
    targetIdes = SUPPORTED_IDES.filter(ide => requested.includes(ide.id) || (ide.id === 'gemini' && requested.includes('antigravity')));
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
      targetIdes = SUPPORTED_IDES.filter(i => ['cursor', 'claude', 'gemini'].includes(i.id));
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
