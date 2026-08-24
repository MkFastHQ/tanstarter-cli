import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import type { RuntimeConfig } from './types.js';
import { normalizePemForEnv } from './waffo.js';

const WAFFO_ENV_KEYS = [
  'WAFFO_DEBUG',
  'WAFFO_MERCHANT_ID',
  'WAFFO_PRIVATE_KEY',
  'VITE_WAFFO_PRODUCT_PRO_MONTHLY',
  'VITE_WAFFO_PRODUCT_PRO_YEARLY',
  'VITE_WAFFO_PRODUCT_LIFETIME',
] as const;

// Store IDs are CLI provisioning state, not part of the generated app's
// runtime environment. Remove the value written by CLI versions <= 1.3.4.
const OBSOLETE_CLI_ENV_KEYS = ['WAFFO_STORE_ID'] as const;

export function ensureEnvFiles(config: RuntimeConfig): void {
  const processEnvValues = getProcessEnvValuesFromExample(config.targetDir);
  delete processEnvValues.VITE_PAYMENT_PROVIDER;
  for (const key of WAFFO_ENV_KEYS) {
    delete processEnvValues[key];
  }
  const sharedValues: Record<string, string> = {
    CLOUDFLARE_ACCOUNT_ID: config.cloudflareAccountId,
    CLOUDFLARE_API_TOKEN: config.cloudflareApiToken,
    CLOUDFLARE_DATABASE_ID: config.d1DatabaseId,
    VITE_PAYMENT_PROVIDER:
      config.paymentProvider === 'waffo' ? 'waffo' : '',
  };
  if (config.paymentProvider === 'waffo') {
    Object.assign(sharedValues, waffoEnvValues(config));
  } else {
    for (const key of WAFFO_ENV_KEYS) {
      sharedValues[key] = '';
    }
  }

  for (const envFile of ['.env', '.env.production']) {
    const envPath = path.join(config.targetDir, envFile);
    ensureEnvFile(envPath, config.targetDir);
    removeEnvKeys(envPath, OBSOLETE_CLI_ENV_KEYS);
    const existing = parseEnvFile(envPath);
    const baseUrl =
      envFile === '.env'
        ? 'http://localhost:3000'
        : getProductionBaseUrl(config);
    const betterAuthSecret =
      existing.BETTER_AUTH_SECRET ||
      process.env.BETTER_AUTH_SECRET ||
      crypto.randomBytes(32).toString('base64url');

    updateEnvFile(envPath, {
      ...processEnvValues,
      ...sharedValues,
      VITE_BASE_URL: baseUrl,
      BETTER_AUTH_SECRET: betterAuthSecret,
    });
  }
}

function waffoEnvValues(config: RuntimeConfig): Record<string, string> {
  const productIds = config.waffoProductIds;
  return {
    VITE_PAYMENT_PROVIDER: 'waffo',
    // The deployed Worker intentionally stays in Waffo test mode. WAFFO_DEBUG
    // makes it verify and accept test webhooks.
    WAFFO_DEBUG: 'true',
    WAFFO_MERCHANT_ID: config.waffoMerchantId,
    WAFFO_PRIVATE_KEY: normalizePemForEnv(config.waffoPrivateKey),
    VITE_WAFFO_PRODUCT_PRO_MONTHLY: productIds.proMonthly,
    VITE_WAFFO_PRODUCT_PRO_YEARLY: productIds.proYearly,
    VITE_WAFFO_PRODUCT_LIFETIME: productIds.lifetime,
  };
}

function getProductionBaseUrl(config: RuntimeConfig): string {
  if (config.domain) return `https://${config.domain}`;
  return config.deploymentUrl || 'http://localhost:3000';
}

function ensureEnvFile(filePath: string, targetDir: string): void {
  if (fs.existsSync(filePath)) return;

  const examplePath = path.join(targetDir, '.env.example');
  const content = fs.existsSync(examplePath)
    ? fs.readFileSync(examplePath, 'utf8')
    : '';
  fs.writeFileSync(filePath, content, 'utf8');
}

function parseEnvFile(filePath: string): Record<string, string> {
  if (!fs.existsSync(filePath)) return {};

  const env: Record<string, string> = {};
  const content = fs.readFileSync(filePath, 'utf8');

  for (const line of content.split(/\r?\n/)) {
    const match = line.trim().match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (!match) continue;

    const key = match[1];
    const rawValue = match[2];
    if (!key || rawValue === undefined) continue;
    env[key] = rawValue.replace(/^['"]|['"]$/g, '');
  }

  return env;
}

function getProcessEnvValuesFromExample(
  targetDir: string
): Record<string, string> {
  const examplePath = path.join(targetDir, '.env.example');
  if (!fs.existsSync(examplePath)) return {};

  const values: Record<string, string> = {};
  const example = parseEnvFile(examplePath);

  for (const key of Object.keys(example)) {
    const value = process.env[key];
    if (value !== undefined && value !== '') {
      values[key] = value;
    }
  }

  return values;
}

function updateEnvFile(filePath: string, values: Record<string, string>): void {
  const seen = new Set<string>();
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split(/\r?\n/).map((line) => {
    const match = line.match(/^([A-Z_][A-Z0-9_]*)=/);
    if (!match) return line;

    const key = match[1];
    if (!key || !(key in values)) return line;

    seen.add(key);
    return `${key}=${formatEnvValue(values[key] ?? '')}`;
  });

  for (const [key, value] of Object.entries(values)) {
    if (!seen.has(key)) {
      lines.push(`${key}=${formatEnvValue(value)}`);
    }
  }

  fs.writeFileSync(
    filePath,
    `${lines.join('\n').replace(/\n+$/, '')}\n`,
    'utf8'
  );
}

function removeEnvKeys(filePath: string, keys: readonly string[]): void {
  const keysToRemove = new Set(keys);
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content
    .split(/\r?\n/)
    .filter((line) => {
      const match = line.match(/^([A-Z_][A-Z0-9_]*)=/);
      return !match?.[1] || !keysToRemove.has(match[1]);
    });

  fs.writeFileSync(
    filePath,
    `${lines.join('\n').replace(/\n+$/, '')}\n`,
    'utf8'
  );
}

export function formatEnvValue(value: string): string {
  return `'${value.replace(/'/g, "\\'")}'`;
}
