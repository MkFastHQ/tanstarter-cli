import {
  runCommand,
  runCommandAndEcho,
  runInherited,
  runInheritedNonInteractive,
} from './commands.js';
import type { RuntimeConfig } from './types.js';

export function cloudflareAuth(config: RuntimeConfig): void {
  runInherited('pnpm', ['exec', 'cf', 'auth', 'whoami'], config);
}

export function createD1(config: RuntimeConfig): RuntimeConfig {
  if (config.d1DatabaseId) return config;

  const result = runCommand(
    'pnpm',
    ['exec', 'cf', 'd1', 'create', '--name', config.d1DatabaseName],
    config
  );
  const outputText = `${result.stdout}\n${result.stderr}`;
  const databaseId = parseD1DatabaseId(result.stdout);

  if (!databaseId) {
    throw new Error(
      `Could not parse D1 database_id from Cloudflare CLI output:\n${outputText}`
    );
  }

  return { ...config, d1DatabaseId: databaseId };
}

export function createR2(config: RuntimeConfig): void {
  runInherited(
    'pnpm',
    ['exec', 'cf', 'r2', 'buckets', 'create', '--name', config.r2BucketName],
    config
  );
}

export function createKV(config: RuntimeConfig): RuntimeConfig {
  if (config.kvNamespaceId) return config;

  const result = runCommand(
    'pnpm',
    [
      'exec',
      'cf',
      'kv',
      'namespaces',
      'create',
      '--title',
      config.kvNamespaceName,
    ],
    config
  );
  const outputText = `${result.stdout}\n${result.stderr}`;
  const namespaceId = parseKVNamespaceId(result.stdout);

  if (!namespaceId) {
    throw new Error(
      `Could not parse KV namespace id from Cloudflare CLI output:\n${outputText}`
    );
  }

  return { ...config, kvNamespaceId: namespaceId };
}

export function applyD1Migrations(config: RuntimeConfig, local: boolean): void {
  if (!config.d1DatabaseId)
    throw new Error('D1 migrations require a database ID.');
  runInheritedNonInteractive(
    'pnpm',
    [
      'exec',
      'cf',
      'd1',
      'migrations',
      'apply',
      config.d1DatabaseId,
      '--dir',
      'src/db/migrations',
      ...(local ? ['--local', '--persist-to', '.cloudflare/state'] : []),
    ],
    config
  );
}

export function deleteD1(config: RuntimeConfig): void {
  if (!config.d1DatabaseId) {
    console.log('D1 database id is missing; skipping D1 deletion.');
    return;
  }
  runCommandAndEcho(
    'pnpm',
    ['exec', 'cf', 'd1', 'delete', config.d1DatabaseId, '--force'],
    config
  );
}

export function deleteWorker(config: RuntimeConfig): void {
  runCommandAndEcho(
    'pnpm',
    ['exec', 'cf', 'workers', 'delete', config.projectName, '--force'],
    config
  );
}

/**
 * Confirm that a custom hostname belongs to this Worker.
 *
 * Cloudflare CLI normally provisions the binding from `worker.domains`.
 * Keeping this API call in the resumable workflow makes the desired binding
 * explicit and lets a resume repair a binding that was not created during an
 * earlier deploy.
 */
export async function ensureWorkerCustomDomain(
  config: RuntimeConfig
): Promise<void> {
  if (!config.domain) return;

  const zone = await findCloudflareZone(config, config.domain);
  if (!zone) {
    throw new Error(
      [
        `Cloudflare zone for ${config.domain} was not found in account ${config.cloudflareAccountId}.`,
        'Make sure the domain is active in this Cloudflare account, then rerun with --resume.',
      ].join('\n')
    );
  }

  const existing = await getWorkerCustomDomain(config, config.domain);
  if (existing && existing.service !== config.projectName) {
    throw new Error(
      [
        `Cloudflare custom domain ${config.domain} is already attached to Worker ${existing.service}.`,
        `It cannot be attached to ${config.projectName} automatically. Choose another domain or remove the existing binding first.`,
      ].join('\n')
    );
  }

  const result = await cloudflareRequest<CloudflareWorkerCustomDomain>(
    config,
    'PUT',
    `/accounts/${encodeURIComponent(config.cloudflareAccountId)}/workers/domains`,
    {
      hostname: config.domain,
      service: config.projectName,
      zone_id: zone.id,
      zone_name: zone.name,
    }
  );

  if (!result.result?.enabled) {
    throw new Error(
      [
        `Cloudflare accepted ${config.domain}, but the custom-domain binding is not enabled yet.`,
        'Wait for Cloudflare to finish provisioning DNS and the certificate, then rerun with --resume.',
      ].join('\n')
    );
  }

  console.log(
    `Cloudflare custom domain ${config.domain} is attached to Worker ${config.projectName}.`
  );
}

async function getWorkerCustomDomain(
  config: RuntimeConfig,
  hostname: string
): Promise<CloudflareWorkerCustomDomain | undefined> {
  const params = new URLSearchParams({ hostname });
  const response = await cloudflareRequest<CloudflareWorkerCustomDomain[]>(
    config,
    'GET',
    `/accounts/${encodeURIComponent(config.cloudflareAccountId)}/workers/domains?${params.toString()}`
  );
  return response.result.find((domain) => domain.hostname === hostname);
}

async function findCloudflareZone(
  config: RuntimeConfig,
  hostname: string
): Promise<CloudflareZone | undefined> {
  const params = new URLSearchParams({
    'account.id': config.cloudflareAccountId,
  });
  const zones = await listCloudflarePages<CloudflareZone>(
    config,
    `/zones?${params}`
  );

  return zones
    .filter(
      (zone) => hostname === zone.name || hostname.endsWith(`.${zone.name}`)
    )
    .sort((left, right) => right.name.length - left.name.length)[0];
}

export async function deleteR2(config: RuntimeConfig): Promise<void> {
  await emptyR2Bucket(config);
  runCommandAndEcho(
    'pnpm',
    ['exec', 'cf', 'r2', 'buckets', 'delete', config.r2BucketName, '--force'],
    config
  );
}

export function deleteKV(config: RuntimeConfig): void {
  if (!config.kvNamespaceId) {
    console.log('KV namespace id is missing; skipping KV deletion.');
    return;
  }

  runCommandAndEcho(
    'pnpm',
    [
      'exec',
      'cf',
      'kv',
      'namespaces',
      'delete',
      config.kvNamespaceId,
      '--force',
    ],
    config
  );
}

export function parseD1DatabaseId(output: string): string | undefined {
  const uuid = parseResourceId(output, 'uuid');
  return uuid && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(uuid)
    ? uuid
    : undefined;
}

export function parseKVNamespaceId(output: string): string | undefined {
  const id = parseResourceId(output, 'id');
  return id && /^[0-9a-f]{32}$/i.test(id) ? id : undefined;
}

function parseResourceId(output: string, key: string): string | undefined {
  try {
    const result = JSON.parse(output) as Record<string, unknown>;
    return typeof result[key] === 'string' ? result[key] : undefined;
  } catch {
    return undefined;
  }
}

async function emptyR2Bucket(config: RuntimeConfig): Promise<void> {
  let deletedCount = 0;

  console.log(`Emptying R2 bucket before deletion: ${config.r2BucketName}`);

  while (true) {
    const page = await listR2Objects(config);
    const objects = page.result.map((object) => object.key);
    if (objects.length === 0) break;

    for (const key of objects) {
      await deleteR2Object(config, key);
      deletedCount += 1;
    }
  }

  if (deletedCount > 0) {
    console.log(`Deleted ${deletedCount} R2 object(s) before deleting bucket.`);
  } else {
    console.log('R2 bucket is already empty.');
  }
}

async function listR2Objects(
  config: RuntimeConfig
): Promise<R2ObjectListResponse> {
  const params = new URLSearchParams({ per_page: '1000' });

  const body = await cloudflareRequest<Array<{ key: string }>>(
    config,
    'GET',
    `${buildR2ObjectsPath(config)}?${params.toString()}`
  );

  const page: R2ObjectListResponse = {
    result: body.result,
  };
  return page;
}

async function deleteR2Object(
  config: RuntimeConfig,
  key: string
): Promise<void> {
  await cloudflareRequest(config, 'DELETE', buildR2ObjectPath(config, key));
}

export function buildR2ObjectsPath(config: RuntimeConfig): string {
  return `/accounts/${config.cloudflareAccountId}/r2/buckets/${encodeURIComponent(
    config.r2BucketName
  )}/objects`;
}

export function buildR2ObjectPath(config: RuntimeConfig, key: string): string {
  return `${buildR2ObjectsPath(config)}/${encodeURIComponent(key)}`;
}

async function cloudflareRequest<T = unknown>(
  config: RuntimeConfig,
  method: string,
  path: string,
  body?: unknown
): Promise<CloudflareApiResponse<T>> {
  const request: RequestInit = {
    method,
    headers: {
      Authorization: `Bearer ${config.cloudflareApiToken}`,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
  };
  if (body !== undefined) request.body = JSON.stringify(body);

  const response = await fetch(
    `https://api.cloudflare.com/client/v4${path}`,
    request
  );
  const responseBody = (await response.json().catch(() => undefined)) as
    | CloudflareApiResponse<T>
    | undefined;

  if (!response.ok || responseBody?.success === false) {
    const errors = responseBody?.errors
      ?.map((error) => error.message)
      .join('; ');
    throw new Error(
      `Cloudflare API ${method} ${path} failed: ${
        errors || response.statusText || response.status
      }`
    );
  }

  return responseBody as CloudflareApiResponse<T>;
}

interface R2ObjectListResponse {
  result: Array<{ key: string }>;
}

async function listCloudflarePages<T>(
  config: RuntimeConfig,
  resourcePath: string
): Promise<T[]> {
  const results: T[] = [];
  const perPage = 50;
  for (let page = 1; ; page++) {
    const url = new URL(resourcePath, 'https://api.cloudflare.com');
    url.searchParams.set('page', String(page));
    url.searchParams.set('per_page', String(perPage));
    const response = await cloudflareRequest<T[]>(
      config,
      'GET',
      `${url.pathname}${url.search}`
    );
    results.push(...response.result);
    const totalPages = response.result_info?.total_pages;
    if (
      response.result.length === 0 ||
      (totalPages !== undefined
        ? page >= totalPages
        : response.result.length < perPage)
    ) {
      return results;
    }
  }
}

interface CloudflareApiResponse<T> {
  success: boolean;
  result: T;
  result_info?: { total_pages?: number };
  errors?: Array<{ message: string }>;
}

interface CloudflareZone {
  id: string;
  name: string;
}

interface CloudflareWorkerCustomDomain {
  hostname: string;
  service: string;
  enabled: boolean;
}
