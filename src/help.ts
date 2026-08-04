import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function printHelp(): void {
  console.log(`TanStarter CLI

Usage:
  tanstarter create [options]
  tanstarter delete <project-name> [options]

Options:
  --repo <owner/name>     Create or use this GitHub repo
  --domain <domain>       Cloudflare custom domain route
  --payment <none|waffo>  Payment method for the generated project
  --resume                Resume a failed setup with tanstarter create <project-name> --resume
  -h, --help              Show help
  -v, --version           Show version

Required environment:
  CLOUDFLARE_ACCOUNT_ID
  CLOUDFLARE_API_TOKEN

Required environment (when using --payment waffo):
  WAFFO_MERCHANT_ID
  WAFFO_PRIVATE_KEY`);
}

export function printVersion(): void {
  const packagePath = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '..',
    'package.json'
  );

  try {
    const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8')) as {
      version?: string;
    };
    console.log(pkg.version ?? '0.0.0');
  } catch {
    console.log('0.0.0');
  }
}
