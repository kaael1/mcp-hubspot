import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const extensionRoot = join(root, 'extension');

const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });

describe('extension safety boundary', () => {
  it('does not request token/cookie/header interception permissions', () => {
    const manifest = JSON.parse(readFileSync(join(extensionRoot, 'manifest.json'), 'utf8')) as {
      permissions?: string[];
    };

    expect(manifest.permissions || []).not.toContain('cookies');
    expect(manifest.permissions || []).not.toContain('webRequest');
    expect(manifest.permissions || []).not.toContain('webRequestBlocking');
  });

  it('declares existing PNG icons for Chrome extension surfaces', () => {
    const manifest = JSON.parse(readFileSync(join(extensionRoot, 'manifest.json'), 'utf8')) as {
      action?: { default_icon?: Record<string, string> };
      icons?: Record<string, string>;
    };

    for (const iconPath of [...Object.values(manifest.icons || {}), ...Object.values(manifest.action?.default_icon || {})]) {
      expect(iconPath.endsWith('.png')).toBe(true);
      expect(existsSync(join(extensionRoot, iconPath))).toBe(true);
    }
  });

  it('does not use browser-session extraction APIs in extension source', () => {
    const forbidden = [
      'document.cookie',
      'localStorage',
      'sessionStorage',
      'indexedDB',
      'onBeforeSendHeaders',
      'Authorization',
      'Bearer ',
    ];
    const source = walk(extensionRoot)
      .filter((file) => /\.(ts|json)$/.test(file))
      .map((file) => readFileSync(file, 'utf8'))
      .join('\n');

    for (const pattern of forbidden) {
      expect(source).not.toContain(pattern);
    }
  });
});
