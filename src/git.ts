import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import { DEFAULT_TEMPLATE_URL, STATE_DIR } from './constants.js';
import { runCommandAndEcho, runInheritedRaw } from './commands.js';
import type { CliOptions, RuntimeConfig } from './types.js';

export function cloneTemplate(targetDir: string, resume: boolean): void {
  if (!targetDir) {
    throw new Error('Project directory is not set; cannot clone template.');
  }

  if (resume && fs.existsSync(path.join(targetDir, '.git'))) {
    console.log('Project directory already exists; skipping clone.');
    return;
  }

  if (resume && fs.existsSync(targetDir)) {
    const entries = fs.readdirSync(targetDir);
    if (entries.length > 0) {
      throw new Error(
        `Cannot resume cloning because the project directory is incomplete: ${targetDir}. Remove only this incomplete directory and rerun create.`
      );
    }
  }

  if (fs.existsSync(targetDir)) {
    const entries = fs.readdirSync(targetDir);
    if (entries.length > 0) {
      throw new Error(`Target directory is not empty: ${targetDir}`);
    }
  }

  const args = [
    'clone',
    '--origin',
    'upstream',
    DEFAULT_TEMPLATE_URL,
    targetDir,
  ];
  runInheritedRaw('git', args, process.cwd());
}

export function initializeGit(targetDir: string): void {
  ensureGitignoreEntry(targetDir, STATE_DIR);

  const gitDir = path.join(targetDir, '.git');
  if (!fs.existsSync(gitDir)) {
    throw new Error(
      'Template Git history is missing; cannot configure the upstream remote.'
    );
  }

  configureTemplateUpstream(targetDir);
  configureSafePushDefaults(targetDir);
  runInheritedRaw('git', ['add', '.'], targetDir);
}

export function createGithubRepo(config: RuntimeConfig): RuntimeConfig {
  if (gitRemoteExists(config.targetDir, 'origin')) {
    console.log('Git remote origin already exists; skipping repo creation.');
    return {
      ...config,
      githubRepoUrl: getGithubRepoWebUrl(config.githubRepo, config.targetDir),
    };
  }

  const repo = config.githubRepo;
  const viewResult = spawnSync('gh', ['repo', 'view', repo], {
    cwd: config.targetDir,
    stdio: 'ignore',
  });

  if (viewResult.status === 0) {
    const remoteUrl = getGithubRepoUrl(repo, config.targetDir);
    runInheritedRaw(
      'git',
      ['remote', 'add', 'origin', remoteUrl],
      config.targetDir
    );
    return { ...config, githubRepoUrl: remoteUrl.replace(/\.git$/, '') };
  }

  runInheritedRaw(
    'gh',
    ['repo', 'create', repo, '--private', '--source=.', '--remote=origin'],
    config.targetDir
  );

  return {
    ...config,
    githubRepoUrl: getGithubRepoWebUrl(repo, config.targetDir),
  };
}

export function deleteGithubRepo(
  options: CliOptions,
  config: RuntimeConfig
): void {
  const repo = options.githubRepo || config.githubRepo || config.projectName;
  runCommandAndEcho('gh', ['repo', 'delete', repo, '--yes'], config);
}

export function commitAndPush(config: RuntimeConfig): void {
  if (!gitRemoteExists(config.targetDir, 'origin')) {
    console.log('Git remote origin is not configured; skipping push.');
    return;
  }

  runInheritedRaw('git', ['add', '.'], config.targetDir);

  if (hasGitChanges(config.targetDir)) {
    runInheritedRaw(
      'git',
      ['commit', '-m', 'chore: initialize TanStarter project'],
      config.targetDir
    );
  } else if (!hasGitCommit(config.targetDir)) {
    console.log('No files to commit; skipping push.');
    return;
  }

  runInheritedRaw('git', ['branch', '-M', 'main'], config.targetDir);
  runInheritedRaw('git', ['push', '-u', 'origin', 'main'], config.targetDir);
}

export function checkGitIdentity(): void {
  const email = spawnSync('git', ['config', '--get', 'user.email'], {
    cwd: process.cwd(),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  const name = spawnSync('git', ['config', '--get', 'user.name'], {
    cwd: process.cwd(),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });

  if (
    email.status !== 0 ||
    name.status !== 0 ||
    typeof email.stdout !== 'string' ||
    typeof name.stdout !== 'string' ||
    email.stdout.trim() === '' ||
    name.stdout.trim() === ''
  ) {
    throw new Error(
      'Git user.name and user.email are required for the initial commit.'
    );
  }
}

function gitRemoteExists(cwd: string, remote: string): boolean {
  const result = spawnSync('git', ['remote', 'get-url', remote], {
    cwd,
    stdio: 'ignore',
  });
  return result.status === 0;
}

function configureTemplateUpstream(cwd: string): void {
  if (gitRemoteExists(cwd, 'upstream')) {
    runInheritedRaw(
      'git',
      ['remote', 'set-url', 'upstream', DEFAULT_TEMPLATE_URL],
      cwd
    );
    return;
  }

  if (
    gitRemoteExists(cwd, 'origin') &&
    getGitRemoteUrl(cwd, 'origin') === DEFAULT_TEMPLATE_URL
  ) {
    runInheritedRaw('git', ['remote', 'rename', 'origin', 'upstream'], cwd);
    return;
  }

  runInheritedRaw(
    'git',
    ['remote', 'add', 'upstream', DEFAULT_TEMPLATE_URL],
    cwd
  );
}

function configureSafePushDefaults(cwd: string): void {
  const branch = getCurrentBranch(cwd);

  runInheritedRaw('git', ['config', 'remote.pushDefault', 'origin'], cwd);
  runInheritedRaw('git', ['config', 'push.default', 'current'], cwd);
  runInheritedRaw(
    'git',
    ['config', `branch.${branch}.pushRemote`, 'origin'],
    cwd
  );
  runInheritedRaw(
    'git',
    ['config', 'remote.upstream.pushurl', 'DISABLED'],
    cwd
  );
}

function getCurrentBranch(cwd: string): string {
  const result = spawnSync('git', ['branch', '--show-current'], {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  const branch =
    result.status === 0 && typeof result.stdout === 'string'
      ? result.stdout.trim()
      : '';

  if (!branch) {
    throw new Error('Could not resolve the current Git branch.');
  }

  return branch;
}

function getGitRemoteUrl(cwd: string, remote: string): string {
  const result = spawnSync('git', ['remote', 'get-url', remote], {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });

  if (result.status !== 0 || typeof result.stdout !== 'string') {
    throw new Error(`Could not resolve Git remote ${remote}.`);
  }

  return result.stdout.trim();
}

function hasGitChanges(cwd: string): boolean {
  const result = spawnSync('git', ['status', '--porcelain'], {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  return typeof result.stdout === 'string' && result.stdout.trim() !== '';
}

function hasGitCommit(cwd: string): boolean {
  const result = spawnSync('git', ['rev-parse', '--verify', 'HEAD'], {
    cwd,
    stdio: 'ignore',
  });
  return result.status === 0;
}

function getGithubRepoUrl(repo: string, cwd: string): string {
  const result = spawnSync(
    'gh',
    ['repo', 'view', repo, '--json', 'url', '--jq', '.url'],
    {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }
  );

  if (result.status !== 0 || typeof result.stdout !== 'string') {
    throw new Error(`Could not resolve GitHub repo URL for ${repo}.`);
  }

  return `${result.stdout.trim().replace(/\.git$/, '')}.git`;
}

function getGithubRepoWebUrl(repo: string, cwd: string): string {
  return getGithubRepoUrl(repo, cwd).replace(/\.git$/, '');
}

function ensureGitignoreEntry(targetDir: string, entry: string): void {
  const gitignorePath = path.join(targetDir, '.gitignore');
  const existing = fs.existsSync(gitignorePath)
    ? fs.readFileSync(gitignorePath, 'utf8')
    : '';
  const lines = existing.split(/\r?\n/);

  if (lines.includes(entry)) return;

  const next = `${existing.replace(/\n*$/, '')}\n${entry}\n`;
  fs.writeFileSync(gitignorePath, next, 'utf8');
}
