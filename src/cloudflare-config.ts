import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

import type { RuntimeConfig } from './types.js';

/** Fail before provisioning when a resumed project still uses the old template. */
export function assertCloudflareProject(targetDir: string): void {
  if (!fs.existsSync(path.join(targetDir, 'cloudflare.config.ts'))) {
    throw new Error(
      'cloudflare.config.ts is required. Use the current Cloudflare CLI template; migrate older projects with cf migrate and update their scripts/dependencies before resuming or deleting resources.'
    );
  }
  const pkg = JSON.parse(
    fs.readFileSync(path.join(targetDir, 'package.json'), 'utf8')
  ) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  if (!pkg.dependencies?.cf && !pkg.devDependencies?.cf) {
    throw new Error(
      'The project must declare cf as a dependency. Update the template and run pnpm install before continuing.'
    );
  }
}

/** Update only the template's resource settings, preserving imports and secrets. */
export function writeCloudflareConfig(config: RuntimeConfig): void {
  const configPath = path.join(config.targetDir, 'cloudflare.config.ts');
  if (!fs.existsSync(configPath)) {
    throw new Error(
      'cloudflare.config.ts is required. Use the current Cloudflare CLI template; migrate older projects with cf migrate before resuming.'
    );
  }
  const content = fs.readFileSync(configPath, 'utf8');
  const source = ts.createSourceFile(
    configPath,
    content,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS
  );
  const exported = source.statements.find(ts.isExportAssignment);
  if (
    !exported ||
    !ts.isCallExpression(exported.expression) ||
    exported.expression.expression.getText(source) !== 'defineConfig'
  ) {
    throw new Error(
      'Expected export default defineConfig({...}) in cloudflare.config.ts.'
    );
  }
  const root = requireObject(exported.expression.arguments[0]);
  const worker = requireObject(property(root, 'worker')?.initializer);
  const env = requireObject(property(worker, 'env')?.initializer);
  const edits: Array<{ start: number; end: number; text: string }> = [];

  function set(
    object: ts.ObjectLiteralExpression,
    key: string,
    text: string
  ): void {
    const existing = property(object, key);
    if (existing) {
      edits.push({
        start: existing.initializer.getStart(source),
        end: existing.initializer.end,
        text,
      });
    } else {
      // Insert first so this also works when the last property has no comma.
      edits.push({
        start: object.getStart(source) + 1,
        end: object.getStart(source) + 1,
        text: `\n    ${key}: ${text},`,
      });
    }
  }

  set(worker, 'name', JSON.stringify(config.projectName));
  set(worker, 'domains', JSON.stringify(config.domain ? [config.domain] : []));
  set(
    env,
    'DB',
    `bindings.d1({ name: ${JSON.stringify(config.d1DatabaseName)}, id: ${JSON.stringify(config.d1DatabaseId)} })`
  );
  set(
    env,
    'CACHE',
    `bindings.kv({ id: ${JSON.stringify(config.kvNamespaceId)} })`
  );
  set(
    env,
    'BUCKET',
    `bindings.r2({ name: ${JSON.stringify(config.r2BucketName)} })`
  );

  let next = content;
  for (const edit of edits.sort((a, b) => b.start - a.start)) {
    next = next.slice(0, edit.start) + edit.text + next.slice(edit.end);
  }
  // The template imports these helpers from cf/config; do not silently produce
  // invalid configuration if a future template changes its import structure.
  const hasBindings = source.statements.some(
    (statement) =>
      ts.isImportDeclaration(statement) &&
      ts.isStringLiteral(statement.moduleSpecifier) &&
      statement.moduleSpecifier.text === 'cf/config' &&
      statement.importClause?.namedBindings &&
      ts.isNamedImports(statement.importClause.namedBindings) &&
      statement.importClause.namedBindings.elements.some(
        (element) => element.name.text === 'bindings' && !element.propertyName
      )
  );
  if (!hasBindings)
    throw new Error('Expected a named bindings import from cf/config.');
  fs.writeFileSync(configPath, next, 'utf8');
}

function property(
  object: ts.ObjectLiteralExpression,
  name: string
): ts.PropertyAssignment | undefined {
  const found = object.properties.find(
    (entry) =>
      entry.name &&
      (ts.isIdentifier(entry.name) || ts.isStringLiteral(entry.name)) &&
      entry.name.text === name
  );
  if (found && !ts.isPropertyAssignment(found)) {
    throw new Error(
      `Expected a property assignment for ${name} in cloudflare.config.ts.`
    );
  }
  return found;
}

function requireObject(node: ts.Node | undefined): ts.ObjectLiteralExpression {
  if (!node || !ts.isObjectLiteralExpression(node)) {
    throw new Error(
      'Expected literal config, worker, and env objects in cloudflare.config.ts.'
    );
  }
  if (node.properties.some(ts.isSpreadAssignment)) {
    throw new Error(
      'Spread properties in config, worker, or env need manual configuration before resuming.'
    );
  }
  return node;
}
