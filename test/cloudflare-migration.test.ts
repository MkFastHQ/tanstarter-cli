import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { parseArgs } from '../src/args.ts';
import { createConfig } from '../src/config.ts';
import {
  applyD1Migrations,
  cloudflareAuth,
  createD1,
  createKV,
  createR2,
  deleteD1,
  deleteKV,
  deleteR2,
  deleteWorker,
} from '../src/cloudflare.ts';
import { parseDeploymentUrl } from '../src/deployment.ts';
import { assertCloudflareProject } from '../src/cloudflare-config.ts';
import * as commands from '../src/commands.ts';
import { assertNodeVersion } from '../src/preflight.ts';

const dirs: string[] = [];
function config() {
  vi.stubEnv('CLOUDFLARE_ACCOUNT_ID', 'account-id');
  vi.stubEnv('CLOUDFLARE_API_TOKEN', 'test-token');
  const targetDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tanstarter-cf-'));
  dirs.push(targetDir);
  return {
    ...createConfig(parseArgs(['create', 'demo', '--payment', 'none'])),
    targetDir,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  for (const dir of dirs.splice(0))
    fs.rmSync(dir, { recursive: true, force: true });
});

describe('Cloudflare CLI resource lifecycle', () => {
  it('passes database IDs directly instead of depending on shell substitution in template scripts', () => {
    const value = { ...config(), d1DatabaseId: 'db-id' };
    const run = vi
      .spyOn(commands, 'runInheritedNonInteractive')
      .mockImplementation(() => {});
    applyD1Migrations(value, true);
    applyD1Migrations(value, false);
    expect(run.mock.calls.map((call) => call[1])).toEqual([
      [
        'exec',
        'cf',
        'd1',
        'migrations',
        'apply',
        'db-id',
        '--dir',
        'src/db/migrations',
        '--local',
        '--persist-to',
        '.cloudflare/state',
      ],
      [
        'exec',
        'cf',
        'd1',
        'migrations',
        'apply',
        'db-id',
        '--dir',
        'src/db/migrations',
      ],
    ]);
    expect(() =>
      applyD1Migrations({ ...value, d1DatabaseId: '' }, true)
    ).toThrow('database ID');
  });

  it('rejects old templates before provisioning or deleting resources', () => {
    const value = config();
    expect(() => assertCloudflareProject(value.targetDir)).toThrow(
      'cloudflare.config.ts is required'
    );
    fs.writeFileSync(
      path.join(value.targetDir, 'cloudflare.config.ts'),
      'export default {};'
    );
    fs.writeFileSync(path.join(value.targetDir, 'package.json'), '{}');
    expect(() => assertCloudflareProject(value.targetDir)).toThrow(
      'declare cf as a dependency'
    );
    fs.writeFileSync(
      path.join(value.targetDir, 'package.json'),
      JSON.stringify({ devDependencies: { cf: '1.0.0-beta.30' } })
    );
    expect(() => assertCloudflareProject(value.targetDir)).not.toThrow();
  });

  it('extracts clean workers.dev URLs from text and JSON output', () => {
    const url = 'https://demo.example.workers.dev';
    expect(parseDeploymentUrl(`Deployed ${url}\n`)).toBe(url);
    expect(parseDeploymentUrl(JSON.stringify({ url }))).toBe(url);
    expect(
      parseDeploymentUrl('https://dash.cloudflare.com/example')
    ).toBeUndefined();
  });

  it('uses cf authentication, named create flags, and JSON resource IDs', () => {
    const value = config();
    const inherited = vi
      .spyOn(commands, 'runInherited')
      .mockImplementation(() => {});
    const run = vi
      .spyOn(commands, 'runCommand')
      .mockReturnValueOnce({
        stdout: JSON.stringify({
          uuid: '12345678-1234-1234-1234-123456789abc',
        }),
        stderr: 'status goes to stderr',
      })
      .mockReturnValueOnce({
        stdout: JSON.stringify({ id: '0123456789abcdef0123456789abcdef' }),
        stderr: '',
      });
    cloudflareAuth(value);
    expect(createD1(value).d1DatabaseId).toBe(
      '12345678-1234-1234-1234-123456789abc'
    );
    expect(createKV(value).kvNamespaceId).toBe(
      '0123456789abcdef0123456789abcdef'
    );
    createR2(value);
    expect(run.mock.calls.map((call) => call[1])).toEqual([
      ['exec', 'cf', 'd1', 'create', '--name', value.d1DatabaseName],
      [
        'exec',
        'cf',
        'kv',
        'namespaces',
        'create',
        '--title',
        value.kvNamespaceName,
      ],
    ]);
    expect(inherited.mock.calls.map((call) => call[1])).toEqual([
      ['exec', 'cf', 'auth', 'whoami'],
      ['exec', 'cf', 'r2', 'buckets', 'create', '--name', value.r2BucketName],
    ]);
  });

  it('deletes by resource ID with explicit confirmation flags', async () => {
    const value = {
      ...config(),
      d1DatabaseId: 'db-id',
      kvNamespaceId: 'kv-id',
    };
    const run = vi
      .spyOn(commands, 'runCommandAndEcho')
      .mockReturnValue({ stdout: '{}', stderr: '' });
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(Response.json({ success: true, result: [] }))
    );
    deleteD1(value);
    deleteKV(value);
    deleteWorker(value);
    await deleteR2(value);
    expect(run.mock.calls.map((call) => call[1])).toEqual([
      ['exec', 'cf', 'd1', 'delete', 'db-id', '--force'],
      ['exec', 'cf', 'kv', 'namespaces', 'delete', 'kv-id', '--force'],
      ['exec', 'cf', 'workers', 'delete', value.projectName, '--force'],
      ['exec', 'cf', 'r2', 'buckets', 'delete', value.r2BucketName, '--force'],
    ]);
  });
});

describe('Windows package command shims', () => {
  it.skipIf(process.platform !== 'win32')(
    'passes email and JSON arguments literally through a .cmd shim',
    () => {
      const value = config();
      const bin = path.join(value.targetDir, 'node_modules', '.bin');
      fs.mkdirSync(bin, { recursive: true });
      const script = path.join(value.targetDir, 'capture.cjs');
      fs.writeFileSync(
        script,
        'console.log(JSON.stringify(process.argv.slice(2)));'
      );
      const shim = path.join(bin, 'capture.cmd');
      fs.writeFileSync(
        shim,
        `@echo off\r\n"${process.execPath}" "${script}" %*\r\n`
      );
      const args = [
        'you&x@example.com',
        '%PATH%',
        'a|b',
        'a^b',
        '"quoted"',
        JSON.stringify([{ value: ['you&x@example.com'] }]),
      ];
      vi.spyOn(console, 'log').mockImplementation(() => {});
      expect(JSON.parse(commands.runCommand(shim, args, value).stdout)).toEqual(
        args
      );
    }
  );
});

describe('template Node.js requirements', () => {
  it.each(['22.23.0', '24.22.0', '26.12.0', '26.13.0', '27.0.0'])(
    'accepts %s',
    (version) => {
      expect(() => assertNodeVersion(version)).not.toThrow();
    }
  );
  it.each(['20.20.0', '22.22.0', '23.0.0', '24.21.0', '25.0.0', '26.11.0'])(
    'rejects %s before setup',
    (version) => {
      expect(() => assertNodeVersion(version)).toThrow('unsupported');
    }
  );
});
