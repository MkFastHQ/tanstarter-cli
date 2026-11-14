import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseEnv } from 'node:util';

import type { CommandResult, RuntimeConfig } from './types.js';
import { runCommandAndEcho } from './commands.js';

/** Supply required secrets atomically, including when the Worker does not exist. */
export function deployWithSecrets(config: RuntimeConfig): CommandResult {
  const values = parseEnv(
    fs.readFileSync(path.join(config.targetDir, '.env.production'), 'utf8')
  );
  for (const key of ['VITE_BASE_URL', 'BETTER_AUTH_SECRET']) {
    if (!values[key]?.trim()) {
      throw new Error(`Missing required production environment variable: ${key}`);
    }
  }
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'tanstarter-deploy-'));
  try {
    // JSON preserves literal dollars and multiline values, without dotenv expansion
    // or ambient environment overrides. Match the template's secret sync values.
    const file = path.join(directory, 'secrets.json');
    fs.writeFileSync(file, JSON.stringify(values), { mode: 0o600 });
    return runCommandAndEcho(
      'pnpm',
      ['run', 'deploy', '--secrets-file', file],
      config
    );
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

const DEPLOYMENT_REQUEST_TIMEOUT_MS = 15_000;
const DEPLOYMENT_RETRY_DELAYS_MS = [
  2_000, 5_000, 10_000, 15_000, 30_000, 60_000, 60_000, 60_000, 60_000,
] as const;

export interface DeploymentVerificationOptions {
  requestTimeoutMs?: number;
  retryDelaysMs?: readonly number[];
  sleep?: (milliseconds: number) => Promise<void>;
}

export function parseDeploymentUrl(output: string): string | undefined {
  // Accept both terminal output and JSON without including JSON punctuation.
  return output.match(
    /https:\/\/[a-z0-9-]+(?:\.[a-z0-9-]+)*\.workers\.dev\b/i
  )?.[0];
}

export function getPublicBaseUrl(config: RuntimeConfig): string | undefined {
  if (config.domain) return `https://${config.domain}`;
  return config.deploymentUrl?.replace(/\/+$/, '');
}

/** Verify that the final public URL is serving the deployed application. */
export async function verifyPublicDeployment(
  config: RuntimeConfig,
  options: DeploymentVerificationOptions = {}
): Promise<void> {
  const url = getPublicBaseUrl(config);
  if (!url) {
    throw new Error(
      [
        'The deployment completed but no public URL was detected.',
        'Pass --domain <domain>, or verify that workers.dev is enabled and rerun with --resume.',
      ].join('\n')
    );
  }

  const requestTimeoutMs =
    options.requestTimeoutMs ?? DEPLOYMENT_REQUEST_TIMEOUT_MS;
  const retryDelaysMs = options.retryDelaysMs ?? DEPLOYMENT_RETRY_DELAYS_MS;
  const sleep = options.sleep ?? wait;
  let lastFailure = '';
  const maxAttempts = retryDelaysMs.length + 1;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);
    try {
      const response = await fetch(url, {
        method: 'GET',
        redirect: 'follow',
        signal: controller.signal,
      });
      if (response.ok) return;
      lastFailure = `HTTP ${response.status}`;
    } catch (error) {
      lastFailure = error instanceof Error ? error.message : String(error);
    } finally {
      clearTimeout(timeout);
    }

    const retryDelay = retryDelaysMs[attempt - 1];
    if (retryDelay !== undefined) {
      console.warn(
        `Public deployment URL check failed (${lastFailure}); retrying in ${retryDelay / 1000}s (${attempt + 1}/${maxAttempts}).`
      );
      await sleep(retryDelay);
    }
  }

  const guidance = config.domain
    ? [
        `Cloudflare custom domains provision DNS, certificates, and routing asynchronously for ${config.domain}.`,
        'If the hostname is still unresolved, check Workers & Pages → your Worker → Settings → Domains & Routes and the zone DNS records, then rerun with --resume.',
      ]
    : ['Check the workers.dev deployment status, then rerun with --resume.'];

  throw new Error(
    [
      `The deployed site is not reachable at ${url} (${lastFailure}).`,
      ...guidance,
    ].join('\n')
  );
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
