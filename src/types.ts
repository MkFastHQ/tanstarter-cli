export type PaymentProvider = 'none' | 'waffo';
export type WaffoProductType = 'onetime' | 'subscription';
export type WaffoBillingPeriod = 'monthly' | 'yearly';
export type WaffoProductSlot = 'lifetime' | 'proMonthly' | 'proYearly';

export interface WaffoProductIds {
  proMonthly: string;
  proYearly: string;
  lifetime: string;
}

export interface CliOptions {
  command: 'create' | 'delete';
  projectName: string;
  targetDir: string;
  domain: string;
  emailSending?: boolean;
  emailForwardTo?: string;
  emailTestTo?: string;
  githubRepo?: string;
  payment?: PaymentProvider;
  acceptDefaults: boolean;
  resume: boolean;
}

export interface RuntimeConfig {
  projectName: string;
  targetDir: string;
  domain: string;
  emailSending?: boolean;
  emailForwardTo?: string;
  emailTestTo?: string;
  githubRepo: string;
  githubRepoUrl?: string;
  initialCommitSha?: string;
  githubDeployment?: GithubDeployment;
  emailTestResult?: EmailTestResult;
  deploymentUrl?: string;
  cloudflareAccountId: string;
  cloudflareApiToken: string;
  d1DatabaseName: string;
  d1DatabaseId: string;
  r2BucketName: string;
  kvNamespaceName: string;
  kvNamespaceId: string;
  paymentProvider: PaymentProvider;
  waffoSetupId: string;
  waffoMerchantId: string;
  waffoPrivateKey: string;
  waffoStoreName: string;
  waffoStoreId: string;
  waffoProductIds: WaffoProductIds;
  waffoWebhookId: string;
}

export interface GithubDeployment {
  headSha: string;
  url: string;
  status: string;
  conclusion: string | null;
}

export interface EmailTestResult {
  to: string;
  from: string;
  status: 'accepted' | 'queued' | 'failed' | 'unknown';
}

export interface SetupState {
  completedSteps: string[];
  config: RuntimeConfig;
  updatedAt: string;
}

export interface CommandResult {
  stdout: string;
  stderr: string;
}
