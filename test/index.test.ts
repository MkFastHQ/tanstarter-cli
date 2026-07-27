import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { describe, expect, it, vi } from 'vitest';

import { parseArgs } from '../src/args.ts';
import {
  buildR2ObjectPath,
  buildR2ObjectsPath,
  parseD1DatabaseId,
  parseKVNamespaceId,
} from '../src/cloudflare.ts';
import { runCommand, shellForPlatform } from '../src/commands.ts';
import { DEFAULT_TEMPLATE_URL } from '../src/constants.ts';
import { ensureEnvFiles, formatEnvValue } from '../src/env.ts';
import { initializeGit } from '../src/git.ts';
import { isCliEntrypoint } from '../src/index.ts';
import { getInstallPlan } from '../src/preflight.ts';
import { formatDefaultGithubRepo } from '../src/prompt.ts';
import { readExistingState, writeState } from '../src/state.ts';
import type { RuntimeConfig } from '../src/types.ts';
import {
  normalizeSlug,
  validateDomain,
  validateGithubRepo,
  validateSlug,
} from '../src/validators.ts';
import { stripJsonc, writeWranglerConfig } from '../src/wrangler-config.ts';

function createTestConfig(overrides: Partial<RuntimeConfig> = {}): RuntimeConfig {
  return {
    projectName: 'demo-app',
    targetDir: fs.mkdtempSync(path.join(os.tmpdir(), 'tanstarter-test-')),
    domain: '',
    githubRepo: 'demo-app',
    cloudflareAccountId: 'account-id',
    cloudflareApiToken: 'api-token',
    d1DatabaseName: 'demo-app-db',
    d1DatabaseId: 'database-id',
    r2BucketName: 'demo-app-bucket',
    kvNamespaceName: 'demo-app-kv',
    kvNamespaceId: '0123456789abcdef0123456789abcdef',
    ...overrides,
  };
}

function runGit(cwd: string, args: string[]): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

describe('parseArgs', () => {
  it('parses create without a project name for interactive prompts', () => {
    const options = parseArgs(['create']);

    expect(options).toMatchObject({
      command: 'create',
      projectName: '',
      targetDir: '',
      resume: false,
    });
  });

  it('normalizes an optional create project name and applies defaults', () => {
    const options = parseArgs(['create', 'My App']);

    expect(options.command).toBe('create');
    expect(options.projectName).toBe('my-app');
    expect(options.targetDir).toBe(`${process.cwd()}/my-app`);
    expect(options.resume).toBe(false);
  });

  it('parses supported option values and boolean flags', () => {
    const options = parseArgs([
      'create',
      'demo-app',
      '--domain=demo.example.com',
      '--repo',
      'mkfasthq/demo-app',
      '--resume',
    ]);

    expect(options).toMatchObject({
      projectName: 'demo-app',
      domain: 'demo.example.com',
      githubRepo: 'mkfasthq/demo-app',
      resume: true,
    });
    expect(options.targetDir).toBe(`${process.cwd()}/demo-app`);
  });

  it('parses the delete command', () => {
    const options = parseArgs(['delete', 'demo-app']);

    expect(options).toMatchObject({
      command: 'delete',
      projectName: 'demo-app',
    });
  });

  it('rejects unknown flags, missing commands, and misplaced commands', () => {
    expect(() => parseArgs(['--unknown'])).toThrow('Unknown option: --unknown');
    expect(() => parseArgs([])).toThrow('Command is required.');
    expect(() => parseArgs(['demo-app'])).toThrow('Command is required.');
    expect(() => parseArgs(['delete'])).toThrow(
      'Project name is required for delete.'
    );
    expect(() => parseArgs(['create', 'demo-app', 'delete'])).toThrow(
      'delete must be the first positional argument.'
    );
  });

  it('requires a project name when resuming create', () => {
    expect(() => parseArgs(['create', '--resume'])).toThrow(
      'Project name is required when using --resume.'
    );
  });
});

describe('validation helpers', () => {
  it('normalizes slugs consistently', () => {
    expect(normalizeSlug('  Hello, TanStarter!!  ')).toBe('hello-tanstarter');
    expect(normalizeSlug('A---B___C')).toBe('a-b-c');
  });

  it('validates slug shape', () => {
    expect(() => validateSlug('abc', 'project name')).not.toThrow();
    expect(() => validateSlug('ab', 'project name')).toThrow(
      'project name must be 3-63 chars'
    );
    expect(() => validateSlug('-abc', 'project name')).toThrow(
      'project name must be 3-63 chars'
    );
  });

  it('validates simple domain names', () => {
    expect(() => validateDomain('app.example.com')).not.toThrow();
    expect(() => validateDomain('-bad.example.com')).toThrow(
      '--domain must be a valid domain name.'
    );
  });

  it('validates GitHub repo names', () => {
    expect(() => validateGithubRepo('demo-app')).not.toThrow();
    expect(() => validateGithubRepo('mkfasthq/demo-app')).not.toThrow();
    expect(() => validateGithubRepo('mkfasthq/demo/app')).toThrow(
      '--repo must be a GitHub repo name or owner/name.'
    );
  });
});

describe('wrangler output parsing', () => {
  it('parses D1 database ids from JSON-like and plain output', () => {
    const id = '12345678-1234-1234-1234-123456789abc';

    expect(parseD1DatabaseId(`"database_id": "${id}"`)).toBe(id);
    expect(parseD1DatabaseId(`Created database ${id}`)).toBe(id);
  });

  it('parses KV namespace ids from JSON-like and plain output', () => {
    const id = '0123456789abcdef0123456789abcdef';

    expect(parseKVNamespaceId(`id = "${id}"`)).toBe(id);
    expect(parseKVNamespaceId(`namespace ${id} created`)).toBe(id);
  });
});

describe('Cloudflare API helpers', () => {
  it('builds R2 object paths with encoded bucket and object keys', () => {
    const config = createTestConfig({
      cloudflareAccountId: 'abc123',
      r2BucketName: 'demo bucket',
    });

    expect(buildR2ObjectsPath(config)).toBe(
      '/accounts/abc123/r2/buckets/demo%20bucket/objects'
    );
    expect(buildR2ObjectPath(config, 'avatars/user 1/你好.png')).toBe(
      '/accounts/abc123/r2/buckets/demo%20bucket/objects/avatars%2Fuser%201%2F%E4%BD%A0%E5%A5%BD.png'
    );
  });
});

describe('file content helpers', () => {
  it('strips JSONC comments and trailing commas', () => {
    const jsonc = `{
      // comment
      "name": "demo",
      "nested": {
        "enabled": true,
      },
    }`;

    expect(JSON.parse(stripJsonc(jsonc))).toEqual({
      name: 'demo',
      nested: { enabled: true },
    });
  });

  it('quotes env values and escapes single quotes', () => {
    expect(formatEnvValue("that's fine")).toBe("'that\\'s fine'");
  });

  it('keeps local env base URL on localhost', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tanstarter-env-'));
    fs.writeFileSync(
      path.join(tempDir, '.env.example'),
      'VITE_BASE_URL=\nBETTER_AUTH_SECRET=\n',
      'utf8'
    );

    ensureEnvFiles({
      ...createTestConfig(),
      targetDir: tempDir,
      domain: 'app.example.com',
    });

    expect(fs.readFileSync(path.join(tempDir, '.env'), 'utf8')).toContain(
      "VITE_BASE_URL='http://localhost:3000'"
    );
    expect(
      fs.readFileSync(path.join(tempDir, '.env.production'), 'utf8')
    ).toContain("VITE_BASE_URL='https://app.example.com'");
  });

  it('uses deploymentUrl for production env when no custom domain is set', () => {
    const config = createTestConfig({
      deploymentUrl: 'https://demo-app.example.workers.dev',
    });
    fs.writeFileSync(path.join(config.targetDir, '.env.example'), '', 'utf8');

    ensureEnvFiles(config);

    expect(
      fs.readFileSync(path.join(config.targetDir, '.env.production'), 'utf8')
    ).toContain("VITE_BASE_URL='https://demo-app.example.workers.dev'");
  });
});

describe('wrangler config writing', () => {
  it('writes D1, R2, KV, and custom domain settings', () => {
    const config = createTestConfig({ domain: 'app.example.com' });
    fs.writeFileSync(
      path.join(config.targetDir, 'wrangler.jsonc'),
      `{
        // existing template setting
        "compatibility_date": "2026-07-04",
      }`,
      'utf8'
    );

    writeWranglerConfig(config);

    const wranglerConfig = JSON.parse(
      stripJsonc(fs.readFileSync(path.join(config.targetDir, 'wrangler.jsonc'), 'utf8'))
    );

    expect(wranglerConfig).toMatchObject({
      compatibility_date: '2026-07-04',
      name: 'demo-app',
      routes: [{ pattern: 'app.example.com', custom_domain: true }],
      d1_databases: [
        {
          binding: 'DB',
          database_name: 'demo-app-db',
          database_id: 'database-id',
          migrations_dir: './src/db/migrations',
        },
      ],
      r2_buckets: [
        {
          binding: 'BUCKET',
          bucket_name: 'demo-app-bucket',
        },
      ],
      kv_namespaces: [
        {
          binding: 'CACHE',
          id: '0123456789abcdef0123456789abcdef',
        },
      ],
    });
  });

  it('removes active routes and leaves commented guidance without a domain', () => {
    const config = createTestConfig();
    fs.writeFileSync(
      path.join(config.targetDir, 'wrangler.jsonc'),
      JSON.stringify({
        routes: [{ pattern: 'old.example.com', custom_domain: true }],
      }),
      'utf8'
    );

    writeWranglerConfig(config);

    const content = fs.readFileSync(
      path.join(config.targetDir, 'wrangler.jsonc'),
      'utf8'
    );
    const wranglerConfig = JSON.parse(stripJsonc(content));

    expect(wranglerConfig.routes).toBeUndefined();
    expect(content).toContain('Custom domains are disabled by TanStarter CLI.');
  });
});

describe('command runner', () => {
  it('uses the shell on Windows so .cmd shims can be resolved from PATH', () => {
    expect(shellForPlatform('win32')).toBe(true);
    expect(shellForPlatform('darwin')).toBe(false);
    expect(shellForPlatform('linux')).toBe(false);
  });

  it('prints the command and injects Cloudflare environment variables', () => {
    const config = createTestConfig();
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      const result = runCommand(
        process.execPath,
        [
          '-e',
          'console.log(`${process.env.CLOUDFLARE_ACCOUNT_ID}:${process.env.CLOUDFLARE_DATABASE_ID}`)',
        ],
        config
      );

      expect(result.stdout.trim()).toBe('account-id:database-id');
      expect(log).toHaveBeenCalledWith(
        expect.stringContaining('💻 $')
      );
    } finally {
      log.mockRestore();
    }
  });

  it('surfaces the spawn failure reason when a command cannot start', () => {
    const config = createTestConfig();
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      expect(() =>
        runCommand('tanstarter-nonexistent-binary', ['--version'], config)
      ).toThrow(/ENOENT|spawn/i);
    } finally {
      log.mockRestore();
    }
  });
});

describe('Git initialization', () => {
  it('preserves template history and renames its remote to upstream', () => {
    const targetDir = fs.mkdtempSync(
      path.join(os.tmpdir(), 'tanstarter-git-')
    );
    runGit(targetDir, ['init', '-b', 'main']);
    fs.writeFileSync(path.join(targetDir, 'README.md'), '# Template\n', 'utf8');
    fs.writeFileSync(path.join(targetDir, '.gitignore'), 'node_modules\n', 'utf8');
    runGit(targetDir, ['add', '.']);
    runGit(targetDir, [
      '-c',
      'user.name=TanStarter Test',
      '-c',
      'user.email=test@example.com',
      'commit',
      '-m',
      'template base',
    ]);
    const templateHead = runGit(targetDir, ['rev-parse', 'HEAD']);
    runGit(targetDir, ['remote', 'add', 'origin', DEFAULT_TEMPLATE_URL]);

    initializeGit(targetDir);

    expect(runGit(targetDir, ['rev-parse', 'HEAD'])).toBe(templateHead);
    expect(runGit(targetDir, ['remote'])).toBe('upstream');
    expect(runGit(targetDir, ['remote', 'get-url', 'upstream'])).toBe(
      DEFAULT_TEMPLATE_URL
    );
    expect(runGit(targetDir, ['status', '--short', '.gitignore'])).toBe(
      'M  .gitignore'
    );
  });

  it('keeps an existing origin while adding the template upstream', () => {
    const targetDir = fs.mkdtempSync(
      path.join(os.tmpdir(), 'tanstarter-git-')
    );
    runGit(targetDir, ['init', '-b', 'main']);
    runGit(targetDir, [
      'remote',
      'add',
      'origin',
      'https://github.com/example/demo-app.git',
    ]);

    initializeGit(targetDir);
    initializeGit(targetDir);

    expect(runGit(targetDir, ['remote', 'get-url', 'origin'])).toBe(
      'https://github.com/example/demo-app.git'
    );
    expect(runGit(targetDir, ['remote', 'get-url', 'upstream'])).toBe(
      DEFAULT_TEMPLATE_URL
    );
  });
});

describe('setup state', () => {
  it('normalizes older state files without a stored GitHub repo', () => {
    const config = {
      ...createTestConfig(),
      projectName: 'demo-app',
    } as RuntimeConfig;

    writeState(config.targetDir, {
      completedSteps: [],
      config,
      updatedAt: new Date().toISOString(),
    });

    const state = readExistingState(config.targetDir);

    expect(state.config.githubRepo).toBe('demo-app');
  });
});

describe('install planning', () => {
  const has = (...commands: string[]) => (command: string) =>
    commands.includes(command);

  it('uses corepack for pnpm when available', () => {
    expect(getInstallPlan('pnpm', 'darwin', has('corepack'))).toEqual([
      { command: 'corepack', args: ['enable'] },
      { command: 'corepack', args: ['prepare', 'pnpm@latest', '--activate'] },
    ]);
  });

  it('uses Homebrew for GitHub CLI on macOS', () => {
    expect(getInstallPlan('gh', 'darwin', has('brew'))).toEqual([
      { command: 'brew', args: ['install', 'gh'] },
    ]);
  });

  it('uses sudo apt-get for git on non-root Linux', () => {
    expect(getInstallPlan('git', 'linux', has('apt-get'), false)).toEqual([
      { command: 'sudo', args: ['apt-get', 'update'] },
      { command: 'sudo', args: ['apt-get', 'install', '-y', 'git'] },
    ]);
  });
});

describe('setup prompts', () => {
  it('defaults the GitHub repo to the current GitHub login and project name', () => {
    expect(formatDefaultGithubRepo('myapp4', 'myapp4', 'open-fox')).toBe(
      'open-fox/myapp4'
    );
    expect(
      formatDefaultGithubRepo('myapp4', 'mkfasthq/custom-repo', 'open-fox')
    ).toBe('mkfasthq/custom-repo');
  });
});

describe('entrypoint detection', () => {
  it('treats npm bin symlinks as the CLI entrypoint', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tanstarter-bin-'));
    const realEntrypoint = path.join(tempDir, 'index.js');
    const symlinkEntrypoint = path.join(tempDir, 'tanstarter');

    fs.writeFileSync(realEntrypoint, '#!/usr/bin/env node\n', 'utf8');
    fs.symlinkSync(realEntrypoint, symlinkEntrypoint);

    expect(
      isCliEntrypoint(symlinkEntrypoint, pathToFileURL(realEntrypoint).href)
    ).toBe(true);
  });
});
