import type { RuntimeConfig } from './types.js';
import { getPublicBaseUrl } from './deployment.js';
import {
  buildWaffoWebhookUrl,
  WAFFO_TEMPLATE_PRODUCTS,
} from './waffo.js';

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
  printBox([`🚀 ${total ? `Step ${index}/${total}` : `Step ${index}`}: ${title}`]);
}

export function printCompletedStep(title: string): void {
  console.log(`✅ ${title} completed`);
}

export function printFinalSummary(config: RuntimeConfig): void {
  const productionUrl =
    (config.domain ? `https://${config.domain}` : config.deploymentUrl) ||
    '(check Wrangler deploy output)';
  const githubUrl = config.githubRepoUrl || githubRepoToUrl(config.githubRepo);

  printBox([
    '🎉 TanStarter project is ready',
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
        publicBaseUrl
          ? buildWaffoWebhookUrl(publicBaseUrl)
          : '(not registered)'
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
