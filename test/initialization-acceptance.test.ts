import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseArgs } from '../src/args.js';
import { createConfig } from '../src/config.js';
import { configureWebsiteMail, readWebsiteSettings } from '../src/website.js';
import { sendTestEmail } from '../src/email-test.js';
import { verifyGithubDeployment } from '../src/github-deployment.js';
import {
  applyEmailOptions,
  readExistingState,
  writeState,
} from '../src/state.js';
import * as cloudflare from '../src/cloudflare.js';
import * as commands from '../src/commands.js';
import * as github from '../src/github-deployment.js';
import * as preflight from '../src/preflight.js';
import * as deployment from '../src/deployment.js';
import * as emailTest from '../src/email-test.js';
import * as git from '../src/git.js';
import { main } from '../src/index.js';
import type { SetupState } from '../src/types.js';

const dirs: string[] = [];
const originalArgv = process.argv;
const website = `import { something } from './other';
// Preserve this comment and unrelated settings.
export const websiteConfig = {
  auth: { enable: true, enableGoogleLogin: true, enableCredentialLogin: true },
  mail: { enable: true, provider: 'cloudflare', fromEmail: 'TanStarter <support@tanstarter.dev>', supportEmail: 'TanStarter <support@tanstarter.dev>' },
  newsletter: { enable: false, provider: 'resend' },
  notification: { enable: false, provider: 'discord' },
  storage: { enable: false }, cache: { enable: false },
  metadata: { get title() { throw new Error('MUST NOT EXECUTE'); } },
};\n`;
function config(source = website) {
  vi.stubEnv('CLOUDFLARE_ACCOUNT_ID', 'account-id');
  vi.stubEnv('CLOUDFLARE_API_TOKEN', 'secret-token-do-not-print');
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), 'tanstarter-acceptance-')
  );
  dirs.push(directory);
  // The CLI normalizes project names to lowercase. Keep the random parent
  // outside the project name so case-sensitive filesystems load the same state.
  const targetDir = path.join(directory, 'demo');
  fs.mkdirSync(path.join(targetDir, 'src/config'), { recursive: true });
  fs.writeFileSync(path.join(targetDir, 'src/config/website.ts'), source);
  return {
    ...createConfig(
      parseArgs([
        'create',
        'demo',
        '--domain',
        'example.com',
        '--email-sending',
        '--payment',
        'none',
      ])
    ),
    targetDir,
  };
}
function state(): SetupState {
  return {
    config: config(),
    completedSteps: [],
    updatedAt: new Date().toISOString(),
  };
}
afterEach(() => {
  process.argv = originalArgv;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  for (const dir of dirs.splice(0))
    fs.rmSync(dir, { recursive: true, force: true });
});

describe('application mail setup', () => {
  it('changes only opted-in mail fields, preserves code, and is idempotent', () => {
    const value = config();
    configureWebsiteMail(value);
    const file = path.join(value.targetDir, 'src/config/website.ts');
    const first = fs.readFileSync(file, 'utf8');
    expect(first).toContain("import { something } from './other'");
    expect(first).toContain('// Preserve this comment');
    expect(first).toContain(
      "get title() { throw new Error('MUST NOT EXECUTE'); }"
    );
    expect(readWebsiteSettings(value.targetDir).mail).toEqual({
      enable: true,
      provider: 'cloudflare',
      fromEmail: 'demo <support@example.com>',
      supportEmail: 'demo <support@example.com>',
    });
    configureWebsiteMail(value);
    expect(fs.readFileSync(file, 'utf8')).toBe(first);
  });
  it('leaves projects without sending opt-in unchanged', () => {
    const value = { ...config(), emailSending: false };
    configureWebsiteMail(value);
    expect(
      fs.readFileSync(
        path.join(value.targetDir, 'src/config/website.ts'),
        'utf8'
      )
    ).toBe(website);
  });
  it('preserves a custom sender on the verified domain and an external support mailbox', () => {
    const value = config(
      website
        .replace(
          'TanStarter <support@tanstarter.dev>',
          'Team <hello@example.com>'
        )
        .replace(
          'TanStarter <support@tanstarter.dev>',
          'Help <help@external.com>'
        )
    );
    configureWebsiteMail(value);
    expect(readWebsiteSettings(value.targetDir).mail).toMatchObject({
      fromEmail: 'Team <hello@example.com>',
      supportEmail: 'Help <help@external.com>',
    });
  });
  it.each([
    website.replace(
      "provider: 'cloudflare'",
      "...mailSettings, provider: 'cloudflare'"
    ),
    website.replace(
      "fromEmail: 'TanStarter <support@tanstarter.dev>'",
      'fromEmail: getSender()'
    ),
    website.replace(
      'TanStarter <support@tanstarter.dev>',
      'Other <mail@other.example>'
    ),
    website.replace('auth: {', '...otherSettings, auth: {'),
  ])(
    'rejects unsupported or conflicting mail configuration without partial writes',
    (source) => {
      const value = config(source);
      expect(() => configureWebsiteMail(value)).toThrow();
      expect(
        fs.readFileSync(
          path.join(value.targetDir, 'src/config/website.ts'),
          'utf8'
        )
      ).toBe(source);
    }
  );
});

describe('explicit provider send test', () => {
  it('parses and validates both flag forms', () => {
    expect(
      parseArgs(['create', 'demo', '--email-test-to', 'me@example.com'])
        .emailTestTo
    ).toBe('me@example.com');
    expect(
      parseArgs(['create', 'demo', '--email-test-to=me@example.com'])
        .emailTestTo
    ).toBe('me@example.com');
    expect(() =>
      parseArgs(['create', 'demo', '--email-test-to=invalid'])
    ).toThrow('email address');
    expect(() =>
      parseArgs([
        'create',
        'demo',
        '--email-test-to=me@example.com\nBCC:other@example.com',
      ])
    ).toThrow();
  });
  it.each([
    [
      { delivered: ['recipient-id'], queued: [], permanent_bounces: [] },
      'accepted',
    ],
    [
      { delivered: [], queued: ['recipient-id'], permanent_bounces: [] },
      'queued',
    ],
    [
      { delivered: [], queued: [], permanent_bounces: ['recipient-id'] },
      'failed',
    ],
    [
      { delivered: ['recipient-id'], permanent_bounces: ['recipient-id'] },
      'failed',
    ],
    [{ delivered: [], queued: [], permanent_bounces: [] }, 'unknown'],
  ] as const)(
    'interprets provider outcomes without claiming inbox receipt',
    async (result, status) => {
      const value = { ...config(), emailTestTo: 'me@example.com' };
      configureWebsiteMail(value);
      const fetch = vi
        .fn()
        .mockResolvedValue(Response.json({ success: true, result }));
      vi.stubGlobal('fetch', fetch);
      expect((await sendTestEmail(value)).status).toBe(status);
      expect(fetch).toHaveBeenCalledTimes(1);
      const [url, request] = fetch.mock.calls[0]!;
      expect(url).toContain('/accounts/account-id/email/sending/send');
      expect(JSON.parse(request.body)).toMatchObject({
        to: 'me@example.com',
        from: 'demo <support@example.com>',
      });
      expect(JSON.parse(request.body)).toHaveProperty('text');
      expect(JSON.parse(request.body)).toHaveProperty('html');
    }
  );
  it('does not retry a timeout and does not log credentials or response bodies', async () => {
    const value = { ...config(), emailTestTo: 'me@example.com' };
    configureWebsiteMail(value);
    const fetch = vi
      .fn()
      .mockRejectedValue(new Error('secret-token-do-not-print'));
    vi.stubGlobal('fetch', fetch);
    const log = vi.spyOn(console, 'log');
    expect((await sendTestEmail(value)).status).toBe('unknown');
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(log).not.toHaveBeenCalled();
  });
  it('refuses to send without a recipient or opted-in compatible application mail', async () => {
    const value = config();
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    await expect(sendTestEmail(value)).rejects.toThrow('--email-test-to');
    await expect(
      sendTestEmail({ ...value, emailTestTo: 'me@example.com' })
    ).rejects.toThrow('onboarded domain');
    expect(fetch).not.toHaveBeenCalled();
  });
  it('persists explicit retry authorization while preserving completed deployment steps', () => {
    const current = state();
    current.config.emailTestResult = {
      to: 'old@example.com',
      from: 'demo <support@example.com>',
      status: 'unknown',
    };
    current.completedSteps = [
      'test-email',
      'commit-and-push',
      'verify-github-deployment',
    ];
    const next = applyEmailOptions(
      current,
      parseArgs([
        'create',
        'demo',
        '--resume',
        '--email-test-to=new@example.com',
      ])
    );
    expect(next.completedSteps).toEqual([
      'commit-and-push',
      'verify-github-deployment',
    ]);
    expect(readExistingState(next.config.targetDir).config.emailTestTo).toBe(
      'new@example.com'
    );
    expect(
      readExistingState(next.config.targetDir).config.emailTestResult
    ).toBeUndefined();
    const unchanged = applyEmailOptions(
      { ...next, completedSteps: ['test-email'] },
      parseArgs(['create', 'demo', '--resume'])
    );
    expect(unchanged.completedSteps).toContain('test-email');
  });
  it('handles HTTP rejection without exposing server errors', async () => {
    const value = { ...config(), emailTestTo: 'me@example.com' };
    configureWebsiteMail(value);
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          Response.json(
            { success: false, errors: ['secret-token-do-not-print'] },
            { status: 403 }
          )
        )
    );
    expect(await sendTestEmail(value)).toMatchObject({ status: 'failed' });
  });
});

describe('initial commit Actions deployment', () => {
  function setup() {
    const value = {
      ...config(),
      initialCommitSha: 'a'.repeat(40),
      githubRepo: 'owner/demo',
    };
    const run = vi
      .spyOn(commands, 'runCommand')
      .mockReturnValue({ stdout: 'owner/demo', stderr: '' });
    const workflow = {
      databaseId: 10,
      headSha: value.initialCommitSha,
      event: 'push',
      headBranch: 'main',
      status: 'completed',
      conclusion: 'success',
      url: 'https://github.com/owner/demo/actions/runs/10',
    };
    return { value, run, workflow };
  }
  it('ignores other SHAs, branches and events; waits for the matching run', async () => {
    const { value, run, workflow } = setup();
    run
      .mockReturnValueOnce({ stdout: 'owner/demo', stderr: '' })
      .mockReturnValueOnce({
        stdout: JSON.stringify([
          { ...workflow, headSha: 'b'.repeat(40) },
          { ...workflow, event: 'workflow_dispatch' },
          { ...workflow, headBranch: 'other' },
        ]),
        stderr: '',
      })
      .mockReturnValueOnce({
        stdout: JSON.stringify([
          { ...workflow, status: 'in_progress', conclusion: null },
        ]),
        stderr: '',
      })
      .mockReturnValueOnce({ stdout: JSON.stringify([workflow]), stderr: '' });
    const sleep = vi.fn().mockResolvedValue(undefined);
    const onRun = vi.fn();
    expect(
      await verifyGithubDeployment(value, { maxAttempts: 3, sleep, onRun })
    ).toMatchObject({ conclusion: 'success', headSha: value.initialCommitSha });
    expect(sleep).toHaveBeenCalledTimes(2);
    expect(onRun).toHaveBeenCalledTimes(2);
    expect(run.mock.calls[1]?.[1]).toEqual(
      expect.arrayContaining([
        '--workflow',
        'deploy.yml',
        '--commit',
        value.initialCommitSha,
        '--event',
        'push',
      ])
    );
  });
  it.each(['failure', 'cancelled', 'timed_out', 'skipped', 'action_required'])(
    'fails visibly for terminal conclusion %s',
    async (conclusion) => {
      const { value, run, workflow } = setup();
      run
        .mockReturnValueOnce({ stdout: 'owner/demo', stderr: '' })
        .mockReturnValueOnce({
          stdout: JSON.stringify([{ ...workflow, conclusion }]),
          stderr: '',
        });
      await expect(
        verifyGithubDeployment(value, { maxAttempts: 1 })
      ).rejects.toThrow(workflow.url);
    }
  );
  it('times out rather than treating an absent workflow as success', async () => {
    const { value, run } = setup();
    run
      .mockReturnValueOnce({ stdout: 'owner/demo', stderr: '' })
      .mockReturnValue({ stdout: '[]', stderr: '' });
    await expect(
      verifyGithubDeployment(value, { maxAttempts: 1 })
    ).rejects.toThrow('Timed out');
  });
  it('recovers from transient queries and resolves short repo names from origin', async () => {
    const { value, run, workflow } = setup();
    run
      .mockReturnValueOnce({ stdout: 'owner/demo', stderr: '' })
      .mockImplementationOnce(() => {
        throw new Error('temporary');
      })
      .mockReturnValueOnce({ stdout: JSON.stringify([workflow]), stderr: '' });
    await expect(
      verifyGithubDeployment(
        { ...value, githubRepo: 'demo' },
        { maxAttempts: 2, sleep: async () => {} }
      )
    ).resolves.toMatchObject({ conclusion: 'success' });
    expect(run.mock.calls[0]?.[1]).toEqual([
      'repo',
      'view',
      '--json',
      'nameWithOwner',
      '--jq',
      '.nameWithOwner',
    ]);
  });
  it('preserves the matching run result for resume and reporting', async () => {
    const { value, run, workflow } = setup();
    const current: SetupState = {
      config: value,
      completedSteps: [],
      updatedAt: '',
    };
    run
      .mockReturnValueOnce({ stdout: 'owner/demo', stderr: '' })
      .mockReturnValueOnce({
        stdout: JSON.stringify([{ ...workflow, conclusion: 'failure' }]),
        stderr: '',
      });
    await expect(
      verifyGithubDeployment(value, {
        maxAttempts: 1,
        onRun: (githubDeployment) =>
          writeState(value.targetDir, {
            ...current,
            config: { ...value, githubDeployment },
          }),
      })
    ).rejects.toThrow('failure');
    expect(
      readExistingState(value.targetDir).config.githubDeployment?.conclusion
    ).toBe('failure');
  });
});

describe('deployment with required secrets', () => {
  it.each([false, true])('supplies literal production values and removes the secret file (command fails: %s)', (fails) => {
    const value = config();
    vi.stubEnv('BETTER_AUTH_SECRET', 'ambient-must-not-override');
    fs.writeFileSync(
      path.join(value.targetDir, '.env.production'),
      `VITE_BASE_URL='https://example.com'\nBETTER_AUTH_SECRET='literal-$VALUE-\${TOKEN}'\nWAFFO_PRIVATE_KEY="line1\\nline2"\n`
    );
    let secretFile = '';
    const run = vi.spyOn(commands, 'runCommandAndEcho').mockImplementation(
      (command, args, receivedConfig) => {
        expect(command).toBe('pnpm');
        expect(args.slice(0, 3)).toEqual(['run', 'deploy', '--secrets-file']);
        expect(receivedConfig).toBe(value);
        secretFile = args[3]!;
        const secrets = JSON.parse(fs.readFileSync(secretFile, 'utf8'));
        expect(secrets).toEqual({
          VITE_BASE_URL: 'https://example.com',
          BETTER_AUTH_SECRET: 'literal-$VALUE-${TOKEN}',
          WAFFO_PRIVATE_KEY: 'line1\nline2',
        });
        if (process.platform !== 'win32') {
          expect(fs.statSync(secretFile).mode & 0o777).toBe(0o600);
        }
        if (fails) throw new Error('deployment failed');
        return { stdout: 'https://demo.example.workers.dev', stderr: '' };
      }
    );
    if (fails) {
      expect(() => deployment.deployWithSecrets(value)).toThrow('deployment failed');
    } else {
      expect(deployment.deployWithSecrets(value).stdout).toContain('workers.dev');
    }
    expect(run).toHaveBeenCalledTimes(1);
    expect(fs.existsSync(path.dirname(secretFile))).toBe(false);
  });

  it('rejects missing required values before invoking deployment', () => {
    const value = config();
    fs.writeFileSync(path.join(value.targetDir, '.env.production'), 'VITE_BASE_URL=https://example.com\n');
    const run = vi.spyOn(commands, 'runCommandAndEcho');
    expect(() => deployment.deployWithSecrets(value)).toThrow('BETTER_AUTH_SECRET');
    expect(run).not.toHaveBeenCalled();
  });
});

describe('resumed initialization integration', () => {
  function resumed() {
    const current = state();
    configureWebsiteMail(current.config);
    current.config.initialCommitSha = 'a'.repeat(40);
    current.config.emailTestTo = 'me@example.com';
    current.completedSteps = [
      'preflight',
      'clone-template',
      'initialize-git',
      'install',
      'cloudflare-auth',
      'enable-email-sending',
      'create-d1',
      'create-r2',
      'create-kv',
      'write-config',
      'configure-website-mail',
      'cf-typegen',
      'db-migrate-local',
      'db-migrate-remote',
      'deploy',
      'ensure-custom-domain',
      'sync-worker-secrets',
      'verify-public-deployment',
      'create-github-repo',
      'sync-github-secrets',
      'commit-and-push',
    ];
    fs.writeFileSync(
      path.join(current.config.targetDir, 'cloudflare.config.ts'),
      'export default {};'
    );
    fs.writeFileSync(
      path.join(current.config.targetDir, 'package.json'),
      JSON.stringify({ devDependencies: { cf: '1.0.0-beta.30' } })
    );
    writeState(current.config.targetDir, current);
    vi.spyOn(process, 'cwd').mockReturnValue(
      path.dirname(current.config.targetDir)
    );
    process.argv = [
      'node',
      'cli',
      'create',
      path.basename(current.config.targetDir),
      '--resume',
    ];
    expect(parseArgs(process.argv.slice(2)).targetDir).toBe(current.config.targetDir);
    vi.spyOn(preflight, 'assertNodeVersion').mockImplementation(() => {});
    vi.spyOn(preflight, 'preflight').mockImplementation(() => {
      throw new Error('Unexpected preflight: saved resume state was not loaded.');
    });
    vi.spyOn(console, 'log').mockImplementation(() => {});
    return current;
  }
  it('adds catch-all on resume when legacy support forwarding was already completed', async () => {
    const current = resumed();
    current.config.emailForwardTo = 'you@example.net';
    current.completedSteps.push('configure-email-forwarding',
      'verify-github-deployment', 'verify-final-deployment', 'test-email');
    writeState(current.config.targetDir, current);
    const forwarding = vi.spyOn(cloudflare, 'configureEmailForwarding').mockResolvedValue(true);
    await main();
    expect(forwarding).toHaveBeenCalledOnce();
    expect(readExistingState(current.config.targetDir).completedSteps).toContain('configure-email-catch-all');
    await main();
    expect(forwarding).toHaveBeenCalledOnce();
  });

  it('confirms Actions, checks the resulting public site, then sends once; resume does not resend', async () => {
    const current = resumed();
    const events: string[] = [];
    vi.spyOn(github, 'verifyGithubDeployment').mockImplementation(
      async (value, options) => {
        events.push('actions');
        const run = {
          headSha: value.initialCommitSha!,
          status: 'completed',
          conclusion: 'success',
          url: 'https://github.com/owner/demo/actions/runs/10',
        };
        options?.onRun?.(run);
        return run;
      }
    );
    vi.spyOn(deployment, 'verifyPublicDeployment').mockImplementation(
      async () => {
        events.push('http');
      }
    );
    const send = vi
      .spyOn(emailTest, 'sendTestEmail')
      .mockImplementation(async () => {
        events.push('email');
        // The attempt must be durable before the external side effect.
        expect(
          readExistingState(current.config.targetDir).completedSteps
        ).toContain('test-email');
        return {
          to: 'me@example.com',
          from: 'demo <support@example.com>',
          status: 'queued',
        };
      });
    await main();
    expect(events).toEqual(['actions', 'http', 'email']);
    const saved = readExistingState(current.config.targetDir);
    expect(saved.completedSteps).toEqual(
      expect.arrayContaining([
        'verify-github-deployment',
        'verify-final-deployment',
        'test-email',
      ])
    );
    expect(saved.config.emailTestResult?.status).toBe('queued');
    await main();
    expect(send).toHaveBeenCalledTimes(1);
  });
  it('redeploys and pushes mail changes from an older completed initialization before checking the new SHA', async () => {
    const current = resumed();
    fs.writeFileSync(
      path.join(current.config.targetDir, 'src/config/website.ts'),
      website
    );
    current.completedSteps = current.completedSteps.filter(
      (step) => step !== 'configure-website-mail'
    );
    current.completedSteps.push(
      'verify-github-deployment',
      'verify-final-deployment',
      'test-email'
    );
    writeState(current.config.targetDir, current);
    const events: string[] = [];
    vi.spyOn(commands, 'runCommandAndEcho').mockImplementation((_command, args) => {
      expect(args.slice(0, 3)).toEqual(['run', 'deploy', '--secrets-file']);
      const secrets = JSON.parse(fs.readFileSync(args[3]!, 'utf8'));
      expect(secrets.VITE_BASE_URL).toBe('https://example.com');
      expect(secrets.BETTER_AUTH_SECRET).toBeTruthy();
      events.push('deploy');
      return { stdout: 'https://demo.example.workers.dev', stderr: '' };
    });
    vi.spyOn(commands, 'runInheritedNonInteractive').mockImplementation(
      (_command, args) => {
        events.push(args.includes('biome') ? 'format' : 'secrets');
      }
    );
    vi.spyOn(commands, 'runCommand').mockReturnValue({
      stdout: 'b'.repeat(40),
      stderr: '',
    });
    vi.spyOn(git, 'commitAndPush').mockImplementation(() => {
      events.push('push');
    });
    vi.spyOn(deployment, 'verifyPublicDeployment').mockImplementation(
      async () => {
        events.push('http');
      }
    );
    vi.spyOn(github, 'verifyGithubDeployment').mockImplementation(
      async (value, options) => {
        events.push('actions');
        expect(value.initialCommitSha).toBe('b'.repeat(40));
        const run = {
          headSha: value.initialCommitSha!,
          status: 'completed',
          conclusion: 'success',
          url: 'https://github.com/owner/demo/actions/runs/20',
        };
        options?.onRun?.(run);
        return run;
      }
    );
    const send = vi.spyOn(emailTest, 'sendTestEmail');
    await main();
    expect(events).toEqual([
      'deploy',
      'secrets',
      'http',
      'format',
      'push',
      'actions',
      'http',
    ]);
    expect(send).not.toHaveBeenCalled();
    expect(readWebsiteSettings(current.config.targetDir).mail?.fromEmail).toBe(
      'demo <support@example.com>'
    );
    expect(
      readExistingState(current.config.targetDir).config.initialCommitSha
    ).toBe('b'.repeat(40));
  });
  it('does not mark Actions complete, verify the final site, or send if Actions fails', async () => {
    const current = resumed();
    vi.spyOn(github, 'verifyGithubDeployment').mockRejectedValue(
      new Error('Actions failed')
    );
    const verify = vi.spyOn(deployment, 'verifyPublicDeployment');
    const send = vi.spyOn(emailTest, 'sendTestEmail');
    await expect(main()).rejects.toThrow('Actions failed');
    expect(
      readExistingState(current.config.targetDir).completedSteps
    ).not.toContain('verify-github-deployment');
    expect(verify).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });
});
