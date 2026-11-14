import type { EmailTestResult, RuntimeConfig } from './types.js';
import { emailAddress, readWebsiteSettings } from './website.js';

/** One explicitly requested send; never retry an ambiguous network outcome. */
export async function sendTestEmail(
  config: RuntimeConfig
): Promise<EmailTestResult> {
  const to = config.emailTestTo;
  if (!to || !emailAddress(to))
    throw new Error('--email-test-to must be an email address.');
  const mail = readWebsiteSettings(config.targetDir).mail;
  const from = typeof mail?.fromEmail === 'string' ? mail.fromEmail : '';
  const address = emailAddress(from);
  if (
    !config.emailSending ||
    mail?.enable !== true ||
    mail.provider !== 'cloudflare' ||
    !address ||
    address.split('@')[1]?.toLowerCase() !== config.domain.toLowerCase()
  ) {
    throw new Error(
      'Test sending requires Cloudflare mail configured on the onboarded domain.'
    );
  }
  const result: EmailTestResult = { to, from, status: 'unknown' };
  try {
    const response = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(config.cloudflareAccountId)}/email/sending/send`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${config.cloudflareApiToken}`,
          'Content-Type': 'application/json',
        },
        signal: AbortSignal.timeout(30_000),
        body: JSON.stringify({
          from,
          to,
          subject: 'TanStarter initialization email test',
          text: 'This test was requested during project initialization. Receiving it confirms delivery to this mailbox. Registration and password-reset flows still need separate verification.',
          html: '<p>This test was requested during project initialization.</p><p>Receiving it confirms delivery to this mailbox. Registration and password-reset flows still need separate verification.</p>',
        }),
      }
    );
    const body = (await response.json()) as {
      success?: boolean;
      result?: {
        delivered?: unknown[];
        queued?: unknown[];
        permanent_bounces?: unknown[];
      };
    };
    if (
      !response.ok ||
      body.success !== true ||
      (Array.isArray(body.result?.permanent_bounces) &&
        body.result.permanent_bounces.length > 0)
    )
      result.status = 'failed';
    else if (
      Array.isArray(body.result?.delivered) &&
      body.result.delivered.length > 0
    )
      result.status = 'accepted';
    else if (
      Array.isArray(body.result?.queued) &&
      body.result.queued.length > 0
    )
      result.status = 'queued';
  } catch {
    // A timeout may follow a successful send. Do not log request/response bodies,
    // credentials, or claim that an uncertain send definitely failed.
    result.status = 'unknown';
  }
  return result;
}
