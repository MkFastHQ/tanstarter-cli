import { getPublicBaseUrl } from './deployment.js';
import type { SetupState } from './types.js';
import { readWebsiteSettings, type WebsiteSettings } from './website.js';

export interface AcceptanceItem {
  status: 'verified' | 'configured' | 'pending' | 'failed';
  message: string;
}

/** Report only observed checks; configuration is not a functional test. */
export function buildAcceptanceReport(state: SetupState): AcceptanceItem[] {
  const { config, completedSteps } = state;
  const done = (step: string) => completedSteps.includes(step);
  const items: AcceptanceItem[] = [];
  const add = (status: AcceptanceItem['status'], message: string) =>
    items.push({ status, message });
  add(
    done('deploy') ? 'configured' : 'pending',
    'Cloudflare Worker deployment'
  );
  add(
    done('verify-final-deployment') ? 'verified' : 'pending',
    `Public URL after GitHub deployment: ${getPublicBaseUrl(config) || 'not detected'} (HTTP check only)`
  );
  if (config.domain)
    add(
      done('ensure-custom-domain') ? 'verified' : 'pending',
      `Custom-domain binding: ${config.domain}`
    );
  const github = config.githubDeployment;
  const matched = github && github.headSha === config.initialCommitSha;
  add(
    matched &&
      github.conclusion === 'success' &&
      done('verify-github-deployment')
      ? 'verified'
      : matched &&
          github.status === 'completed' &&
          github.conclusion !== 'success'
        ? 'failed'
        : 'pending',
    `Initialization commit GitHub Actions deployment${matched ? `: ${github.conclusion || github.status} ${github.url}` : ': not confirmed'}`
  );
  add(
    done('db-migrate-remote') ? 'verified' : 'pending',
    'Remote D1 migration command completed'
  );
  add(
    done('sync-worker-secrets') ? 'configured' : 'pending',
    'Worker secrets synchronized'
  );
  let website: WebsiteSettings;
  try {
    website = readWebsiteSettings(config.targetDir);
  } catch {
    add(
      'pending',
      'Could not statically inspect websiteConfig; verify enabled application features manually.'
    );
    return items;
  }
  const mail = website.mail;
  if (mail?.enable === true) {
    add(
      mail.provider && mail.fromEmail ? 'configured' : 'pending',
      `Application mail provider: ${String(mail.provider || 'not specified')}; sender: ${String(mail.fromEmail || 'not specified')}; support: ${String(mail.supportEmail || 'not specified')}`
    );
    if (
      typeof mail.fromEmail === 'string' &&
      mail.fromEmail.includes('support@tanstarter.dev')
    )
      add(
        'pending',
        'The sender is still the template default; configure your own verified sender before testing application email.'
      );
    if (config.emailSending)
      add(
        done('enable-email-sending') ? 'configured' : 'pending',
        `Cloudflare sending domain: ${config.domain}`
      );
    const test = config.emailTestResult;
    if (
      test &&
      test.from === mail.fromEmail &&
      test.to === config.emailTestTo
    ) {
      add(
        test.status === 'failed'
          ? 'failed'
          : test.status === 'unknown'
            ? 'pending'
            : 'verified',
        `Direct provider email test to ${test.to}: ${test.status === 'accepted' ? 'provider reported delivery; inbox receipt unconfirmed' : test.status === 'queued' ? 'provider queued the message; delivery unconfirmed' : test.status === 'failed' ? 'provider rejected the request or reported a permanent bounce' : 'outcome unknown; no automatic resend'}`
      );
      add(
        'pending',
        `Confirm actual receipt in ${test.to}, including spam. This direct API test does not verify the deployed application's email flow.`
      );
    } else {
      if (done('test-email'))
        add(
          'pending',
          'A provider test attempt was recorded without a current confirmed outcome. Inspect the inbox before explicitly requesting another send.'
        );
      add(
        'pending',
        config.emailSending
          ? `Request a provider send test with --resume --email-test-to <your-email>; then confirm inbox receipt.`
          : 'Verify the selected mail provider with a real test message and confirm inbox receipt.'
      );
    }
    add(
      'pending',
      `Verify actual support-mail reception at ${String(mail.supportEmail || 'the configured support address')}.`
    );
  } else if (!mail || mail.enable !== false)
    add(
      'pending',
      'Mail enable state is dynamic or absent; verify mail configuration manually.'
    );
  if (config.emailForwardTo)
    add(
      done('configure-email-forwarding') ? 'configured' : 'pending',
      `Inbound routing support@${config.domain} → ${config.emailForwardTo}; actual reception still needs verification`
    );
  const auth = website.auth;
  if (auth?.enable !== false) {
    if (auth?.enableGoogleLogin === true)
      add('pending', 'Complete a real Google login on the deployed site.');
    if (auth?.enableCredentialLogin === true)
      add(
        'pending',
        'Register with email, receive and follow the verification link, then test login and password reset.'
      );
    if (
      !auth ||
      (auth.enableGoogleLogin !== true && auth.enableCredentialLogin !== true)
    )
      add(
        'pending',
        'Verify the configured authentication methods on the deployed site.'
      );
    add(
      'pending',
      'After registering your account, run pnpm db:admin:remote <email> in the generated project; sign in again to verify admin access.'
    );
  }
  if (website.storage?.enable !== false) {
    add(
      done('create-r2') ? 'configured' : 'pending',
      'R2 storage provisioning'
    );
    add(
      'pending',
      'If storage is enabled, test authenticated upload, download, and deletion on the deployed site.'
    );
  }
  if (website.cache?.enable !== false)
    add(
      done('create-kv') ? 'configured' : 'pending',
      'KV cache provisioning; application cache behavior is not tested'
    );
  for (const [name, label] of [
    ['newsletter', 'Newsletter'],
    ['notification', 'Notifications'],
  ] as const) {
    const settings = website[name];
    if (settings?.enable === true)
      add(
        'pending',
        `${label}: verify the configured ${String(settings.provider || 'provider')} credentials and a real operation.`
      );
    else if (settings?.enable !== false)
      add(
        'pending',
        `${label}: enable state is dynamic or absent; verify the feature if enabled.`
      );
  }
  if (config.paymentProvider === 'waffo') {
    add(
      done('waffo-webhook') ? 'configured' : 'pending',
      'Waffo test products and webhook'
    );
    add(
      'pending',
      'Complete a Waffo sandbox checkout and verify webhook processing and account entitlement. Test configuration is not ready for live payments.'
    );
  }
  return items;
}

export function printAcceptanceReport(state: SetupState): void {
  const labels = {
    verified: 'CHECKED',
    configured: 'CONFIGURED',
    pending: 'TODO',
    failed: 'FAILED',
  };
  console.log('\nInitialization acceptance report');
  for (const item of buildAcceptanceReport(state))
    console.log(`[${labels[item.status]}] ${item.message}`);
}
