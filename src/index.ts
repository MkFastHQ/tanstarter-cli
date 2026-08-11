#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { parseArgs } from './args.js';
import {
  cloudflareAuth,
  createD1,
  createKV,
  createR2,
  ensureWorkerCustomDomain,
} from './cloudflare.js';
import {
  runCommandAndEcho,
  runInherited,
  runInheritedNonInteractive,
} from './commands.js';
import { createConfig } from './config.js';
import { getPublicBaseUrl, verifyPublicDeployment } from './deployment.js';
import { deleteProject } from './delete.js';
import { ensureEnvFiles } from './env.js';
import {
  commitAndPush,
  createGithubRepo,
  cloneTemplate,
  initializeGit,
} from './git.js';
import { preflight } from './preflight.js';
import { configureSetup } from './prompt.js';
import {
  markCompleted,
  readExistingState,
  readState,
  writeState,
} from './state.js';
import {
  printCompletedStep,
  printFinalSummary,
  printStep,
  printWelcomeBanner,
} from './output.js';
import { updatePackageName } from './template.js';
import type { SetupState } from './types.js';
import { writeWranglerConfig } from './wrangler-config.js';
import {
  addWaffoWebhook,
  createWaffoStore,
  createWaffoProduct,
  WAFFO_TEMPLATE_PRODUCTS,
  verifyWaffoWebhookEndpoint,
} from './waffo.js';

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));

  if (options.command === 'delete') {
    const state = readExistingState(options.targetDir);
    await deleteProject(options, state.config);
    return;
  }

  printWelcomeBanner();

  const initialConfig = createConfig(options);

  let state: SetupState = options.resume
    ? readState(options.targetDir, initialConfig)
    : {
        completedSteps: [],
        config: initialConfig,
        updatedAt: new Date().toISOString(),
      };

  const steps: Array<{
    id: string;
    title: string;
    run: () => Promise<void> | void;
  }> = [
    {
      id: 'clone-template',
      title: 'Clone TanStarter template',
      run: () => {
        cloneTemplate(state.config.targetDir, options.resume);
        // Persist the user's choices as soon as the project directory exists,
        // so a later failure can always be resumed without re-prompting.
        state = writeState(state.config.targetDir, state);
      },
    },
    {
      id: 'initialize-git',
      title: 'Initialize project Git repository',
      run: () => initializeGit(state.config.targetDir),
    },
    {
      id: 'install',
      title: 'Install project dependencies',
      run: () => runInherited('pnpm', ['install'], state.config),
    },
    {
      id: 'cloudflare-auth',
      title: 'Verify Cloudflare authentication',
      run: () => cloudflareAuth(state.config),
    },
    {
      id: 'waffo-create-store',
      title: 'Create Waffo store',
      run: async () => {
        if (state.config.paymentProvider !== 'waffo') return;
        if (state.config.waffoStoreId) return;
        const waffoStoreId = await createWaffoStore(
          state.config,
          state.config.waffoStoreName
        );
        state = writeState(state.config.targetDir, {
          ...state,
          config: { ...state.config, waffoStoreId },
        });
      },
    },
    {
      id: 'waffo-create-products',
      title: 'Create Waffo template products',
      run: async () => {
        if (state.config.paymentProvider !== 'waffo') return;
        for (const product of WAFFO_TEMPLATE_PRODUCTS) {
          if (state.config.waffoProductIds[product.slot]) continue;
          const productId = await createWaffoProduct(
            state.config,
            product
          );
          state = writeState(state.config.targetDir, {
            ...state,
            config: {
              ...state.config,
              waffoProductIds: {
                ...state.config.waffoProductIds,
                [product.slot]: productId,
              },
            },
          });
        }
      },
    },
    {
      id: 'create-d1',
      title: 'Create Cloudflare D1 database',
      run: () => {
        const nextConfig = createD1(state.config);
        state = writeState(state.config.targetDir, {
          ...state,
          config: nextConfig,
        });
      },
    },
    {
      id: 'create-r2',
      title: 'Create Cloudflare R2 bucket',
      run: () => createR2(state.config),
    },
    {
      id: 'create-kv',
      title: 'Create Cloudflare KV namespace',
      run: () => {
        const nextConfig = createKV(state.config);
        state = writeState(state.config.targetDir, {
          ...state,
          config: nextConfig,
        });
      },
    },
    {
      id: 'write-config',
      title: 'Write Wrangler and environment files',
      run: () => {
        writeWranglerConfig(state.config);
        ensureEnvFiles(state.config);
        updatePackageName(state.config);
      },
    },
    {
      id: 'cf-typegen',
      title: 'Generate Cloudflare binding types',
      run: () => runInherited('pnpm', ['run', 'cf-typegen'], state.config),
    },
    {
      id: 'db-migrate-local',
      title: 'Apply local database migrations',
      run: () =>
        runInheritedNonInteractive(
          'pnpm',
          ['run', 'db:migrate:local'],
          state.config
        ),
    },
    {
      id: 'db-migrate-remote',
      title: 'Apply remote database migrations',
      run: () =>
        runInheritedNonInteractive(
          'pnpm',
          ['run', 'db:migrate:remote'],
          state.config
        ),
    },
    {
      id: 'deploy',
      title: 'Build and deploy Cloudflare Worker',
      run: () => {
        const hadDeploymentUrl = Boolean(state.config.deploymentUrl);
        // Reconcile the production env file before every deployment so the
        // public base URL and generated payment variables are current.
        ensureEnvFiles(state.config);
        const result = runCommandAndEcho(
          'pnpm',
          ['run', 'deploy', '--', '--keep-vars'],
          state.config
        );
        const deploymentUrl = parseDeploymentUrl(
          `${result.stdout}\n${result.stderr}`
        );
        if (deploymentUrl) {
          state = writeState(state.config.targetDir, {
            ...state,
            config: { ...state.config, deploymentUrl },
          });
          ensureEnvFiles(state.config);

          // Without a custom domain, Vite cannot know the workers.dev URL
          // until Wrangler has deployed once. Rebuild after writing the
          // discovered public URL so auth/callback/payment URLs are correct.
          if (!state.config.domain && !hadDeploymentUrl) {
            console.log(
              '\nworkers.dev URL discovered; rebuilding with the public production base URL.'
            );
            runCommandAndEcho(
              'pnpm',
              ['run', 'deploy', '--', '--keep-vars'],
              state.config
            );
          }
        }
      },
    },
    {
      id: 'ensure-custom-domain',
      title: 'Confirm Cloudflare custom-domain binding',
      run: () => ensureWorkerCustomDomain(state.config),
    },
    {
      id: 'sync-worker-secrets',
      title: 'Sync Worker secrets',
      run: () =>
        runInheritedNonInteractive(
          'pnpm',
          ['run', 'sync-worker-secrets'],
          state.config
        ),
    },
    {
      id: 'verify-public-deployment',
      title: 'Verify public deployment URL',
      run: () => verifyPublicDeployment(state.config),
    },
    {
      id: 'waffo-webhook',
      title: 'Register Waffo webhook',
      run: async () => {
        if (state.config.paymentProvider !== 'waffo') return;
        if (state.config.waffoWebhookId) return;
        const publicBaseUrl = getPublicBaseUrl(state.config);
        if (!publicBaseUrl) {
          throw new Error(
            'No public deployment URL is available for the Waffo webhook. Rerun with --resume after confirming the deployment URL.'
          );
        }
        await verifyWaffoWebhookEndpoint(publicBaseUrl);
        const waffoWebhookId = await addWaffoWebhook(
          state.config,
          state.config.waffoStoreId,
          publicBaseUrl
        );
        state = writeState(state.config.targetDir, {
          ...state,
          config: { ...state.config, waffoWebhookId },
        });
      },
    },
    {
      id: 'create-github-repo',
      title: 'Create or connect GitHub repository',
      run: () => {
        const nextConfig = createGithubRepo(state.config);
        state = writeState(state.config.targetDir, {
          ...state,
          config: nextConfig,
        });
      },
    },
    {
      id: 'sync-github-secrets',
      title: 'Sync GitHub Actions secrets',
      run: () => {
        const args = ['run', 'sync-github-secrets'];
        if (state.config.githubRepo.includes('/')) {
          args.push('--', '--repo', state.config.githubRepo);
        }
        runInherited('pnpm', args, state.config);
      },
    },
    {
      id: 'commit-and-push',
      title: 'Commit and push initial project',
      run: () => commitAndPush(state.config),
    },
  ];

  if (!state.completedSteps.includes('preflight')) {
    printStep(1, undefined, 'Check local tools and credentials');
    preflight(state.config);
    state = markCompletedInMemory(state, 'preflight');
    printCompletedStep('Check local tools and credentials');
  } else {
    console.log('✅ Check local tools and credentials already completed');
  }

  printStep(2, undefined, 'Review project and setup options');
  state = {
    ...state,
    config: await configureSetup(options, state.config),
  };
  printCompletedStep('Review project and setup options');

  const activeSteps = steps.filter((step) =>
    shouldIncludeStep(step.id, state.config)
  );
  const totalSteps = activeSteps.length + 2;

  for (const [index, step] of activeSteps.entries()) {
    if (state.completedSteps.includes(step.id)) {
      console.log(`✅ ${step.title} already completed`);
      continue;
    }

    printStep(index + 3, totalSteps, step.title);
    await step.run();
    state = markCompleted(state.config.targetDir, state, step.id);
    printCompletedStep(step.title);
  }

  printFinalSummary(state.config);
}

function shouldIncludeStep(
  stepId: string,
  config: SetupState['config']
): boolean {
  if (stepId.startsWith('waffo-')) {
    return config.paymentProvider === 'waffo';
  }
  if (stepId === 'verify-public-deployment') {
    return true;
  }
  if (stepId === 'ensure-custom-domain') {
    return Boolean(config.domain);
  }
  return true;
}

if (isCliEntrypoint(process.argv[1], import.meta.url)) {
  main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`\nTanStarter CLI failed:\n${message}`);
    if (
      process.argv
        .slice(2)
        .some((arg) => arg === 'delete')
    ) {
      console.error(
        '\nCheck the project name and local state file, then rerun delete.'
      );
    } else {
      console.error('\nFix the issue and rerun with --resume when applicable.');
    }
    process.exit(1);
  });
}

export function isCliEntrypoint(
  argvPath: string | undefined,
  moduleUrl: string
): boolean {
  if (!argvPath) return false;

  const modulePath = fileURLToPath(moduleUrl);
  try {
    return fs.realpathSync(argvPath) === fs.realpathSync(modulePath);
  } catch {
    return path.resolve(argvPath) === path.resolve(modulePath);
  }
}

function parseDeploymentUrl(output: string): string | undefined {
  return output
    .match(/https:\/\/[^\s)]+/g)
    ?.find((url) => url.includes('.workers.dev'));
}

function markCompletedInMemory(state: SetupState, step: string): SetupState {
  return {
    ...state,
    completedSteps: state.completedSteps.includes(step)
      ? state.completedSteps
      : [...state.completedSteps, step],
    updatedAt: new Date().toISOString(),
  };
}
