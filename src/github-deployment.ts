import { runCommand } from './commands.js';
import type { GithubDeployment, RuntimeConfig } from './types.js';

interface WorkflowRun extends GithubDeployment {
  databaseId: number;
  event: string;
  headBranch: string;
}

export interface GithubVerificationOptions {
  maxAttempts?: number;
  retryDelayMs?: number;
  sleep?: (milliseconds: number) => Promise<void>;
  onRun?: (run: GithubDeployment) => void;
}

/** Match only this initialization commit's production push workflow. */
export async function verifyGithubDeployment(
  config: RuntimeConfig,
  options: GithubVerificationOptions = {}
): Promise<GithubDeployment> {
  const sha = config.initialCommitSha;
  if (!sha || !/^[a-f0-9]{40,64}$/i.test(sha))
    throw new Error(
      'The initialization commit SHA is missing; cannot verify its GitHub deployment.'
    );
  const repo = runCommand(
    'gh',
    [
      'repo',
      'view',
      ...(config.githubRepo.includes('/') ? [config.githubRepo] : []),
      '--json',
      'nameWithOwner',
      '--jq',
      '.nameWithOwner',
    ],
    config
  ).stdout.trim();
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo))
    throw new Error('Could not resolve the project GitHub repository.');
  const attempts = options.maxAttempts ?? 120;
  const delay = options.retryDelayMs ?? 10_000;
  const sleep =
    options.sleep ??
    ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  let latest: GithubDeployment | undefined;
  let previous = '';
  let queryFailed = false;
  for (let attempt = 0; attempt < attempts; attempt++) {
    let runs: WorkflowRun[] = [];
    try {
      const output = runCommand(
        'gh',
        [
          'run',
          'list',
          '--repo',
          repo,
          '--workflow',
          'deploy.yml',
          '--commit',
          sha,
          '--branch',
          'main',
          '--event',
          'push',
          '--limit',
          '20',
          '--json',
          'databaseId,headSha,event,headBranch,status,conclusion,url',
        ],
        config
      ).stdout;
      const value: unknown = JSON.parse(output);
      if (!Array.isArray(value)) throw new Error('Expected workflow runs.');
      runs = value as WorkflowRun[];
      queryFailed = false;
    } catch {
      queryFailed = true;
    }
    const run = runs
      .filter(
        (candidate) =>
          candidate.headSha === sha &&
          candidate.event === 'push' &&
          candidate.headBranch === 'main'
      )
      .sort((a, b) => b.databaseId - a.databaseId)[0];
    if (run) {
      latest = {
        headSha: run.headSha,
        url: run.url,
        status: run.status,
        conclusion: run.conclusion,
      };
      options.onRun?.(latest);
      const state = `${run.databaseId}:${run.status}:${run.conclusion}`;
      if (state !== previous) {
        console.log(
          `GitHub deployment: ${run.conclusion || run.status}\n${run.url}`
        );
        previous = state;
      }
      if (run.status === 'completed') {
        if (run.conclusion === 'success') return latest;
        throw new Error(
          `The initialization commit's GitHub deployment ${run.conclusion || 'did not succeed'}.\n${run.url}\nInspect the failed job, fix the issue, rerun that workflow, then resume initialization.`
        );
      }
    } else if (attempt === 0 || attempt % 6 === 0) {
      console.log(
        queryFailed
          ? 'Could not query GitHub deployment; retrying.'
          : "Waiting for the initialization commit's deploy.yml push run."
      );
    }
    if (attempt + 1 < attempts) await sleep(delay);
  }
  throw new Error(
    [
      queryFailed
        ? 'Could not confirm GitHub deployment after repeated query failures.'
        : "Timed out waiting for the initialization commit's GitHub deployment.",
      latest?.url || `https://github.com/${repo}/actions/workflows/deploy.yml`,
      'Check Actions is enabled and the push workflow ran for this commit, then resume initialization.',
    ].join('\n')
  );
}
