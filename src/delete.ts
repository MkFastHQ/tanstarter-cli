import { createInterface } from 'node:readline/promises';

import { deleteD1, deleteKV, deleteR2, deleteWorker, deleteWorkerCustomDomain } from './cloudflare.js';
import { deleteGithubRepo } from './git.js';
import { printCompletedStep, printStep } from './output.js';
import { cleanupWaffoResources, hasWaffoResources } from './waffo.js';
import type { CliOptions, RuntimeConfig } from './types.js';

export async function deleteProject(
  options: CliOptions,
  config: RuntimeConfig
): Promise<void> {
  await confirmDelete(options, config);

  console.log('\nDeleting TanStarter resources...');

  const failures: string[] = [];
  const steps: Array<{
    label: string;
    action: () => Promise<void> | void;
    skipReason?: string;
  }> = [
    { label: 'Cloudflare Worker', action: () => deleteWorker(config) },
    {
      label: 'KV namespace', action: () => deleteKV(config),
      ...(!config.kvNamespaceId ? { skipReason: 'No namespace ID was saved; verify any unrecorded resources in Cloudflare.' } : {}),
    },
    { label: 'R2 bucket', action: () => deleteR2(config) },
    {
      label: 'D1 database', action: () => deleteD1(config),
      ...(!config.d1DatabaseId ? { skipReason: 'No database ID was saved; verify any unrecorded resources in Cloudflare.' } : {}),
    },
    {
      label: 'GitHub repo',
      action: () => deleteGithubRepo(options, config),
    },
  ];

  if (config.domain) {
    steps.unshift({
      label: 'Worker custom-domain binding',
      action: () => deleteWorkerCustomDomain(config),
    });
  }
  if (hasWaffoResources(config)) {
    steps.unshift({
      label: 'Waffo initialization resources',
      action: () => cleanupWaffoResources(config),
    });
  }

  for (const [index, step] of steps.entries()) {
    printStep(index + 1, steps.length, `Delete ${step.label}`);
    if (step.skipReason) {
      console.warn(`⏭ Delete ${step.label} skipped: ${step.skipReason}`);
      continue;
    }
    await runDeleteStep(failures, step.label, step.action);
  }

  console.log('Kept: local files (including .env files and setup state), domain email configuration, email DNS records, and verified destination mailboxes.');
  if (failures.length > 0) {
    throw new Error(
      `Some resources could not be deleted: ${failures.join(', ')}`
    );
  }

  console.log(steps.some((step) => step.skipReason)
    ? '\nResource cleanup finished with skipped resources; review the messages above.'
    : '\nResource cleanup completed. Waffo products, if present, were deactivated.');
  console.log(`Local project directory was left in place: ${config.targetDir}`);
}

async function runDeleteStep(
  failures: string[],
  label: string,
  action: () => Promise<void> | void
): Promise<void> {
  try {
    await action();
    printCompletedStep(`Delete ${label}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (isAlreadyDeleted(message)) {
      console.log(`✅ ${label} was already deleted.`);
      return;
    }
    if (message.includes('delete_repo')) {
      console.error(
        '\nGitHub CLI is missing repository delete permission. Run:\n' +
          '  gh auth refresh -h github.com -s delete_repo'
      );
    }

    console.error(`\nCould not delete ${label}:\n${message}`);
    failures.push(label);
  }
}

function isAlreadyDeleted(message: string): boolean {
  return [
    'Worker does not exist',
    'namespace not found',
    'specified bucket does not exist',
    // Generic 404/Not Found can also hide authorization failures (notably GitHub).
    // Only accept explicit resource-specific absence messages.
  ].some((pattern) => message.includes(pattern));
}

async function confirmDelete(
  options: CliOptions,
  config: RuntimeConfig
): Promise<void> {
  console.log('\nTanStarter will delete:');
  console.log(`  Worker: ${config.projectName}`);
  if (config.domain) {
    console.log(`  Worker custom domain route: ${config.domain}`);
  }
  console.log(
    `  GitHub repo: ${options.githubRepo || config.githubRepo || config.projectName}`
  );
  console.log(`  D1 database: ${config.d1DatabaseName}`);
  console.log(`  R2 bucket: ${config.r2BucketName}`);
  console.log(`  KV namespace: ${config.kvNamespaceName}`);
  if (hasWaffoResources(config)) {
    console.log('  Waffo: use the original Test API Key; signed requests use the key environment.');
    if (config.waffoWebhookId) console.log(`  Remove Waffo webhook: ${config.waffoWebhookId}`);
    for (const [slot, id] of Object.entries(config.waffoProductIds)) {
      if (id) console.log(`  Deactivate Waffo product ${slot}: ${id}`);
    }
    if (config.waffoStoreId) console.log(`  Delete Waffo store: ${config.waffoStoreId} (if no blocking dependencies)`);
    console.log('  Waffo products are deactivated, not permanently deleted.');
  }

  if (!process.stdin.isTTY) return;

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await rl.question('\nType "delete" to continue: ');
    if (answer.trim() !== 'delete') {
      throw new Error('Delete cancelled.');
    }
  } finally {
    rl.close();
  }
}
