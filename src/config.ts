import crypto from 'node:crypto';
import process from 'node:process';

import type { CliOptions, RuntimeConfig } from './types.js';
import { requireEnv } from './utils.js';
import {
  normalizeDomain,
  validateDomain,
  validateGithubRepo,
} from './validators.js';
import { waffoStoreNameForProject } from './waffo.js';

export function createConfig(options: CliOptions): RuntimeConfig {
  const cloudflareAccountId = requireEnv('CLOUDFLARE_ACCOUNT_ID');
  const cloudflareApiToken = requireEnv('CLOUDFLARE_API_TOKEN');
  const paymentProvider = options.payment ?? 'none';
  const waffoMerchantId = process.env.WAFFO_MERCHANT_ID?.trim() ?? '';
  const waffoPrivateKey = process.env.WAFFO_PRIVATE_KEY ?? '';

  if (paymentProvider === 'waffo') {
    requireEnv('WAFFO_MERCHANT_ID');
    requireEnv('WAFFO_PRIVATE_KEY');
  }

  if (options.domain) {
    validateDomain(options.domain);
  }
  if (options.githubRepo) {
    validateGithubRepo(options.githubRepo);
  }

  return {
    projectName: options.projectName,
    targetDir: options.targetDir,
    domain: normalizeDomain(options.domain),
    githubRepo: options.githubRepo || options.projectName,
    cloudflareAccountId,
    cloudflareApiToken,
    paymentProvider,
    waffoSetupId: crypto.randomUUID(),
    waffoMerchantId,
    waffoPrivateKey,
    waffoStoreName: waffoStoreNameForProject(options.projectName),
    waffoStoreId: '',
    waffoProductIds: {
      proMonthly: '',
      proYearly: '',
      lifetime: '',
    },
    waffoWebhookId: '',
    d1DatabaseName: options.projectName,
    d1DatabaseId: '',
    r2BucketName: options.projectName,
    kvNamespaceName: options.projectName,
    kvNamespaceId: '',
  };
}
