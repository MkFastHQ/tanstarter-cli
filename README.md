# TanStarter CLI

English | [简体中文](README.zh-CN.md)

Create a production-ready TanStarter app from the template and deploy it to Cloudflare Workers in about 10 minutes.

## Quick Start

```bash
export CLOUDFLARE_ACCOUNT_ID="..."
export CLOUDFLARE_API_TOKEN="..."

npx tanstarter-cli@latest create
```

TanStarter CLI will ask for the project name and resource names before creating anything.

## Install

Run without installing:

```bash
npx tanstarter-cli@latest create
```

Or install globally:

```bash
npm install -g tanstarter-cli
```

Then run:

```bash
tanstarter create
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
- A Cloudflare account with `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` available in your shell environment.
- A GitHub account authenticated with GitHub CLI.

The CLI checks for `node`, `pnpm`, `git`, `gh`, GitHub CLI auth, and Cloudflare credentials. If `pnpm`, `git`, or `gh` is missing, the CLI attempts to install it with the available system package manager before continuing.

## What It Does

The setup flow:

1. Clones the TanStarter template and preserves its Git history.
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
