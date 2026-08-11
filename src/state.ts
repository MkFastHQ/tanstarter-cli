import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import { STATE_DIR, STATE_FILE } from './constants.js';
import type { RuntimeConfig, SetupState } from './types.js';

export function readExistingState(targetDir: string): SetupState {
  const statePath = path.join(targetDir, STATE_DIR, STATE_FILE);
  if (!fs.existsSync(statePath)) {
    throw new Error(`Could not find setup state: ${statePath}`);
  }

  return restoreRuntimeCredentials(
    JSON.parse(fs.readFileSync(statePath, 'utf8')) as SetupState
  );
}

export function readState(
  targetDir: string,
  fallbackConfig: RuntimeConfig
): SetupState {
  const statePath = path.join(targetDir, STATE_DIR, STATE_FILE);
  if (!fs.existsSync(statePath)) {
    const initialState: SetupState = {
      completedSteps: [],
      config: fallbackConfig,
      updatedAt: new Date().toISOString(),
    };
    // A failed first clone may leave no project directory at all. Do not
    // create .tanstarter before git clone, because git clone requires an
    // empty destination directory.
    return fs.existsSync(targetDir) && fs.readdirSync(targetDir).length > 0
      ? writeState(targetDir, initialState)
      : initialState;
  }

  const state = JSON.parse(fs.readFileSync(statePath, 'utf8')) as SetupState;
  return restoreRuntimeCredentials(
    {
      ...state,
      config: {
        ...fallbackConfig,
        ...state.config,
      },
    }
  );
}

export function writeState(targetDir: string, state: SetupState): SetupState {
  const next = { ...state, updatedAt: new Date().toISOString() };
  const statePath = path.join(targetDir, STATE_DIR, STATE_FILE);
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  fs.writeFileSync(
    statePath,
    `${JSON.stringify(sanitizeStateForDisk(next), null, 2)}\n`
  );
  return next;
}

export function markCompleted(
  targetDir: string,
  state: SetupState,
  step: string
): SetupState {
  const completedSteps = state.completedSteps.includes(step)
    ? state.completedSteps
    : [...state.completedSteps, step];
  const next = {
    ...state,
    completedSteps,
    updatedAt: new Date().toISOString(),
  };

  if (!fs.existsSync(targetDir)) {
    return next;
  }

  return writeState(targetDir, next);
}

/**
 * The Waffo private key is a credential and must never be written to the
 * on-disk state file. It is restored from the environment on resume.
 */
function sanitizeStateForDisk(state: SetupState): SetupState {
  return {
    ...state,
    config: {
      ...state.config,
      cloudflareApiToken: '',
      waffoPrivateKey: '',
    },
  };
}

function restoreRuntimeCredentials(state: SetupState): SetupState {
  return {
    ...state,
    config: {
      ...state.config,
      cloudflareApiToken: process.env.CLOUDFLARE_API_TOKEN?.trim() || '',
      waffoMerchantId: process.env.WAFFO_MERCHANT_ID?.trim() || '',
      waffoPrivateKey: process.env.WAFFO_PRIVATE_KEY || '',
    },
  };
}
