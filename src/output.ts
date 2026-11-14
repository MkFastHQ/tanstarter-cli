import type { RuntimeConfig } from './types.js';
import { getPublicBaseUrl } from './deployment.js';
import { buildWaffoWebhookUrl, WAFFO_TEMPLATE_PRODUCTS } from './waffo.js';

const BOX_WIDTH = 96;

export function printWelcomeBanner(): void {
  printBox([
    '████████╗ █████╗ ███╗   ██╗███████╗████████╗ █████╗ ██████╗ ████████╗███████╗██████╗',
    '╚══██╔══╝██╔══██╗████╗  ██║██╔════╝╚══██╔══╝██╔══██╗██╔══██╗╚══██╔══╝██╔════╝██╔══██╗',
    '   ██║   ███████║██╔██╗ ██║███████╗   ██║   ███████║██████╔╝   ██║   █████╗  ██████╔╝',
    '   ██║   ██╔══██║██║╚██╗██║╚════██║   ██║   ██╔══██║██╔══██╗   ██║   ██╔══╝  ██╔══██╗',
    '   ██║   ██║  ██║██║ ╚████║███████║   ██║   ██║  ██║██║  ██║   ██║   ███████╗██║  ██║',
    '   ╚═╝   ╚═╝  ╚═╝╚═╝  ╚═══╝╚══════╝   ╚═╝   ╚═╝  ╚═╝╚═╝  ╚═╝   ╚═╝   ╚══════╝╚═╝  ╚═╝',
    '',
    'Website: https://tanstarter.dev',
    'Docs:    https://docs.tanstarter.dev',
    'Video:   https://docs.tanstarter.dev/video',
  ]);
}

export function printStep(
  index: number,
  total: number | undefined,
  title: string
): void {
  printBox([
    `🚀 ${total ? `Step ${index}/${total}` : `Step ${index}`}: ${title}`,
  ]);
}

export function printCompletedStep(title: string, details: string[] = []): void {
  console.log(`✅ ${title} completed`);
  printDetails(details);
}

export function printFailedStep(title: string): void {
  console.error(`❌ ${title} failed`);
}

export function printResumedStep(title: string, details: string[] = []): void {
  console.log(`⏭ ${title} already completed; skipped on resume`);
  printDetails(details);
}

function printDetails(details: string[]): void {
  for (const detail of details) console.log(`   ${detail}`);
}

/** Only display known, non-secret setup results; never dump runtime config. */
export function stepResultDetails(id: string, config: RuntimeConfig): string[] {
  switch (id) {
    case 'clone-template':
    case 'initialize-git':
      return [`Directory: ${config.targetDir}`];
    case 'install':
      return ['Dependency installation finished; review any pnpm warnings above.'];
    case 'cloudflare-auth':
      return [`Account: ${config.cloudflareAccountId}`];
    case 'enable-email-sending':
      return [`Sending domain: ${config.domain}`];
    case 'waffo-create-store':
      return [`Store: ${config.waffoStoreName}`, `ID: ${config.waffoStoreId}`];
    case 'waffo-create-products':
      return WAFFO_TEMPLATE_PRODUCTS.map(
        (product) => `${product.name}: ${config.waffoProductIds[product.slot]}`
      );
    case 'create-d1':
      return [`Database: ${config.d1DatabaseName}`, `ID: ${config.d1DatabaseId}`];
    case 'create-r2':
      return [`Bucket: ${config.r2BucketName}`];
    case 'create-kv':
      return [`Namespace: ${config.kvNamespaceName}`, `ID: ${config.kvNamespaceId}`];
    case 'write-config':
      return ['Files: cloudflare.config.ts, .env, .env.production, package.json'];
    case 'configure-website-mail':
      return [
        'File: src/config/website.ts',
        'Mail enabled with Cloudflare provider.',
      ];
    case 'cf-typegen':
      return ['Cloudflare binding types generated.'];
    case 'db-migrate-local':
    case 'db-migrate-remote':
      return [
        `Database: ${config.d1DatabaseName} (${config.d1DatabaseId})`,
        `Target: ${id === 'db-migrate-local' ? 'local' : 'remote'}; migration command succeeded.`,
      ];
    case 'deploy':
      return [`Worker: ${config.projectName}`, ...publicUrlDetails(config)];
    case 'ensure-custom-domain':
      return [`Domain: ${config.domain}`, `Worker: ${config.projectName}`];
    case 'sync-worker-secrets':
      return [`Worker: ${config.projectName}; secret sync command succeeded.`];
    case 'verify-public-deployment':
    case 'verify-final-deployment':
      return [
        ...publicUrlDetails(config),
        'HTTP check passed; application flows still need testing.',
      ];
    case 'waffo-webhook': {
      const baseUrl = getPublicBaseUrl(config);
      return [
        `Webhook ID: ${config.waffoWebhookId}`,
        ...(baseUrl ? [`URL: ${buildWaffoWebhookUrl(baseUrl)}`] : []),
      ];
    }
    case 'create-github-repo':
      return [
        `Repository: ${config.githubRepoUrl || githubRepoToUrl(config.githubRepo)}`,
      ];
    case 'sync-github-secrets':
      return [`Repository: ${config.githubRepo}; secret sync command succeeded.`];
    case 'commit-and-push':
      return [
        `Repository: ${config.githubRepo}`,
        `Commit: ${config.initialCommitSha || '(unavailable)'}`,
      ];
    case 'verify-github-deployment':
      return config.githubDeployment
        ? [
            `Run: ${config.githubDeployment.url}`,
            `Commit: ${config.githubDeployment.headSha}`,
            `Conclusion: ${config.githubDeployment.conclusion || config.githubDeployment.status}`,
          ]
        : [];
    case 'configure-email-catch-all':
      return [`*@${config.domain} → ${config.emailForwardTo}`, 'Existing address-specific rules take priority.'];
    default:
      return [];
  }
}

function publicUrlDetails(config: RuntimeConfig): string[] {
  const url = getPublicBaseUrl(config);
  return url ? [`URL: ${url}`] : ['Public URL unavailable; check deployment output.'];
}

export function printEmailTestResult(config: RuntimeConfig): void {
  const result = config.emailTestResult;
  switch (result?.status) {
    case 'accepted':
      console.log('✅ Provider test email: provider reported delivery');
      break;
    case 'queued':
      console.log('✅ Provider test email: accepted into provider queue');
      break;
    case 'failed':
      printFailedStep('Provider test email');
      break;
    default:
      console.warn('⚠ Provider test email outcome unconfirmed; no automatic resend.');
  }
  printDetails([
    `Recipient: ${result?.to || config.emailTestTo}`,
    'Check the recipient inbox; this does not verify application email flows.',
  ]);
}

export function printFinalSummary(config: RuntimeConfig): void {
  const productionUrl =
    (config.domain ? `https://${config.domain}` : config.deploymentUrl) ||
    '(check Cloudflare CLI deploy output)';
  const githubUrl = config.githubRepoUrl || githubRepoToUrl(config.githubRepo);

  printBox([
    '🎉 TanStarter project initialization completed',
    '',
    `Project: ${config.projectName}`,
    `Directory: ${config.targetDir}`,
    `Website: ${productionUrl}`,
    `GitHub: ${githubUrl}`,
    `Delete: npx tanstarter-cli@latest delete ${config.projectName}`,
  ]);
  if (config.paymentProvider === 'waffo') {
    const publicBaseUrl = getPublicBaseUrl(config);
    const productIds = config.waffoProductIds;
    printBox([
      '💳 Waffo payment (test)',
      '⚠ Test transactions only.',
      '',
      `Store: ${config.waffoStoreId || '(not created)'}`,
      ...WAFFO_TEMPLATE_PRODUCTS.map(
        (product) =>
          `${product.name}: ${productIds[product.slot] || '(not created)'}`
      ),
      `Webhook: ${
        publicBaseUrl ? buildWaffoWebhookUrl(publicBaseUrl) : '(not registered)'
      }`,
    ]);
  }
}

function printBox(lines: string[]): void {
  const border = '═'.repeat(BOX_WIDTH - 2);
  console.log(`\n╔${border}╗`);
  for (const line of lines) {
    console.log(`║ ${fitLine(line)} ║`);
  }
  console.log(`╚${border}╝`);
}

function fitLine(line: string): string {
  const maxLength = BOX_WIDTH - 4;
  if (line.length <= maxLength) return line.padEnd(maxLength, ' ');
  return `${line.slice(0, maxLength - 1)}…`;
}

function githubRepoToUrl(repo: string): string {
  return repo.includes('/') ? `https://github.com/${repo}` : repo;
}
