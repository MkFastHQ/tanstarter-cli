import path from 'node:path';
import process from 'node:process';

import { printHelp, printVersion } from './help.js';
import type { CliOptions, PaymentProvider } from './types.js';
import { requireValue } from './utils.js';
import { normalizeSlug, validateSlug } from './validators.js';

export function parseArgs(args: string[]): CliOptions {
  let command: CliOptions['command'] | undefined;
  let projectName = '';
  let domain = '';
  let githubRepo: string | undefined;
  let payment: PaymentProvider | undefined;
  let resume = false;

  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (!arg) continue;

    if (arg === '-h' || arg === '--help') {
      printHelp();
      process.exit(0);
    }
    if (arg === '-v' || arg === '--version') {
      printVersion();
      process.exit(0);
    }
    if (arg === '--resume') {
      resume = true;
      continue;
    }
    if (arg === 'create') {
      if (command) {
        throw new Error('create must be the first positional argument.');
      }
      command = 'create';
      continue;
    }
    if (arg === 'delete') {
      if (command || projectName) {
        throw new Error('delete must be the first positional argument.');
      }
      command = 'delete';
      continue;
    }
    if (arg === '--domain') {
      domain = requireValue(args, ++index, '--domain');
      continue;
    }
    if (arg.startsWith('--domain=')) {
      domain = arg.slice('--domain='.length);
      continue;
    }
    if (arg === '--repo') {
      githubRepo = requireValue(args, ++index, '--repo');
      continue;
    }
    if (arg.startsWith('--repo=')) {
      githubRepo = arg.slice('--repo='.length);
      continue;
    }
    if (arg === '--payment') {
      payment = parsePaymentProvider(requireValue(args, ++index, '--payment'));
      continue;
    }
    if (arg.startsWith('--payment=')) {
      payment = parsePaymentProvider(arg.slice('--payment='.length));
      continue;
    }
    if (arg.startsWith('-')) {
      throw new Error(`Unknown option: ${arg}`);
    }
    if (!projectName) {
      projectName = arg;
      continue;
    }
    throw new Error(`Unexpected argument: ${arg}`);
  }

  if (!command) {
    printHelp();
    throw new Error('Command is required.');
  }

  if (command === 'delete' && !projectName) {
    printHelp();
    throw new Error('Project name is required for delete.');
  }

  if (command === 'create' && resume && !projectName) {
    throw new Error('Project name is required when using --resume.');
  }

  const normalizedProjectName = projectName ? normalizeSlug(projectName) : '';
  if (normalizedProjectName) {
    validateSlug(normalizedProjectName, 'project name');
  }

  return {
    command,
    projectName: normalizedProjectName,
    targetDir: normalizedProjectName
      ? path.resolve(process.cwd(), normalizedProjectName)
      : '',
    domain,
    ...(githubRepo ? { githubRepo } : {}),
    ...(payment ? { payment } : {}),
    resume,
  };
}

function parsePaymentProvider(value: string): PaymentProvider {
  if (value === 'none' || value === 'waffo') return value;
  throw new Error('--payment must be none or waffo.');
}
