# Template compatibility check — 2026-10-03

> Historical verification of the commits below, before the template's Cloudflare CLI migration. It does not validate the current template or the new email setup. Function names, prerequisites, and test counts below describe that older snapshot.

CLI: `1.3.6`, commit `790af21adc577d88b02e29adee0aea9e39f4dd47`.
Template: remote `MkFastHQ/mkfast-template` main at
`4dd4deaf646e15be0fd2e164c415e656f00a720a`.
Runtime: macOS, Node `22.22.3`, pnpm `10.30.3`.

## Results

- CLI: 59 tests passed; `pnpm check`, `pnpm build`, help/version entrypoints,
  and `npm pack --dry-run` passed.
- Fresh remote template clone: frozen-lockfile dependency installation passed.
- Applied the built CLI's actual `initializeGit`, `writeWranglerConfig`,
  `ensureEnvFiles`, and `updatePackageName` functions to an isolated temporary
  clone with synthetic Cloudflare IDs and credentials.
- Template `cf-typegen` and all six local D1 migrations passed.
- Payment disabled: client/Worker production build passed. Template unit tests
  passed (16 files, 132 tests) after locale generation during the build.
- Built Worker served locally through `vite preview`: English and Chinese
  homepages, login page, anonymous auth session, robots, and sitemap returned
  HTTP 200. Disabled-payment Waffo webhook returned HTTP 200 acknowledgement.
- Waffo enabled with a generated RSA key and synthetic merchant/product IDs:
  second production build passed; homepage returned HTTP 200 and the webhook
  returned HTTP 400 for missing payload/signature. Synthetic product IDs were
  included in the compiled bundles. The CLI's public webhook verifier requires
  HTTPS, so the local HTTP smoke checks used direct requests instead.
- Source compatibility: CLI script names, DB/BUCKET/CACHE bindings, migration
  directory, GitHub secret sync `--repo` argument, Waffo product environment
  names, prices ($9.90/month, $99/year, $199 lifetime), and current webhook
  event registration remain aligned with the template.

## Fresh-clone test prerequisite

Running template `pnpm test` immediately after installation failed in seven
test files because `src/locale/paraglide/runtime` had not been generated.
After production build generated the locale runtime, all 132 tests passed.
This does not block CLI creation: its deployment build generates the runtime.
For independent template checks, run `pnpm locale:compile` before `pnpm test`.

## Repeat locally after template updates

Use a disposable clone of the remote template, and apply the CLI configuration
helpers with dummy resource IDs. Never reuse production env files for this
check. Exercise both `paymentProvider: 'none'` and `'waffo'`; for Waffo use a
locally generated RSA private key and synthetic merchant/product IDs.

```sh
# CLI repository
pnpm test
pnpm check
pnpm build
npm pack --dry-run

# Disposable template clone, after applying CLI configuration helpers
pnpm install --frozen-lockfile
pnpm cf-typegen
pnpm db:migrate:local
pnpm locale:compile
pnpm test
pnpm build
pnpm exec vite preview --host 127.0.0.1 --port 3187 --strictPort
```

Check `/`, `/zh/`, `/auth/login`, `/api/auth/get-session`, `/robots.txt`,
and `/sitemap.xml`. POST an empty request to `/api/webhooks/waffo`: expect
200 with payments disabled and 400 for missing payload/signature with Waffo
enabled.

## Evidence boundaries

This check covers local configuration, installation, migrations, builds,
unit tests, and HTTP smoke checks against the built Worker. It does not certify
remote provisioning/deletion, remote migrations, deployment, domain
propagation, Worker/GitHub secret writes, repository creation/push, or actual
Waffo checkout/webhook delivery. No online resources were created or changed.
It also does not cover browser interaction E2E or the Node 20/Windows matrix.

Temporary build and test logs for this run are under
`/tmp/tanstarter-compat-WGOWgx/`; these are transient local evidence.
