# TanStarter CLI

English | [简体中文](README.zh-CN.md)

Create a production-ready TanStarter app from the template and deploy it to Cloudflare Workers in about 10 minutes.

## Quick Start

```bash
export CLOUDFLARE_ACCOUNT_ID="..."
export CLOUDFLARE_API_TOKEN="..."

# Optional: enable Waffo payments during setup
export WAFFO_MERCHANT_ID="MER_..."
export WAFFO_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----..."

npx tanstarter-cli@latest create
```

TanStarter CLI will ask for the project name, resource names, and payment method before creating anything. When you pick Waffo, it also creates a Waffo store, the three template products, and the webhook automatically.

To keep the payment prompt but accept every other default (domain, D1/R2/KV names, GitHub repository, and final confirmation), pass `--yes`:

```bash
npx tanstarter-cli@latest create my-app --yes
```

## Install

### Agent skill

Install the TanStarter creation skill for Codex, Claude Code, or another supported agent:

```bash
npx skills add MkFastHQ/tanstarter-cli --skill tanstarter-create
```

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
tanstarter delete <project-name> [options]
tanstarter create <project-name> --resume
```

Options:

- `--domain <domain>`: configure a Cloudflare custom domain route.
- `--email-sending`: onboard `--domain` for Cloudflare Email Sending and configure the application's mail provider and addresses (optional).
- `--email-test-to <email>`: explicitly request one provider test email after deployment (requires Email Sending). Inbox receipt remains a manual check.
- `--payment <none|waffo>`: payment method for the generated project. With `waffo`, the CLI uses the template's built-in monthly, yearly, and lifetime products, then creates the Waffo store, products, and webhook during setup.
- `-y, --yes`: accept default domain, resource names, GitHub repository, and final confirmation. It still asks for payment unless `--payment` is set.
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

- Node.js matching the current template: `^22.23.0 || ^24.22.0 || >=26.12.0`.
- A Cloudflare account with `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` available in your shell environment.
- A GitHub account authenticated with GitHub CLI.
- (Waffo only) Create a Test API Key in the Waffo dashboard (API & Development → API Keys). Use the `MER_...` merchant ID as `WAFFO_MERCHANT_ID` and the private key value provided by Waffo as `WAFFO_PRIVATE_KEY`; the CLI passes that value through unchanged. The CLI always uses Waffo test mode and falls back to the deployed `workers.dev` URL when no custom domain is supplied.

The CLI checks for `node`, `pnpm`, `git`, `gh`, GitHub CLI auth, and Cloudflare credentials. If `pnpm`, `git`, or `gh` is missing, the CLI attempts to install it with the available system package manager before continuing.

The CLI uses the template's local Cloudflare CLI dependency through `pnpm exec cf`; no global installation is required. Configuration edits preserve the template's imports, exported environment-key lists, secret declarations, and unrelated Worker settings. Older generated projects must migrate their configuration with `cf migrate` and update their template scripts/dependencies before using this CLI to resume or delete resources.

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
6. Updates `cloudflare.config.ts` (Worker name, domains, and DB/BUCKET/CACHE bindings) and writes `.env`/`.env.production`.
7. Runs database migrations.
8. Builds and deploys locally.
9. Syncs Worker secrets.
10. Verifies the public deployment URL.
11. (Waffo only) Registers the webhook after the deployed route is reachable.
12. Creates a GitHub repository.
13. Syncs GitHub Actions secrets.
14. Commits and pushes to `main`.
15. Confirms the `deploy.yml` push workflow for that initialization commit SHA and prints its run URL. A failed run stops setup; resume after fixing and rerunning it. A missing/disabled workflow or a long-running deployment times out after approximately 20 minutes plus query time.
16. Checks the public URL again after GitHub deployment, then prints a feature acceptance report. Optional forwarding and an explicitly requested test email run before the report.

The report distinguishes completed checks, configured resources, failures, and manual tasks. HTTP success does not prove authentication, inbox receipt, uploads, or payments work. It uses static website configuration without executing project code or reading secret values. Dynamic settings are listed for manual verification. Follow the report to test enabled login methods, email, storage, newsletter/notifications, Waffo sandbox checkout, and admin access. This CLI remains focused on initialization; later deployments use the generated repository's existing workflow.

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

## Cloudflare Email Sending domain setup

With Cloudflare DNS and a Workers Paid plan, opt in to automatic domain onboarding:

```bash
npx tanstarter-cli@latest create my-app --domain example.com --email-sending
```

Interactive setup also asks after choosing a custom domain; the default is to skip. After Cloudflare authentication, the CLI runs the commands below to add sending DNS records and display settings. Fix failures and continue with `--resume`. The token needs Email Sending Edit, Zone Read, and DNS Edit permissions scoped to the domain. The CLI sets `websiteConfig.mail.enable=true` and `provider='cloudflare'`. Empty or template-default sender/support addresses become `<project-name> <support@<domain>>`; custom sender addresses must match the onboarded domain, and custom support addresses are preserved. Unsupported dynamic mail configuration requires manual adjustment. Resuming an older initialization that gains this configuration step redeploys and pushes the changed mail settings. Project deletion preserves domain email configuration. Inbound routing is separate.

```bash
pnpm exec cf email-sending subdomains create --zone <zone-id> --name example.com
# Use the returned tag as <subdomain-id>:
pnpm exec cf email-sending subdomains dns fix <subdomain-id> --zone <zone-id>
pnpm exec cf email-sending subdomains dns get <subdomain-id> --zone <zone-id>
pnpm exec cf email-sending subdomains dns status <subdomain-id> --zone <zone-id>
```

The CLI resolves the containing zone and reuses an existing enabled sending domain on resume before repairing and inspecting its DNS. Sending subdomains are supported. A disabled sending domain requires manual review.

### Optional test sending

```bash
tanstarter create my-app --domain example.com --email-sending --email-test-to you@example.net
# Explicitly request another send from the parent directory:
tanstarter create my-app --resume --email-test-to you@example.net
```

Only `--email-test-to` requests a send; forwarding alone never sends a test message. The test uses the configured sender and the Cloudflare REST API directly, so the token also needs Email Send permission. It does not test the deployed application's runtime credentials, templates, or signup/reset flow. The report distinguishes provider-reported delivery, queued messages, rejection/bounce, and an unknown outcome. Confirm actual receipt, spam placement, registration verification and password reset yourself. The attempt is saved before the request; a timeout, interruption, or plain `--resume` never automatically resends it. Pass `--email-test-to` explicitly to try again. A test failure is reported without undoing initialization.

### Optional inbound forwarding

```bash
npx tanstarter-cli@latest create my-app --domain example.com --email-forward-to you@gmail.com
```

Forward `support@<domain>` to the specified mailbox. Automatic inbound setup currently requires the zone apex domain (for example, `example.com`); configure subdomain routing manually. Verify the destination in Cloudflare first. The token needs Email Routing Rules Edit, Email Routing Settings Edit, Zone Read, and DNS Edit permissions covering the domain. This runs last, after creation, deployment, and GitHub initialization. Failure only warns and does not fail initialization; retry unfinished forwarding with `create my-app --resume`. Identical rules are reused; conflicting or disabled rules are not overwritten. The CLI does not register unverified addresses or send verification emails. Combine with `--email-sending` if desired; deleting the project preserves email configuration.
