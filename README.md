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

tanstarter create
```

TanStarter CLI creates the project directory under the current working directory, so run it from your projects folder, not from inside this repository. It will ask for the project name and resource names before creating anything.

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
tanstarter create <project-name> --resume
tanstarter delete <project-name> [options]
```

Options:

- `--domain <domain>`: configure a Cloudflare custom domain route.
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

The CLI checks for `node`, `pnpm`, `git`, `gh`, GitHub CLI auth, and Cloudflare credentials. If `pnpm`, `git`, or `gh` is missing, the CLI attempts to install it with the available system package manager before continuing.

## What It Does

The setup flow:

1. Clones the TanStarter template.
2. Installs dependencies with `pnpm install`.
3. Creates Cloudflare D1, R2, and KV resources.
4. Updates `wrangler.jsonc`.
5. Writes `.env` and `.env.production`.
6. Runs database migrations.
7. Builds and deploys locally.
8. Syncs Worker secrets.
9. Creates a GitHub repository.
10. Syncs GitHub Actions secrets.
11. Commits and pushes to `main`.

Environment variables from the template `.env.example` are copied from your shell into the generated `.env` and `.env.production` files when present. Generated Cloudflare, D1, KV, base URL, and auth secret values take precedence.

## Links:

- Website: [tanstarter.dev](https://tanstarter.dev)
- CLI documentation: [docs.tanstarter.dev/docs/cli](https://docs.tanstarter.dev/docs/cli)
- CLI video tutorial: [youtu.be/HVwilCX6YSA](https://youtu.be/HVwilCX6YSA)

## Support

If you have questions, contact [support@tanstarter.dev](mailto:support@tanstarter.dev) or join the [Discord community](https://mksaas.link/discord).

## License

MIT
