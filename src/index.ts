#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { parseArgs } from './args.js';
import {
  cloudflareAuth,
  applyD1Migrations,
  enableEmailSending,
  configureEmailForwarding,
  createD1,
  createKV,
  createR2,
  ensureWorkerCustomDomain,
} from './cloudflare.js';
import {
  runCommandAndEcho,
  runCommand,
  runInherited,
  runInheritedNonInteractive,
} from './commands.js';
import { createConfig } from './config.js';
import {
  getPublicBaseUrl,
  parseDeploymentUrl,
  verifyPublicDeployment,
} from './deployment.js';
import { deleteProject } from './delete.js';
import { ensureEnvFiles } from './env.js';
import {
  commitAndPush,
  createGithubRepo,
  cloneTemplate,
  initializeGit,
} from './git.js';
import { assertNodeVersion, preflight } from './preflight.js';
import { configureSetup } from './prompt.js';
import { configureWebsiteMail } from './website.js';
import { sendTestEmail } from './email-test.js';
import { verifyGithubDeployment } from './github-deployment.js';
import { printAcceptanceReport } from './acceptance.js';
import {
  applyEmailOptions,
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
import {
  assertCloudflareProject,
  writeCloudflareConfig,
} from './cloudflare-config.js';
import {
  addWaffoWebhook,
  createWaffoStore,
  createWaffoProduct,
  WAFFO_TEMPLATE_PRODUCTS,
  verifyWaffoWebhookEndpoint,
} from './waffo.js';

export async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  assertNodeVersion();

  if (options.command === 'delete') {
    const state = readExistingState(options.targetDir);
    assertCloudflareProject(options.targetDir);
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

  if (options.resume && state.completedSteps.includes('clone-template')) {
    assertCloudflareProject(state.config.targetDir);
  }
  state = applyEmailOptions(state, options);

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
        assertCloudflareProject(state.config.targetDir);
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
      id: 'enable-email-sending',
      title: 'Onboard domain for Cloudflare Email Sending',
      run: () => enableEmailSending(state.config),
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
          const productId = await createWaffoProduct(state.config, product);
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
      title: 'Write Cloudflare and environment files',
      run: () => {
        writeCloudflareConfig(state.config);
        ensureEnvFiles(state.config);
        updatePackageName(state.config);
      },
    },
    {
      id: 'configure-website-mail',
      title: 'Configure application mail sender and support address',
      run: () => {
        // Older completed initializations must deploy and push this new config.
        // Persist invalidation first so interruption cannot leave stale success.
        const rerun = new Set([
          'deploy',
          'sync-worker-secrets',
          'verify-public-deployment',
          'commit-and-push',
          'verify-github-deployment',
          'verify-final-deployment',
        ]);
        const config = { ...state.config };
        delete config.initialCommitSha;
        delete config.githubDeployment;
        state = writeState(state.config.targetDir, {
          ...state,
          completedSteps: state.completedSteps.filter(
            (step) => !rerun.has(step)
          ),
          config,
        });
        configureWebsiteMail(state.config);
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
      run: () => applyD1Migrations(state.config, true),
    },
    {
      id: 'db-migrate-remote',
      title: 'Apply remote database migrations',
      run: () => applyD1Migrations(state.config, false),
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
          ['run', 'deploy'],
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
          // until Cloudflare CLI has deployed once. Rebuild after writing the
          // discovered public URL so auth/callback/payment URLs are correct.
          if (!state.config.domain && !hadDeploymentUrl) {
            console.log(
              '\nworkers.dev URL discovered; rebuilding with the public production base URL.'
            );
            runCommandAndEcho('pnpm', ['run', 'deploy'], state.config);
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
      run: () => {
        // Generated TypeScript must pass the template's read-only CI formatter.
        runInheritedNonInteractive(
          'pnpm',
          [
            'exec',
            'biome',
            'format',
            '--write',
            'cloudflare.config.ts',
            ...(state.config.emailSending ? ['src/config/website.ts'] : []),
          ],
          state.config
        );
        commitAndPush(state.config);
        const config = {
          ...state.config,
          initialCommitSha: runCommand(
            'git',
            ['rev-parse', 'HEAD'],
            state.config
          ).stdout.trim(),
        };
        delete config.githubDeployment;
        state = writeState(state.config.targetDir, { ...state, config });
      },
    },
    {
      id: 'verify-github-deployment',
      title: 'Confirm initialization commit GitHub Actions deployment',
      run: async () => {
        if (!state.config.initialCommitSha) {
          state = writeState(state.config.targetDir, {
            ...state,
            config: {
              ...state.config,
              initialCommitSha: runCommand(
                'git',
                ['rev-parse', 'HEAD'],
                state.config
              ).stdout.trim(),
            },
          });
        }
        await verifyGithubDeployment(state.config, {
          onRun: (githubDeployment) => {
            state = writeState(state.config.targetDir, {
              ...state,
              config: { ...state.config, githubDeployment },
            });
          },
        });
      },
    },
    {
      id: 'verify-final-deployment',
      title: 'Verify public URL after GitHub Actions deployment',
      run: () => verifyPublicDeployment(state.config),
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
  if (state.config.emailTestTo && !state.config.emailSending) {
    throw new Error(
      '--email-test-to requires Cloudflare Email Sending; pass --email-sending with a custom domain.'
    );
  }
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
    try {
      await step.run();
    } catch (error) {
      printAcceptanceReport(state);
      throw error;
    }
    state = markCompleted(state.config.targetDir, state, step.id);
    printCompletedStep(step.title);
  }

  if (
    state.config.emailForwardTo &&
    !state.completedSteps.includes('configure-email-forwarding')
  ) {
    printStep(
      totalSteps + 1,
      totalSteps + 1,
      'Configure optional email forwarding'
    );
    if (await configureEmailForwarding(state.config)) {
      state = markCompleted(
        state.config.targetDir,
        state,
        'configure-email-forwarding'
      );
      printCompletedStep('Configure optional email forwarding');
    }
  }

  if (
    state.config.emailTestTo &&
    !state.completedSteps.includes('test-email')
  ) {
    // Record the attempt before sending: a crash or timeout must not cause an
    // unsolicited duplicate on resume. An explicit --email-test-to opts in again.
    state = markCompleted(state.config.targetDir, state, 'test-email');
    console.log(
      `Sending one provider test email to ${state.config.emailTestTo}.`
    );
    try {
      const emailTestResult = await sendTestEmail(state.config);
      state = writeState(state.config.targetDir, {
        ...state,
        config: { ...state.config, emailTestResult },
      });
    } catch {
      console.warn(
        'Could not perform the email test; verify application mail configuration and explicitly request another test when ready.'
      );
    }
  }
  printFinalSummary(state.config);
  printAcceptanceReport(state);
}

function shouldIncludeStep(
  stepId: string,
  config: SetupState['config']
): boolean {
  if (stepId === 'enable-email-sending' || stepId === 'configure-website-mail')
    return Boolean(config.emailSending);
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
    if (process.argv.slice(2).some((arg) => arg === 'delete')) {
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

function markCompletedInMemory(state: SetupState, step: string): SetupState {
  return {
    ...state,
    completedSteps: state.completedSteps.includes(step)
      ? state.completedSteps
      : [...state.completedSteps, step],
    updatedAt: new Date().toISOString(),
  };
}
