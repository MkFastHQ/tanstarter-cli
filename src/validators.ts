export function normalizeSlug(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
}

export function validateSlug(value: string, label: string): void {
  if (!/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(value)) {
    throw new Error(
      `${label} must be 3-63 chars: lowercase letters, numbers, hyphens, no leading/trailing hyphen.`
    );
  }
}

export function validateDomain(value: string): void {
  const domain = normalizeDomain(value);
  if (
    domain.length > 253 ||
    !domain.includes('.') ||
    !domain
      .split('.')
      .every(
        (label) =>
          label.length >= 1 &&
          label.length <= 63 &&
          /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i.test(label)
      )
  ) {
    throw new Error('--domain must be a valid domain name.');
  }
}

export function normalizeDomain(value: string): string {
  return value.trim().replace(/\.+$/, '').toLowerCase();
}

export function validateGithubRepo(value: string): void {
  if (!/^[A-Za-z0-9_.-]+(\/[A-Za-z0-9_.-]+)?$/.test(value)) {
    throw new Error('--repo must be a GitHub repo name or owner/name.');
  }
}
