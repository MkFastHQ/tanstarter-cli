import crypto from 'node:crypto';

import { WAFFO_API_BASE_URL, WAFFO_DOCS_URL } from './constants.js';
import type {
  RuntimeConfig,
  WaffoBillingPeriod,
  WaffoProductIds,
  WaffoProductSlot,
  WaffoProductType,
} from './types.js';

/**
 * Events handled by the Waffo route in the generated template.
 * Keep this list in sync with the template's webhook handler.
 */
export const WAFFO_WEBHOOK_EVENTS = [
  'order.completed',
  'subscription.activated',
  'subscription.payment_succeeded',
  'subscription.updated',
  'subscription.canceling',
  'subscription.uncanceled',
  'subscription.canceled',
  'subscription.past_due',
  'refund.succeeded',
  'refund.failed',
];

const PKCS8_PRIVATE_KEY_HEADER = '-----BEGIN PRIVATE KEY-----';
const PKCS8_PRIVATE_KEY_FOOTER = '-----END PRIVATE KEY-----';
const PKCS1_PRIVATE_KEY_HEADER = '-----BEGIN RSA PRIVATE KEY-----';
const PKCS1_PRIVATE_KEY_FOOTER = '-----END RSA PRIVATE KEY-----';

/**
 * The three paid prices shipped by the TanStarter template.
 * Keep these values synchronized with template/src/config/website.ts.
 */
export interface WaffoProductInput {
  slot: WaffoProductSlot;
  name: string;
  price: string;
  type: WaffoProductType;
  billingPeriod?: WaffoBillingPeriod;
}

export const WAFFO_TEMPLATE_PRODUCTS: readonly WaffoProductInput[] = [
  {
    slot: 'proMonthly',
    name: 'Pro Monthly',
    price: '9.90',
    type: 'subscription',
    billingPeriod: 'monthly',
  },
  {
    slot: 'proYearly',
    name: 'Pro Yearly',
    price: '99.00',
    type: 'subscription',
    billingPeriod: 'yearly',
  },
  {
    slot: 'lifetime',
    name: 'Lifetime',
    price: '199.00',
    type: 'onetime',
  },
];

export function waffoStoreNameForProject(projectName: string): string {
  const name = projectName.trim();
  if (!name) return '';
  return name.slice(0, 48).replace(/-+$/, '') || name.slice(0, 48);
}

const WAFFO_MAX_ATTEMPTS = 3;
const WAFFO_RETRY_DELAYS_MS = [5_000, 10_000];
const WAFFO_REQUEST_TIMEOUT_MS = 30_000;

export class WaffoApiError extends Error {
  readonly status: number;
  readonly path: string;

  constructor(status: number, path: string, message: string) {
    super(message);
    this.name = 'WaffoApiError';
    this.status = status;
    this.path = path;
  }
}

interface WaffoEnvelope<T> {
  data?: T | null;
  errors?: Array<{ message?: string } | string>;
  warnings?: Array<{ message?: string } | string>;
}

export function requireWaffoCredentials(config: RuntimeConfig): void {
  if (!config.waffoMerchantId || !config.waffoPrivateKey) {
    throw new Error(
      [
        'WAFFO_MERCHANT_ID and WAFFO_PRIVATE_KEY are required for Waffo payment setup.',
        `Waffo API key setup docs: ${WAFFO_DOCS_URL}`,
        'Export both variables and rerun TanStarter with --resume.',
      ].join('\n')
    );
  }
}

/**
 * Convert a PEM value for a dotenv file. A pasted key with real line breaks
 * becomes a single-line value containing literal `\\n` sequences.
 */
export function normalizePemForEnv(value: string): string {
  if (!/[\r\n]/.test(value)) return value;
  return value.replace(/\r\n/g, '\\n').replace(/\n/g, '\\n');
}

/**
 * Normalize Waffo private-key values for Node crypto.
 *
 * Waffo may provide a normal PEM, a PEM with literal `\\n` sequences, or raw
 * Base64 key material without PEM headers. The latter is wrapped as PKCS#8 at
 * signing time so setup can accept the value without an eager format check.
 */
export function normalizePemForCrypto(value: string): string {
  let key = value.replace(/\\n/g, '\n').replace(/\r\n/g, '\n').trim();
  const hasPkcs8Header = key.includes(PKCS8_PRIVATE_KEY_HEADER);
  const hasPkcs1Header = key.includes(PKCS1_PRIVATE_KEY_HEADER);

  if (hasPkcs8Header || hasPkcs1Header) {
    const base64 = key
      .replace(/-----BEGIN (?:RSA )?PRIVATE KEY-----/g, '')
      .replace(/-----END (?:RSA )?PRIVATE KEY-----/g, '')
      .replace(/\s+/g, '');
    const header = hasPkcs1Header
      ? PKCS1_PRIVATE_KEY_HEADER
      : PKCS8_PRIVATE_KEY_HEADER;
    const footer = hasPkcs1Header
      ? PKCS1_PRIVATE_KEY_FOOTER
      : PKCS8_PRIVATE_KEY_FOOTER;
    return `${header}\n${wrapBase64(base64)}\n${footer}`;
  }

  const base64 = key.replace(/\s+/g, '');
  if (/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) {
    return `${PKCS8_PRIVATE_KEY_HEADER}\n${wrapBase64(base64)}\n${PKCS8_PRIVATE_KEY_FOOTER}`;
  }

  return key;
}

function wrapBase64(value: string): string {
  return value.match(/.{1,64}/g)?.join('\n') ?? value;
}

export function formatWaffoPrice(input: string): string {
  const value = input.trim();
  if (!/^\d+(\.\d{1,2})?$/.test(value)) {
    throw new Error(
      'Price must be a positive number with up to 2 decimals, e.g. 29.90'
    );
  }
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error(
      'Price must be a positive number with up to 2 decimals, e.g. 29.90'
    );
  }
  return amount.toFixed(2);
}

export function buildWaffoWebhookUrl(publicBaseUrl: string): string {
  const baseUrl = publicBaseUrl.trim().replace(/\/+$/, '');
  if (!/^https:\/\//i.test(baseUrl)) {
    throw new Error(
      `Waffo webhook URL must use HTTPS. Received public URL: ${publicBaseUrl}`
    );
  }
  return `${baseUrl}/api/webhooks/waffo`;
}

export function buildWaffoCanonicalRequest(
  method: string,
  path: string,
  timestamp: string,
  body: unknown
): { bodyJson: string; canonicalRequest: string } {
  const bodyJson = JSON.stringify(body);
  const bodyHash = crypto
    .createHash('sha256')
    .update(bodyJson, 'utf8')
    .digest('base64');
  return {
    bodyJson,
    canonicalRequest: `${method}\n${path}\n${timestamp}\n${bodyHash}`,
  };
}

export function signWaffoRequest(
  config: RuntimeConfig,
  method: string,
  path: string,
  body: unknown
): { timestamp: string; signature: string; bodyJson: string } {
  requireWaffoCredentials(config);
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const { bodyJson, canonicalRequest } = buildWaffoCanonicalRequest(
    method,
    path,
    timestamp,
    body
  );
  const signature = crypto
    .sign(
      'sha256',
      Buffer.from(canonicalRequest, 'utf8'),
      normalizePemForCrypto(config.waffoPrivateKey)
    )
    .toString('base64');

  return { timestamp, signature, bodyJson };
}

async function waffoRequest<T>(
  config: RuntimeConfig,
  method: 'POST',
  path: string,
  body: unknown
): Promise<T> {
  const { timestamp, signature, bodyJson } = signWaffoRequest(
    config,
    method,
    path,
    body
  );
  const idempotencyKey = buildWaffoIdempotencyKey(config, method, path, body);

  for (let attempt = 1; attempt <= WAFFO_MAX_ATTEMPTS; attempt++) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(
        () => controller.abort(),
        WAFFO_REQUEST_TIMEOUT_MS
      );
      let response: Response;
      try {
        response = await fetch(`${WAFFO_API_BASE_URL}${path}`, {
          method,
          headers: {
            'Content-Type': 'application/json',
            'X-Merchant-Id': config.waffoMerchantId,
            'X-Timestamp': timestamp,
            'X-Signature': signature,
            'X-Idempotency-Key': idempotencyKey,
          },
          body: bodyJson,
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeout);
      }

      const text = await response.text();
      const envelope = parseWaffoEnvelope<T>(text, response.status, path);
      const errorMessage = getWaffoNoticeMessage(envelope.errors);
      if (!response.ok || errorMessage) {
        const error = new WaffoApiError(
          response.status,
          path,
          errorMessage ||
            `Waffo API ${method} ${path} failed (${response.status})`
        );
        if (isRetryableWaffoError(error) && attempt < WAFFO_MAX_ATTEMPTS) {
          await waitBeforeRetry(path, attempt);
          continue;
        }
        throw error;
      }

      return (envelope.data ?? {}) as T;
    } catch (error) {
      if (isRetryableWaffoError(error) && attempt < WAFFO_MAX_ATTEMPTS) {
        await waitBeforeRetry(path, attempt);
        continue;
      }
      if (error instanceof WaffoApiError) throw error;
      throw new WaffoApiError(
        0,
        path,
        `Waffo API ${method} ${path} request failed: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  throw new WaffoApiError(0, path, `Waffo API ${method} ${path} failed.`);
}

function parseWaffoEnvelope<T>(
  text: string,
  status: number,
  path: string
): WaffoEnvelope<T> {
  if (!text) return {};
  try {
    return JSON.parse(text) as WaffoEnvelope<T>;
  } catch {
    throw new WaffoApiError(
      status,
      path,
      `Waffo API returned invalid JSON for ${path}: ${text.slice(0, 500)}`
    );
  }
}

function getWaffoNoticeMessage(
  notices: WaffoEnvelope<unknown>['errors']
): string {
  if (!notices?.length) return '';
  return notices
    .map((notice) =>
      typeof notice === 'string' ? notice : notice.message ?? JSON.stringify(notice)
    )
    .filter(Boolean)
    .join('; ');
}

function buildWaffoIdempotencyKey(
  config: RuntimeConfig,
  method: string,
  path: string,
  body: unknown
): string {
  return crypto
    .createHash('sha256')
    .update(
      JSON.stringify({
        setupId: config.waffoSetupId || config.projectName,
        merchantId: config.waffoMerchantId,
        method,
        path,
        body,
      }),
      'utf8'
    )
    .digest('hex');
}

function isRetryableWaffoError(error: unknown): boolean {
  return (
    !(error instanceof WaffoApiError) ||
    error.status === 0 ||
    error.status === 429 ||
    error.status >= 500
  );
}

async function waitBeforeRetry(path: string, attempt: number): Promise<void> {
  const delay = WAFFO_RETRY_DELAYS_MS[attempt - 1] ?? 10_000;
  console.warn(
    `Waffo request ${path} failed transiently; retrying in ${delay / 1000}s (${attempt + 1}/${WAFFO_MAX_ATTEMPTS}).`
  );
  await new Promise((resolve) => setTimeout(resolve, delay));
}

export async function createWaffoStore(
  config: RuntimeConfig,
  name: string
): Promise<string> {
  const storeName = name.trim();
  if (!storeName || storeName.length > 48) {
    throw new Error('Waffo store name must be between 1 and 48 characters.');
  }
  const result = await waffoRequest<{
    store?: { id?: string };
  }>(
    config,
    'POST',
    '/v1/actions/store/create-store',
    { name: storeName }
  );
  return requireWaffoId(result.store?.id, 'store');
}

export async function createWaffoProduct(
  config: RuntimeConfig,
  product: WaffoProductInput
): Promise<string> {
  if (!config.waffoStoreId) {
    throw new Error('Waffo store ID is missing; create the store first.');
  }
  const name = product.name.trim();
  if (!name) throw new Error('Waffo product name is required.');
  if (name.length > 64) {
    throw new Error('Waffo product name must be at most 64 characters.');
  }
  const prices = {
    USD: {
      amount: formatWaffoPrice(product.price),
      taxIncluded: false,
      taxCategory: 'saas',
    },
  };

  if (product.type === 'onetime') {
    const result = await waffoRequest<{ product?: { id?: string } }>(
      config,
      'POST',
      '/v1/actions/onetime-product/create-product',
      { storeId: config.waffoStoreId, name, prices }
    );
    return requireWaffoId(result.product?.id, 'product');
  }

  const result = await waffoRequest<{ product?: { id?: string } }>(
    config,
    'POST',
    '/v1/actions/subscription-product/create-product',
    {
      storeId: config.waffoStoreId,
      name,
      billingPeriod: product.billingPeriod ?? 'monthly',
      prices,
    }
  );
  return requireWaffoId(result.product?.id, 'product');
}

export async function addWaffoWebhook(
  config: RuntimeConfig,
  storeId: string,
  publicBaseUrl: string
): Promise<string> {
  const webhookUrl = buildWaffoWebhookUrl(publicBaseUrl);
  const result = await waffoRequest<{ webhook?: { id?: string } }>(
    config,
    'POST',
    '/v1/actions/store/add-webhook',
    {
      storeId,
      channel: 'http',
      url: webhookUrl,
      events: WAFFO_WEBHOOK_EVENTS,
      testMode: true,
    }
  );
  return requireWaffoId(result.webhook?.id, 'webhook');
}

/**
 * Verify the deployed route before registering it with Waffo. The generated
 * route intentionally returns 400 for an empty unsigned webhook request;
 * that is the expected proof that the Waffo provider is enabled, the route is
 * live, and signature validation is active. A 200 would mean payment is
 * disabled in the deployed build and must not be registered with Waffo.
 */
export async function verifyWaffoWebhookEndpoint(
  publicBaseUrl: string
): Promise<void> {
  const url = buildWaffoWebhookUrl(publicBaseUrl);
  let lastFailure = '';

  for (let attempt = 1; attempt <= 3; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      WAFFO_REQUEST_TIMEOUT_MS
    );
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '',
        signal: controller.signal,
      });
      if (response.status === 400) return;
      lastFailure = `HTTP ${response.status}`;
    } catch (error) {
      lastFailure = error instanceof Error ? error.message : String(error);
    } finally {
      clearTimeout(timeout);
    }

    if (attempt < 3) {
      await new Promise((resolve) => setTimeout(resolve, [2_000, 5_000][attempt - 1]));
    }
  }

  throw new Error(
    [
      `The deployed Waffo webhook endpoint is not reachable: ${url} (${lastFailure}).`,
      'Check the domain DNS/Cloudflare custom-domain status, then rerun with --resume.',
    ].join('\n')
  );
}

function requireWaffoId(value: string | undefined, label: string): string {
  if (!value) throw new Error(`Waffo API response did not include a ${label} ID.`);
  return value;
}
