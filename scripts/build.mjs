import { cp, mkdir, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import esbuild from 'esbuild';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const dist = join(root, 'dist');
const extensionDist = join(dist, 'extension');

await rm(dist, { force: true, recursive: true });
await mkdir(extensionDist, { recursive: true });

await esbuild.build({
  bundle: true,
  entryPoints: [join(root, 'server', 'index.ts')],
  external: ['@modelcontextprotocol/sdk'],
  format: 'esm',
  outfile: join(dist, 'server', 'index.js'),
  platform: 'node',
  sourcemap: true,
  target: 'node20',
});

for (const entryPoint of ['background', 'content', 'popup', 'sidepanel']) {
  await esbuild.build({
    bundle: true,
    entryPoints: [join(root, 'extension', `${entryPoint}.ts`)],
    format: 'iife',
    outfile: join(extensionDist, `${entryPoint}.js`),
    platform: 'browser',
    sourcemap: true,
    target: 'chrome120',
  });
}

for (const file of ['manifest.json', 'popup.html', 'sidepanel.html', 'styles.css']) {
  await cp(join(root, 'extension', file), join(extensionDist, file));
}

await cp(join(root, 'extension', 'assets'), join(extensionDist, 'assets'), { recursive: true });

console.log(`Built server and extension into ${dist}`);
