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
  githubRepo?: string;
  payment?: PaymentProvider;
  resume: boolean;
}

export interface RuntimeConfig {
  projectName: string;
  targetDir: string;
  domain: string;
  githubRepo: string;
  githubRepoUrl?: string;
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

export interface SetupState {
  completedSteps: string[];
  config: RuntimeConfig;
  updatedAt: string;
}

export interface WranglerConfig {
  [key: string]: unknown;
  name?: string;
  routes?: Array<{
    pattern: string;
    custom_domain: boolean;
  }>;
  d1_databases?: Array<{
    binding: string;
    database_name: string;
    database_id: string;
    migrations_dir?: string;
  }>;
  r2_buckets?: Array<{
    binding: string;
    bucket_name: string;
  }>;
  kv_namespaces?: Array<{
    binding: string;
    id: string;
  }>;
}

export interface CommandResult {
  stdout: string;
  stderr: string;
}
