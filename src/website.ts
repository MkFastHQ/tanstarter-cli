import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import type { RuntimeConfig } from './types.js';

export type WebsiteSettings = Record<string, Record<string, unknown>>;

function unwrap(node: ts.Expression): ts.Expression {
  while (
    ts.isAsExpression(node) ||
    ts.isSatisfiesExpression(node) ||
    ts.isParenthesizedExpression(node)
  )
    node = node.expression;
  return node;
}

function load(targetDir: string) {
  const file = path.join(targetDir, 'src/config/website.ts');
  const text = fs.readFileSync(file, 'utf8');
  const source = ts.createSourceFile(
    file,
    text,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS
  );
  let root: ts.ObjectLiteralExpression | undefined;
  for (const statement of source.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (
        ts.isIdentifier(declaration.name) &&
        declaration.name.text === 'websiteConfig' &&
        declaration.initializer
      ) {
        const value = unwrap(declaration.initializer);
        if (ts.isObjectLiteralExpression(value)) root = value;
      }
    }
  }
  if (!root)
    throw new Error(
      'Expected a literal websiteConfig object in src/config/website.ts.'
    );
  return { file, text, source, root };
}

function property(
  object: ts.ObjectLiteralExpression,
  key: string
): ts.PropertyAssignment | undefined {
  const matches = object.properties.filter(
    (entry) =>
      entry.name &&
      (ts.isIdentifier(entry.name) || ts.isStringLiteral(entry.name)) &&
      entry.name.text === key
  );
  if (
    matches.length > 1 ||
    (matches[0] && !ts.isPropertyAssignment(matches[0]))
  ) {
    throw new Error(
      `Expected one property assignment for websiteConfig.${key}.`
    );
  }
  return matches[0] as ts.PropertyAssignment | undefined;
}

/** Inspect literals only; never execute application code or load its env files. */
export function readWebsiteSettings(targetDir: string): WebsiteSettings {
  const { root } = load(targetDir);
  if (root.properties.some(ts.isSpreadAssignment))
    throw new Error('Dynamic websiteConfig needs manual verification.');
  const result: WebsiteSettings = {};
  for (const name of [
    'auth',
    'mail',
    'newsletter',
    'notification',
    'storage',
    'cache',
  ]) {
    const node = property(root, name)?.initializer;
    const value = node && unwrap(node);
    if (
      !value ||
      !ts.isObjectLiteralExpression(value) ||
      value.properties.some(ts.isSpreadAssignment)
    )
      continue;
    const fields: Record<string, unknown> = {};
    for (const key of [
      'enable',
      'enableGoogleLogin',
      'enableCredentialLogin',
      'provider',
      'fromEmail',
      'supportEmail',
    ]) {
      const field = property(value, key)?.initializer;
      if (!field) continue;
      if (ts.isStringLiteral(field)) fields[key] = field.text;
      else if (field.kind === ts.SyntaxKind.TrueKeyword) fields[key] = true;
      else if (field.kind === ts.SyntaxKind.FalseKeyword) fields[key] = false;
    }
    result[name] = fields;
  }
  return result;
}

export function emailAddress(value: string): string | undefined {
  const address = value.match(/<([^<>]+)>$/)?.[1] ?? value;
  return /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(address) ? address : undefined;
}

/** Configure opted-in sending without changing unrelated application settings. */
export function configureWebsiteMail(config: RuntimeConfig): void {
  if (!config.emailSending) return;
  if (!config.domain)
    throw new Error('Email Sending requires a custom domain.');
  const { file, text, source, root } = load(config.targetDir);
  const mail = property(root, 'mail')?.initializer;
  if (
    root.properties.some(ts.isSpreadAssignment) ||
    !mail ||
    !ts.isObjectLiteralExpression(mail) ||
    mail.properties.some(ts.isSpreadAssignment)
  ) {
    throw new Error(
      'Expected literal websiteConfig.mail without spreads; configure mail manually before resuming.'
    );
  }
  const edits: Array<{ start: number; end: number; text: string }> = [];
  function set(key: string, value: string) {
    const entry = property(mail as ts.ObjectLiteralExpression, key);
    edits.push(
      entry
        ? {
            start: entry.initializer.getStart(source),
            end: entry.initializer.end,
            text: value,
          }
        : {
            start: mail!.getStart(source) + 1,
            end: mail!.getStart(source) + 1,
            text: `\n    ${key}: ${value},`,
          }
    );
  }
  const fallback = `${config.projectName} <support@${config.domain}>`;
  for (const key of ['fromEmail', 'supportEmail']) {
    const node = property(mail, key)?.initializer;
    if (node && !ts.isStringLiteral(node))
      throw new Error(
        `websiteConfig.mail.${key} must be a string literal before automatic mail setup.`
      );
    const value = node && ts.isStringLiteral(node) ? node.text : '';
    const address = emailAddress(value);
    if (!value || address === 'support@tanstarter.dev')
      set(key, JSON.stringify(fallback));
    else if (
      key === 'fromEmail' &&
      (!address ||
        address.split('@')[1]?.toLowerCase() !== config.domain.toLowerCase())
    ) {
      throw new Error(
        `websiteConfig.mail.fromEmail must use the onboarded domain ${config.domain}; update it before resuming.`
      );
    }
  }
  set('enable', 'true');
  set('provider', JSON.stringify('cloudflare'));
  let next = text;
  for (const edit of edits.sort((a, b) => b.start - a.start))
    next = next.slice(0, edit.start) + edit.text + next.slice(edit.end);
  fs.writeFileSync(file, next, 'utf8');
}
