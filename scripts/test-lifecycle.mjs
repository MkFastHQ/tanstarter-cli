import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Opt-in live test: creates real resources and always attempts CLI cleanup.
// Use a dedicated project name and never point this at an existing project.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const parent = path.resolve(process.env.TANSTARTER_E2E_PARENT || path.dirname(root));
const name = process.env.TANSTARTER_E2E_PROJECT || 'test-cli';
assert.match(name, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
const target = path.join(parent, name);
const stateFile = path.join(target, '.tanstarter/state.json');
const binary = path.join(root, 'dist/index.js');
const output = fs.mkdtempSync(path.join(os.tmpdir(), 'tanstarter-lifecycle-'));
const account = process.env.CLOUDFLARE_ACCOUNT_ID;
const token = process.env.CLOUDFLARE_API_TOKEN;
const results = [];

function gh(args) {
  const result = spawnSync('gh', args, { cwd: parent, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`GitHub lookup failed: gh ${args.join(' ')}`);
  return result.stdout;
}
async function cf(endpoint) {
  const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(account)}${endpoint}`, {
    headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(30000),
  });
  const body = await response.json();
  return { status: response.status, body };
}
async function absent(label, endpoint, code) {
  const response = await cf(endpoint);
  assert.equal(response.status, 404, `${label}: expected absence, got HTTP ${response.status}`);
  assert.ok(response.body.errors?.some(error => error.code === code), `${label}: expected resource-specific absence code ${code}`);
}
async function noNamedResources(endpoint, label) {
  for (let page = 1; ; page++) {
    const response = await cf(`${endpoint}?page=${page}&per_page=50`);
    assert.equal(response.status, 200, `${label}: cannot inspect account resources`);
    assert.equal(response.body.success, true);
    assert.ok(Array.isArray(response.body.result));
    assert.ok(!response.body.result.some(resource => (resource.name ?? resource.title) === name), `${label} named ${name} still exists`);
    const pages = response.body.result_info?.total_pages;
    if (pages !== undefined ? page >= pages : response.body.result.length < 50) return;
  }
}
function repoAbsent(repo) {
  // Full repo scope and authenticated ownership are checked before any creation.
  const repos = gh(['api', '--paginate', 'user/repos?affiliation=owner&per_page=100',
    '--jq', '.[].full_name']).trim().split('\n');
  assert.ok(!repos.includes(repo), `Repository ${repo} already exists or was not deleted`);
}
async function cli(phase, args) {
  const log = path.join(output, `${phase}.log`);
  console.log(`${phase}: node dist/index.js ${args.join(' ')} (log: ${log})`);
  const fd = fs.openSync(log, 'w', 0o600);
  try {
    await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [binary, ...args], {
        cwd: parent, env: process.env, stdio: ['ignore', fd, fd], timeout: 45 * 60 * 1000,
      });
      child.on('error', reject);
      child.on('exit', (code, signal) => code === 0 ? resolve() :
        reject(new Error(`${phase} failed (exit ${code}, signal ${signal}); inspect ${log}`)));
    });
    results.push({ phase, passed: true, log });
    console.log(`${phase}: passed`);
  } catch (error) {
    results.push({ phase, passed: false, log });
    throw error;
  } finally {
    fs.closeSync(fd);
  }
}
function state() {
  return JSON.parse(fs.readFileSync(stateFile, 'utf8'));
}

let failure;
let started = false;
try {
  assert.ok(account && token, 'Export CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN');
  assert.ok(fs.existsSync(binary), 'Build the CLI first');
  assert.ok(!fs.existsSync(target), `Refusing to reuse existing directory: ${target}`);
  const identity = gh(['api', '--include', 'user']);
  const scopes = identity.match(/^x-oauth-scopes:\s*([^\r\n]*)/im)?.[1]?.split(',').map(value => value.trim());
  assert.ok(scopes?.includes('repo') && scopes.includes('delete_repo'),
    'Live lifecycle testing requires GitHub repo and delete_repo scopes');
  const owner = JSON.parse(identity.slice(identity.indexOf('{'))).login;
  const repo = `${owner}/${name}`;
  repoAbsent(repo);
  await absent('Worker', `/workers/scripts/${encodeURIComponent(name)}`, 10007);
  await absent('R2', `/r2/buckets/${encodeURIComponent(name)}`, 10006);
  await noNamedResources('/d1/database', 'D1');
  await noNamedResources('/storage/kv/namespaces', 'KV');
  console.log(`Preflight passed: ${name} has no pre-existing local or remote resources.`);
  started = true;
  try {
    // Only select a project name and accept defaults: no custom domain or integrations.
    await cli('create', ['create', name, '--yes']);
    const current = state();
    const config = current.config;
    assert.equal(config.paymentProvider, 'none');
    assert.equal(config.domain, '');
    assert.ok(!config.emailSending && !config.emailForwardTo && !config.emailTestTo);
    assert.ok(!config.waffoStoreId && !config.waffoWebhookId);
    assert.ok(config.d1DatabaseId && config.kvNamespaceId);
    assert.ok(current.completedSteps.includes('verify-final-deployment'));
    assert.equal(config.githubDeployment?.conclusion, 'success');
    assert.equal(config.githubDeployment?.headSha, config.initialCommitSha);
    assert.ok(!config.cloudflareApiToken && !config.waffoPrivateKey, 'Credentials must not be persisted');
    const response = await fetch(config.deploymentUrl, { signal: AbortSignal.timeout(30000) });
    assert.ok(response.ok, `Live website returned HTTP ${response.status}`);
    results.push({ phase: 'verify-create', passed: true });
  } catch (error) {
    failure = error;
  } finally {
    if (fs.existsSync(stateFile)) {
      try { await cli('delete', ['delete', name]); }
      catch (error) { failure ||= error; }
    }
  }
  // Verify absence even if creation or cleanup failed; never rely solely on exit 0.
  await absent('Worker', `/workers/scripts/${encodeURIComponent(name)}`, 10007);
  await absent('R2', `/r2/buckets/${encodeURIComponent(name)}`, 10006);
  await noNamedResources('/d1/database', 'D1');
  await noNamedResources('/storage/kv/namespaces', 'KV');
  repoAbsent(repo);
  const domains = await cf(`/workers/domains?service=${encodeURIComponent(name)}`);
  assert.equal(domains.status, 200);
  assert.ok(!domains.body.result.some(domain => domain.service === name), 'Worker domain binding remains');
  results.push({ phase: 'verify-delete', passed: true });
  console.log('Remote verification passed: Worker, D1, R2, KV, custom domains, and repository absent.');
  // A second deletion verifies idempotent cleanup using the same saved state.
  if (fs.existsSync(stateFile)) await cli('delete-again', ['delete', name]);
} catch (error) {
  failure ||= error;
} finally {
  const report = path.join(output, 'result.json');
  fs.writeFileSync(report, JSON.stringify({ project: name, started, passed: !failure,
    results, error: failure?.message, localDirectoryKept: fs.existsSync(target) }, null, 2), { mode: 0o600 });
  console.log(`Lifecycle result: ${failure ? 'FAILED' : 'PASSED'}; report: ${report}`);
}
if (failure) {
  console.error(failure.message);
  process.exitCode = 1;
}
