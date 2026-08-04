import process from 'node:process';

import { commandExists, execVersion, runInheritedRaw, runQuiet } from './commands.js';
import { checkGitIdentity } from './git.js';
import type { RuntimeConfig } from './types.js';
import { maskSecret } from './utils.js';

const REQUIRED_COMMANDS = ['node', 'pnpm', 'git', 'gh'] as const;
const INSTALL_NOTES: Record<string, string> = {
  pnpm: 'https://pnpm.io/installation',
  git: 'https://git-scm.com/downloads',
  gh: 'https://cli.github.com/',
};

type RequiredCommand = (typeof REQUIRED_COMMANDS)[number];

interface InstallStep {
  command: string;
  args: string[];
}

export function preflight(config: RuntimeConfig): void {
  console.log('Checking local prerequisites...');
  ensureRequiredCommands();

  for (const command of REQUIRED_COMMANDS) {
    console.log(`✓ ${command} ${execVersion(command).split('\n')[0]}`);
  }

  runQuiet('gh', ['auth', 'status'], process.cwd());
  console.log('✓ GitHub CLI authenticated');
  checkGitIdentity();
  console.log('✓ Git author configured');

  console.log(`✓ CLOUDFLARE_ACCOUNT_ID=${config.cloudflareAccountId}`);
  console.log(
    `✓ CLOUDFLARE_API_TOKEN=${maskSecret(config.cloudflareApiToken)}`
  );

  if (config.paymentProvider === 'waffo') {
    if (config.waffoMerchantId && config.waffoPrivateKey) {
      console.log(`✓ WAFFO_MERCHANT_ID=${config.waffoMerchantId}`);
      console.log(
        `✓ WAFFO_PRIVATE_KEY=${maskSecret(config.waffoPrivateKey)}`
      );
    } else {
      console.log(
        '⚠ WAFFO_MERCHANT_ID and WAFFO_PRIVATE_KEY are not set; Waffo store setup will require them.'
      );
    }
  }
}

function ensureRequiredCommands(): void {
  for (const command of REQUIRED_COMMANDS) {
    if (commandExists(command)) continue;

    installMissingCommand(command);

    if (!commandExists(command)) {
      throw new Error(
        `${command} is required but could not be installed automatically. Install it manually: ${INSTALL_NOTES[command] ?? 'check your package manager docs'}`
      );
    }
  }
}

function installMissingCommand(command: RequiredCommand): void {
  if (command === 'node') {
    throw new Error('node is required to run TanStarter CLI.');
  }

  const steps = getInstallPlan(
    command,
    process.platform,
    commandExists,
    typeof process.getuid === 'function' && process.getuid() === 0
  );

  if (steps.length === 0) {
    throw new Error(
      `${command} is required but TanStarter CLI could not find a supported installer. Install it manually: ${INSTALL_NOTES[command] ?? 'check your package manager docs'}`
    );
  }

  console.log(`Installing missing command: ${command}`);
  for (const step of steps) {
    console.log(`→ ${[step.command, ...step.args].join(' ')}`);
    runInheritedRaw(step.command, step.args, process.cwd());
  }
}

export function getInstallPlan(
  command: RequiredCommand,
  platform: NodeJS.Platform,
  hasCommand: (command: string) => boolean,
  isRoot = false
): InstallStep[] {
  if (command === 'node') return [];

  if (command === 'pnpm') {
    if (hasCommand('corepack')) {
      return [
        { command: 'corepack', args: ['enable'] },
        { command: 'corepack', args: ['prepare', 'pnpm@latest', '--activate'] },
      ];
    }
    if (hasCommand('npm')) {
      return [{ command: 'npm', args: ['install', '-g', 'pnpm'] }];
    }
    return [];
  }

  if (platform === 'darwin' && hasCommand('brew')) {
    return [{ command: 'brew', args: ['install', command] }];
  }

  if (platform === 'win32') {
    if (hasCommand('winget')) {
      const packageId = command === 'gh' ? 'GitHub.cli' : 'Git.Git';
      return [
        {
          command: 'winget',
          args: ['install', '--id', packageId, '-e'],
        },
      ];
    }
    if (hasCommand('choco')) {
      const packageName = command === 'gh' ? 'gh' : 'git';
      return [{ command: 'choco', args: ['install', packageName, '-y'] }];
    }
    return [];
  }

  if (platform === 'linux') {
    if (hasCommand('brew')) {
      return [{ command: 'brew', args: ['install', command] }];
    }
    if (hasCommand('apt-get')) {
      return systemInstallSteps('apt-get', ['install', '-y', command], isRoot, [
        ['apt-get', 'update'],
      ]);
    }
    if (hasCommand('dnf')) {
      return systemInstallSteps('dnf', ['install', '-y', command], isRoot);
    }
    if (hasCommand('yum')) {
      return systemInstallSteps('yum', ['install', '-y', command], isRoot);
    }
    if (hasCommand('pacman')) {
      return systemInstallSteps('pacman', ['-Sy', '--noconfirm', command], isRoot);
    }
    if (hasCommand('apk')) {
      return systemInstallSteps('apk', ['add', command], isRoot);
    }
  }

  return [];
}

function systemInstallSteps(
  command: string,
  args: string[],
  isRoot: boolean,
  before: Array<[string, ...string[]]> = []
): InstallStep[] {
  const wrap = (stepCommand: string, stepArgs: string[]): InstallStep =>
    isRoot
      ? { command: stepCommand, args: stepArgs }
      : { command: 'sudo', args: [stepCommand, ...stepArgs] };

  return [
    ...before.map(([stepCommand, ...stepArgs]) => wrap(stepCommand, stepArgs)),
    wrap(command, args),
  ];
}
