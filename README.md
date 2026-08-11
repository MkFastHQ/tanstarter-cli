# TanStarter CLI

English | [简体中文](README.zh-CN.md)

Create a production-ready TanStarter app from the template and deploy it to Cloudflare Workers in about 10 minutes.

## Quick Start

This repository is used from source, not from npm. Build it and link it once:

```bash
git clone https://github.com/akfc58/tanstarter-cli.git
cd tanstarter-cli
pnpm install
pnpm build
npm link
```

Then go to the directory where you want the new project to live and run:

```bash
export CLOUDFLARE_ACCOUNT_ID="..."
export CLOUDFLARE_API_TOKEN="..."


# Optional: enable Waffo payments during setup
export WAFFO_MERCHANT_ID="MER_..."
export WAFFO_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----..."

npx tanstarter-cli@latest create
```

TanStarter CLI will ask for the project name, resource names, and payment method before creating anything. When you pick Waffo, it also creates a Waffo store, the three template products, and the webhook automatically.


## Install

### Global command (recommended)

`npm link` symlinks `dist/index.js` into your npm global bin, so `tanstarter` is available everywhere:

```bash
pnpm build
npm link

tanstarter --version
```

After changing anything under `src/`, run `pnpm build` again. The linked command points at `dist/`, so it picks up the new build without relinking.

To remove the link:

```bash
npm unlink -g tanstarter-cli
```

`pnpm link --global` works too, but it fails with `ERR_PNPM_NO_GLOBAL_BIN_DIR` until you have run `pnpm setup` once.

### Run from source

Skip the build step while iterating on the CLI itself:

```bash
pnpm dev create
pnpm dev --help
```

`pnpm dev` runs `tsx src/index.ts`. Do not insert `--` before the flags: `pnpm dev -- --help` passes `--` through to the CLI and fails with `Unknown option: --`.

### Run the build output directly

```bash
pnpm build
node /path/to/tanstarter-cli/dist/index.js create
```

## Commands

```bash
tanstarter create [options]
tanstarter delete <project-name> [options]
tanstarter create <project-name> --resume
```

Options:

- `--domain <domain>`: configure a Cloudflare custom domain route.
- `--payment <none|waffo>`: payment method for the generated project. With `waffo`, the CLI uses the template's built-in monthly, yearly, and lifetime products, then creates the Waffo store, products, and webhook during setup.
- `--repo <owner/name>`: create this GitHub repository. If omitted, TanStarter CLI defaults to the current GitHub CLI login and project name, for example `open-fox/my-app`.
- `--resume`: continue a failed setup from `.tanstarter/state.json`.
- `-h, --help`: show help.
- `-v, --version`: show version.

Example:

```bash
tanstarter create --domain app.example.com --repo mkfasthq/my-app
```

If a run fails after the project directory is created, fix the issue and run:

```bash
tanstarter create my-app --resume
```

To delete the Cloudflare and GitHub resources created by the CLI, run:

```bash
tanstarter delete my-app
```

## Prerequisites

- Node.js 20 or later.
- pnpm, to install dependencies and build this repository.
- A Cloudflare account with `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` available in your shell environment.
- A GitHub account authenticated with GitHub CLI.
- (Waffo only) Create a Test API Key in the Waffo dashboard (API & Development → API Keys). Use the `MER_...` merchant ID as `WAFFO_MERCHANT_ID` and the private key value provided by Waffo as `WAFFO_PRIVATE_KEY`; the CLI passes that value through unchanged. The CLI always uses Waffo test mode and falls back to the deployed `workers.dev` URL when no custom domain is supplied.

The CLI checks for `node`, `pnpm`, `git`, `gh`, GitHub CLI auth, and Cloudflare credentials. If `pnpm`, `git`, or `gh` is missing, the CLI attempts to install it with the available system package manager before continuing.

### Non-interactive Waffo setup

When running without a TTY, pass `--payment waffo`. No store/product fields or extra Waffo environment variables are required; the CLI uses the template's built-in pricing. `--domain` is optional:

```bash
npx tanstarter-cli@latest create my-app --payment waffo
```

The CLI creates a project-named store and three products matching the template: Pro Monthly at `$9.90`, Pro Yearly at `$99.00`, and Lifetime at `$199.00`. Their IDs are written to `VITE_WAFFO_PRODUCT_PRO_MONTHLY`, `VITE_WAFFO_PRODUCT_PRO_YEARLY`, and `VITE_WAFFO_PRODUCT_LIFETIME`, then the site is deployed, Worker secrets are synchronized, the public URL is verified, and `https://<domain>/api/webhooks/waffo` (or the deployed `workers.dev` equivalent) is registered. The deployed Worker keeps `WAFFO_DEBUG=true`, so the online site uses Waffo test payments.

The CLI always provisions Waffo in test mode. Live product publishing is outside this setup flow.

Waffo may still require merchant verification, business details, or payout setup in its dashboard.

## What It Does

The setup flow:

1. Clones the TanStarter template and preserves its Git history.
2. Installs dependencies with `pnpm install`.
3. Verifies Cloudflare authentication.
4. (Waffo only) Creates the Waffo store and three template products.
5. Creates Cloudflare D1, R2, and KV resources.
6. Updates `wrangler.jsonc` and writes `.env`/`.env.production`.
7. Runs database migrations.
8. Builds and deploys locally.
9. Syncs Worker secrets.
10. Verifies the public deployment URL.
11. (Waffo only) Registers the webhook after the deployed route is reachable.
12. Creates a GitHub repository.
13. Syncs GitHub Actions secrets.
14. Commits and pushes to `main`.

The generated repository uses `origin` for your new GitHub repository and
`upstream` for `https://github.com/MkFastHQ/mkfast-template.git`. Because the
template history is preserved, future template updates can use a normal Git
merge instead of reconstructing a common ancestor.

Environment variables from the template `.env.example` are copied from your shell into the generated `.env` and `.env.production` files when present. Generated Cloudflare, D1, KV, base URL, and auth secret values take precedence.

## Links:

- Website: [tanstarter.dev](https://tanstarter.dev)
- CLI documentation: [docs.tanstarter.dev/docs/cli](https://docs.tanstarter.dev/docs/cli)
- CLI video tutorial: [youtu.be/HVwilCX6YSA](https://youtu.be/HVwilCX6YSA)

## Support

If you have questions, contact [support@tanstarter.dev](mailto:support@tanstarter.dev) or join the [Discord community](https://mksaas.link/discord).

## License

MIT
