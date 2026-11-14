import crypto from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseArgs } from '../src/args.js';
import { createConfig } from '../src/config.js';
import { cleanupWaffoResources, hasWaffoResources } from '../src/waffo.js';
import { deleteProject } from '../src/delete.js';
import * as cloudflare from '../src/cloudflare.js';
import * as git from '../src/git.js';
import * as commands from '../src/commands.js';

const { privateKey } = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
});
const tty = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY');
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  if (tty) Object.defineProperty(process.stdin, 'isTTY', tty);
  else Reflect.deleteProperty(process.stdin, 'isTTY');
});
function setup() {
  vi.stubEnv('CLOUDFLARE_ACCOUNT_ID', 'account');
  vi.stubEnv('CLOUDFLARE_API_TOKEN', 'token');
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  const config = {
    ...createConfig(parseArgs(['create', 'demo', '--payment', 'none'])),
    waffoMerchantId: 'MER_test', waffoPrivateKey: privateKey,
    waffoStoreId: 'STO_created', waffoWebhookId: 'webhook-created',
    waffoProductIds: { proMonthly: 'PROD_monthly', proYearly: 'PROD_yearly', lifetime: 'PROD_lifetime' },
  };
  const fetchMock = vi.fn().mockImplementation(async () => Response.json({ data: {} }));
  vi.stubGlobal('fetch', fetchMock);
  return { config, fetchMock };
}

describe('deletion completeness', () => {
  it.each([
    ['owner', 'repo, delete_repo', true],
    ['owner', 'delete_repo', false],
    ['someone-else', 'repo, delete_repo', false],
  ])('handles a repository 404 for user %s with scopes %s', (login, scopes, absent) => {
    const { config } = setup();
    config.githubRepo = 'owner/demo';
    vi.spyOn(commands, 'runCommandAndEcho').mockImplementation(() => {
      throw new Error('HTTP 404: Not Found');
    });
    vi.spyOn(commands, 'runCommand').mockReturnValue({
      stdout: `HTTP/2.0 200 OK\nx-oauth-scopes: ${scopes}\n\n${JSON.stringify({ login })}`,
      stderr: '',
    });
    const remove = () => git.deleteGithubRepo(parseArgs(['delete', 'demo']), config);
    if (absent) expect(remove).not.toThrow();
    else expect(remove).toThrow('HTTP 404');
  });

  it('treats the explicit Cloudflare D1 absence code as an already deleted database', async () => {
    const { config } = setup();
    config.d1DatabaseId = 'missing-database';
    config.kvNamespaceId = 'kv';
    config.waffoStoreId = '';
    config.waffoWebhookId = '';
    config.waffoProductIds = { proMonthly: '', proYearly: '', lifetime: '' };
    Object.defineProperty(process.stdin, 'isTTY', { configurable: true, value: false });
    vi.spyOn(cloudflare, 'deleteWorker').mockImplementation(() => {});
    vi.spyOn(cloudflare, 'deleteKV').mockImplementation(() => {});
    vi.spyOn(cloudflare, 'deleteR2').mockImplementation(async () => {});
    vi.spyOn(cloudflare, 'deleteD1').mockImplementation(() => {
      throw new Error('[7404] The database missing-database could not be found');
    });
    vi.spyOn(git, 'deleteGithubRepo').mockImplementation(() => {});
    await expect(deleteProject(parseArgs(['delete', 'demo']), config)).resolves.toBeUndefined();
    expect(console.log).toHaveBeenCalledWith('✅ D1 database was already deleted.');
  });
  it('removes the matching custom-domain binding by ID', async () => {
    const { config, fetchMock } = setup();
    config.domain = 'app.example.com';
    fetchMock.mockImplementationOnce(async () => Response.json({ success: true,
      result: [{ id: 'binding-id', hostname: config.domain, service: config.projectName }] }))
      .mockImplementationOnce(async () => Response.json({ success: true }));
    await cloudflare.deleteWorkerCustomDomain(config);
    expect(fetchMock.mock.calls[1]?.[0]).toContain('/workers/domains/binding-id');
    expect(fetchMock.mock.calls[1]?.[1].method).toBe('DELETE');
  });
  it('preserves a custom domain reassigned to another Worker', async () => {
    const { config, fetchMock } = setup();
    config.domain = 'app.example.com';
    fetchMock.mockImplementation(async () => Response.json({ success: true,
      result: [{ id: 'binding-id', hostname: config.domain, service: 'other-worker' }] }));
    await expect(cloudflare.deleteWorkerCustomDomain(config)).rejects.toThrow('now belongs');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it('accepts an already absent custom-domain binding', async () => {
    const { config, fetchMock } = setup();
    config.domain = 'app.example.com';
    fetchMock.mockImplementation(async () => Response.json({ success: true, result: [] }));
    await expect(cloudflare.deleteWorkerCustomDomain(config)).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it('does not report an aborted Cloudflare deletion as success', () => {
    const { config } = setup();
    config.d1DatabaseId = 'database-id';
    vi.spyOn(commands, 'runCommandAndEcho').mockReturnValue({ stdout: '', stderr: 'Aborted.' });
    expect(() => cloudflare.deleteD1(config)).toThrow('not confirmed deleted');
  });
  it('reports missing IDs as skipped and generic Not Found as a failure', async () => {
    const { config } = setup();
    config.waffoStoreId = '';
    config.waffoWebhookId = '';
    config.waffoProductIds = { proMonthly: '', proYearly: '', lifetime: '' };
    config.d1DatabaseId = '';
    config.kvNamespaceId = '';
    Object.defineProperty(process.stdin, 'isTTY', { configurable: true, value: false });
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(cloudflare, 'deleteWorker').mockImplementation(() => {});
    vi.spyOn(cloudflare, 'deleteR2').mockImplementation(async () => {});
    const d1 = vi.spyOn(cloudflare, 'deleteD1');
    const kv = vi.spyOn(cloudflare, 'deleteKV');
    vi.spyOn(git, 'deleteGithubRepo').mockImplementation(() => { throw new Error('Not Found: check authorization'); });
    await expect(deleteProject(parseArgs(['delete', 'demo']), config)).rejects.toThrow('GitHub repo');
    expect(d1).not.toHaveBeenCalled();
    expect(kv).not.toHaveBeenCalled();
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('No database ID was saved'));
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('No namespace ID was saved'));
  });
});

describe('Waffo initialization cleanup', () => {
  it('removes only recorded webhook, deactivates recorded products, then deletes store', async () => {
    const { config, fetchMock } = setup();
    await cleanupWaffoResources(config);
    expect(fetchMock.mock.calls.map(([url]) => new URL(url).pathname)).toEqual([
      '/v1/actions/store/remove-webhook',
      '/v1/actions/subscription-product/update-status',
      '/v1/actions/subscription-product/update-status',
      '/v1/actions/onetime-product/update-status',
      '/v1/actions/store/delete-store',
    ]);
    expect(fetchMock.mock.calls.map(([, request]) => JSON.parse(request.body))).toEqual([
      { id: 'webhook-created' },
      { id: 'PROD_monthly', status: 'inactive' },
      { id: 'PROD_yearly', status: 'inactive' },
      { id: 'PROD_lifetime', status: 'inactive' },
      { id: 'STO_created' },
    ]);
    expect(fetchMock.mock.calls.every(([, request]) => request.headers['X-Signature'])).toBe(true);
  });
  it('skips store deletion after product failure, but attempts other recorded products', async () => {
    const { config, fetchMock } = setup();
    fetchMock.mockImplementationOnce(async () => Response.json({ data: {} }))
      .mockImplementationOnce(async () => Response.json({ errors: ['Not authorized'] }, { status: 403 }));
    await expect(cleanupWaffoResources(config)).rejects.toThrow('Store deletion was skipped');
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });
  it('treats 404 as already absent so interrupted cleanup can be retried', async () => {
    const { config, fetchMock } = setup();
    fetchMock.mockImplementation(async () => Response.json({ errors: ['Resource not found'] }, { status: 404 }));
    await expect(cleanupWaffoResources(config)).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(5);
  });
  it('reports a blocked store deletion without retrying or touching subscriptions', async () => {
    const { config, fetchMock } = setup();
    config.waffoWebhookId = '';
    config.waffoProductIds = { proMonthly: '', proYearly: '', lifetime: '' };
    fetchMock.mockImplementation(async () => Response.json({ errors: ['Active subscriptions block deletion'] }, { status: 409 }));
    await expect(cleanupWaffoResources(config)).rejects.toThrow('Resolve the reported dependencies');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('Active subscriptions'));
  });
  it('requires credentials before sending cleanup requests', async () => {
    const { config, fetchMock } = setup();
    config.waffoPrivateKey = '';
    await expect(cleanupWaffoResources(config)).rejects.toThrow('WAFFO_PRIVATE_KEY');
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('handles a partially initialized project without inventing resource IDs', async () => {
    const { config, fetchMock } = setup();
    config.waffoStoreId = '';
    config.waffoWebhookId = '';
    config.waffoProductIds = { proMonthly: 'PROD_monthly', proYearly: '', lifetime: '' };
    expect(hasWaffoResources(config)).toBe(true);
    await cleanupWaffoResources(config);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    config.waffoProductIds.proMonthly = '';
    expect(hasWaffoResources(config)).toBe(false);
  });
  it('integrates Waffo cleanup into delete and continues other resources if cleanup fails', async () => {
    const { config, fetchMock } = setup();
    Object.defineProperty(process.stdin, 'isTTY', { configurable: true, value: false });
    for (const name of ['deleteWorker', 'deleteKV', 'deleteR2', 'deleteD1'] as const) {
      vi.spyOn(cloudflare, name).mockImplementation(() => {});
    }
    const repo = vi.spyOn(git, 'deleteGithubRepo').mockImplementation(() => {});
    fetchMock.mockImplementation(async () => Response.json({ errors: ['Not authorized'] }, { status: 403 }));
    await expect(deleteProject(parseArgs(['delete', 'demo']), config)).rejects.toThrow('Waffo initialization resources');
    expect(cloudflare.deleteWorker).toHaveBeenCalledOnce();
    expect(repo).toHaveBeenCalledOnce();
  });
});
