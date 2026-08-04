import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import type { SpawnSyncOptions } from 'node:child_process';
import os from 'node:os';
import process from 'node:process';

import type { CommandResult, RuntimeConfig } from './types.js';
import { bufferToString } from './utils.js';

export function runCommand(
  command: string,
  args: string[],
  config: RuntimeConfig
): CommandResult {
  printCommand(command, args);
  const result = spawnWithConfig(command, args, config.targetDir, config, 'pipe');
  if (result.status !== 0) {
    throw commandError(command, args, result);
  }
  return {
    stdout: bufferToString(result.stdout),
    stderr: bufferToString(result.stderr),
  };
}

export function runInherited(
  command: string,
  args: string[],
  config: RuntimeConfig
): void {
  printCommand(command, args);
  const result = spawnWithConfig(
    command,
    args,
    config.targetDir,
    config,
    'inherit'
  );
  if (result.status !== 0) {
    throw commandError(command, args, result);
  }
}

export function runInheritedNonInteractive(
  command: string,
  args: string[],
  config: RuntimeConfig
): void {
  printCommand(command, args);
  const result = spawnWithConfig(
    command,
    args,
    config.targetDir,
    config,
    ['ignore', 'inherit', 'inherit']
  );
  if (result.status !== 0) {
    throw commandError(command, args, result);
  }
}

export function runCommandAndEcho(
  command: string,
  args: string[],
  config: RuntimeConfig
): CommandResult {
  printCommand(command, args);
  const result = spawnWithConfig(command, args, config.targetDir, config, 'pipe');
  const stdout = bufferToString(result.stdout);
  const stderr = bufferToString(result.stderr);

  if (stdout) process.stdout.write(stdout);
  if (stderr) process.stderr.write(stderr);

  if (result.status !== 0) {
    throw commandError(command, args, result);
  }

  return { stdout, stderr };
}

export function runInheritedRaw(command: string, args: string[], cwd: string): void {
  printCommand(command, args);
  const result = spawnCommand(command, args, { cwd, stdio: 'inherit' });
  if (result.status !== 0) {
    throw commandError(command, args, result);
  }
}

export function runQuiet(command: string, args: string[], cwd: string): void {
  printCommand(command, args);
  const result = spawnCommand(command, args, { cwd, stdio: 'ignore' });
  if (result.status !== 0) {
    throw new Error(`Command failed: ${[command, ...args].join(' ')}`);
  }
}

function printCommand(command: string, args: string[]): void {
  console.log(`\n💻 $ ${formatCommand([command, ...args])}`);
}

function formatCommand(parts: string[]): string {
  return parts.map(quoteArg).join(' ');
}

function quoteArg(value: string): string {
  if (/^[A-Za-z0-9_./:=@%+-]+$/.test(value)) return value;
  return JSON.stringify(value);
}

export function commandExists(command: string): boolean {
  return spawnCommand(command, ['--version'], { stdio: 'ignore' }).status === 0;
}

export function execVersion(command: string): string {
  const result = spawnCommand(command, ['--version'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });

  if (result.status !== 0 || typeof result.stdout !== 'string') {
    throw commandError(command, ['--version'], result);
  }

  return result.stdout.trim();
}

function spawnWithConfig(
  command: string,
  args: string[],
  cwd: string,
  config: RuntimeConfig,
  stdio: 'pipe' | 'inherit' | ['ignore', 'inherit', 'inherit']
): SpawnSyncReturns<Buffer> {
  return spawnCommand(command, args, {
    cwd,
    env: {
      ...process.env,
      CLOUDFLARE_ACCOUNT_ID: config.cloudflareAccountId,
      CLOUDFLARE_API_TOKEN: config.cloudflareApiToken,
      CLOUDFLARE_DATABASE_ID: config.d1DatabaseId,
      WAFFO_MERCHANT_ID: config.waffoMerchantId,
      WAFFO_PRIVATE_KEY: config.waffoPrivateKey,
    },
    stdio,
    maxBuffer: 64 * 1024 * 1024,
  }) as SpawnSyncReturns<Buffer>;
}

export function shellForPlatform(platform: NodeJS.Platform): boolean {
  return platform === 'win32';
}

function spawnCommand(
  command: string,
  args: string[],
  options: SpawnSyncOptions
): SpawnSyncReturns<Buffer | string> {
  return spawnSync(command, args, {
    ...options,
    shell: shellForPlatform(process.platform),
  });
}

function commandError(
  command: string,
  args: string[],
  result: SpawnSyncReturns<Buffer | string>
): Error {
  const stdout = bufferToString(result.stdout).trim();
  const stderr = bufferToString(result.stderr).trim();
  const reason = result.error?.message.trim();
  return new Error(
    [`Command failed: ${[command, ...args].join(' ')}`, stdout, stderr, reason]
      .filter(Boolean)
      .join(os.EOL)
  );
}
