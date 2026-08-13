import { spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline/promises';
import path from 'node:path';
import process from 'node:process';

import { WAFFO_DOCS_URL } from './constants.js';
import type {
  CliOptions,
  PaymentProvider,
  RuntimeConfig,
} from './types.js';
import {
  normalizeDomain,
  normalizeSlug,
  validateDomain,
  validateGithubRepo,
  validateSlug,
} from './validators.js';
import {
  WAFFO_TEMPLATE_PRODUCTS,
  waffoStoreNameForProject,
} from './waffo.js';

export async function configureSetup(
  options: CliOptions,
  config: RuntimeConfig
): Promise<RuntimeConfig> {
  if (!process.stdin.isTTY && !config.projectName) {
    throw new Error('Project name is required in non-interactive terminals.');
  }
  if (!process.stdin.isTTY || options.resume) return config;

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const nextConfig = await promptForMissingOptions(rl, options, config);
    if (!options.acceptDefaults) {
      await confirmSetup(rl, nextConfig);
    }
    return nextConfig;
  } finally {
    rl.close();
  }
}

async function promptForMissingOptions(
  rl: ReturnType<typeof createInterface>,
  options: CliOptions,
  config: RuntimeConfig
): Promise<RuntimeConfig> {
  let nextConfig = config;
  let domain = config.domain;
  let githubRepo = config.githubRepo;

  if (!nextConfig.projectName) {
    nextConfig = applyProjectName(config, await askProjectName(rl));
  }
  if (!options.githubRepo) {
    githubRepo = getDefaultGithubRepo(nextConfig.projectName, nextConfig.githubRepo);
  }

  let paymentProvider: PaymentProvider = nextConfig.paymentProvider;
  if (!options.payment) {
    paymentProvider = await askPaymentProvider(rl);
  }

  if (options.acceptDefaults) {
    if (paymentProvider === 'waffo') {
      requireWaffoCredentials();
      return {
        ...nextConfig,
        paymentProvider,
        githubRepo,
        waffoStoreName: waffoStoreNameForProject(nextConfig.projectName),
      };
    }
    return { ...nextConfig, paymentProvider, githubRepo };
  }

  if (paymentProvider === 'waffo') {
    requireWaffoCredentials();
    nextConfig = {
      ...nextConfig,
      paymentProvider,
      waffoStoreName: waffoStoreNameForProject(nextConfig.projectName),
    };
    if (!options.domain) {
      domain = await askDomain(rl, true);
    }
  } else {
    nextConfig = { ...nextConfig, paymentProvider };
    if (!options.domain) {
      domain = await askDomain(rl, false);
    }
  }

  const d1DatabaseName = await askResourceName(
    rl,
    'D1 database',
    nextConfig.d1DatabaseName
  );
  const r2BucketName = await askResourceName(
    rl,
    'R2 bucket',
    nextConfig.r2BucketName
  );
  const kvNamespaceName = await askResourceName(
    rl,
    'KV namespace',
    nextConfig.kvNamespaceName
  );

  if (!options.githubRepo) {
    githubRepo = await askGithubRepo(rl, githubRepo);
  }

  return {
    ...nextConfig,
    domain,
    githubRepo,
    d1DatabaseName,
    r2BucketName,
    kvNamespaceName,
  };
}

function requireWaffoCredentials(): void {
  if (!process.env.WAFFO_MERCHANT_ID?.trim() || !process.env.WAFFO_PRIVATE_KEY) {
    throw new Error(
      [
        'WAFFO_MERCHANT_ID and WAFFO_PRIVATE_KEY are required for Waffo payment.',
        `Waffo API key setup docs: ${WAFFO_DOCS_URL}`,
        'Export both variables and run tanstarter create again.',
      ].join('\n')
    );
  }
}

async function askPaymentProvider(
  rl: ReturnType<typeof createInterface>
): Promise<PaymentProvider> {
  while (true) {
    const answer = await rl.question(
      '\nPayment method (none/waffo, default: none): '
    );
    const value = answer.trim().toLowerCase() || 'none';
    if (value === 'none' || value === 'waffo') return value;
    console.log('Payment method must be none or waffo.');
  }
}

async function askProjectName(
  rl: ReturnType<typeof createInterface>
): Promise<string> {
  while (true) {
    const answer = await rl.question('Project name: ');
    const projectName = normalizeSlug(answer.trim());

    try {
      validateSlug(projectName, 'project name');
      return projectName;
    } catch (error) {
      console.log(error instanceof Error ? error.message : String(error));
    }
  }
}

function applyProjectName(
  config: RuntimeConfig,
  projectName: string
): RuntimeConfig {
  return {
    ...config,
    projectName,
    targetDir: path.resolve(process.cwd(), projectName),
    githubRepo: config.githubRepo || projectName,
    waffoStoreName: waffoStoreNameForProject(projectName),
    d1DatabaseName: projectName,
    r2BucketName: projectName,
    kvNamespaceName: projectName,
  };
}

export function formatDefaultGithubRepo(
  projectName: string,
  currentGithubRepo: string,
  githubLogin: string
): string {
  if (currentGithubRepo.includes('/')) return currentGithubRepo;
  if (githubLogin) return `${githubLogin}/${projectName}`;
  return currentGithubRepo || projectName;
}

function getDefaultGithubRepo(
  projectName: string,
  currentGithubRepo: string
): string {
  return formatDefaultGithubRepo(
    projectName,
    currentGithubRepo,
    getGithubLogin()
  );
}

function getGithubLogin(): string {
  const result = spawnSync('gh', ['api', 'user', '--jq', '.login'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });

  if (result.status !== 0 || typeof result.stdout !== 'string') return '';
  return result.stdout.trim();
}

async function confirmSetup(
  rl: ReturnType<typeof createInterface>,
  config: RuntimeConfig
): Promise<void> {
  console.log('\nTanStarter will create:');
  console.log(`  Project: ${config.projectName}`);
  console.log(`  Directory: ${config.targetDir}`);
  console.log(`  Worker: ${config.projectName}`);
  console.log(`  D1 database: ${config.d1DatabaseName}`);
  console.log(`  R2 bucket: ${config.r2BucketName}`);
  console.log(`  KV namespace: ${config.kvNamespaceName}`);
  console.log(
    `  Domain: ${config.domain || '(none; workers.dev fallback after deploy)'}`
  );
  console.log(`  GitHub repo: ${config.githubRepo}`);
  if (config.paymentProvider === 'waffo') {
    console.log('  Payment: Waffo');
    console.log('  Waffo mode: test (WAFFO_DEBUG=true)');
    console.log(`  Waffo store: ${config.waffoStoreName}`);
    for (const product of WAFFO_TEMPLATE_PRODUCTS) {
      const billingLabel = product.billingPeriod
        ? `, ${product.billingPeriod}`
        : '';
      console.log(
        `  Waffo product: ${product.name} ($${product.price} USD${billingLabel})`
      );
    }
    console.log(
      `  Waffo webhook: ${
        config.domain
          ? `https://${config.domain}/api/webhooks/waffo`
          : 'deployed workers.dev URL/api/webhooks/waffo'
      }`
    );
  }

  const answer = await rl.question(
    '\nPress Enter to continue, or type n to cancel [Y/n]: '
  );
  if (answer.trim() && !/^y(es)?$/i.test(answer.trim())) {
    throw new Error('Setup cancelled.');
  }
}

async function askDomain(
  rl: ReturnType<typeof createInterface>,
  isWaffo: boolean
): Promise<string> {
  while (true) {
    const answer = await rl.question(
      isWaffo
        ? '\nCustom domain (optional; Waffo will use the deployed workers.dev URL if omitted): '
        : '\nCustom domain (optional, press Enter to use workers.dev): '
    );
    const domain = normalizeDomain(answer);
    if (!domain) return '';

    try {
      validateDomain(domain);
      return domain;
    } catch (error) {
      console.log(error instanceof Error ? error.message : String(error));
    }
  }
}

async function askResourceName(
  rl: ReturnType<typeof createInterface>,
  label: string,
  defaultValue: string
): Promise<string> {
  while (true) {
    const answer = await rl.question(
      `${label} name (default: ${defaultValue}, press Enter to use default): `
    );
    const value = answer.trim() || defaultValue;

    try {
      validateSlug(value, label);
      return value;
    } catch (error) {
      console.log(error instanceof Error ? error.message : String(error));
    }
  }
}

async function askGithubRepo(
  rl: ReturnType<typeof createInterface>,
  defaultRepo: string
): Promise<string> {
  while (true) {
    const answer = await rl.question(
      `GitHub repo owner/name (default: ${defaultRepo}, press Enter to use default): `
    );
    const repo = answer.trim() || defaultRepo;

    try {
      validateGithubRepo(repo);
      return repo;
    } catch (error) {
      console.log(error instanceof Error ? error.message : String(error));
    }
  }
}
