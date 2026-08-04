import { CLOUDFLARE_DOCS_URL, WAFFO_DOCS_URL } from './constants.js';

export function requireEnv(key: string): string {
  const value = process.env[key]?.trim();
  if (!value) {
    if (key === 'CLOUDFLARE_ACCOUNT_ID' || key === 'CLOUDFLARE_API_TOKEN') {
      throw new Error(
        [
          `${key} is required in your environment.`,
          `Cloudflare setup docs: ${CLOUDFLARE_DOCS_URL}`,
          'After setup, export both CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN before running TanStarter again.',
        ].join('\n')
      );
    }
    if (key === 'WAFFO_MERCHANT_ID' || key === 'WAFFO_PRIVATE_KEY') {
      throw new Error(
        [
          `${key} is required in your environment when using Waffo payment.`,
          `Waffo API key setup docs: ${WAFFO_DOCS_URL}`,
          'After setup, export both WAFFO_MERCHANT_ID and WAFFO_PRIVATE_KEY before running TanStarter again.',
        ].join('\n')
      );
    }
    throw new Error(`${key} is required in your environment.`);
  }
  return value;
}

export function requireValue(args: string[], index: number, flag: string): string {
  const value = args[index];
  if (!value || value.startsWith('-')) {
    throw new Error(`${flag} requires a value.`);
  }
  return value;
}

export function maskSecret(value: string): string {
  if (value.length <= 8) return '********';
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

export function bufferToString(value: Buffer | string | null): string {
  if (typeof value === 'string') return value;
  return value ? value.toString('utf8') : '';
}
