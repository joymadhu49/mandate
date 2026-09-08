import { cp, mkdir, readFile, writeFile, rm, stat } from 'node:fs/promises';
const build = new URL('../dist/', import.meta.url);
const target = new URL('../agent/cloud-assets/', import.meta.url);
await stat(new URL('index.html', build));
// Preserve the separately staged App Review recording and all private local files.
await mkdir(target, { recursive: true });
for (const path of ['_expo', 'assets']) {
  await rm(new URL(path, target), { recursive: true, force: true });
  await cp(new URL(path, build), new URL(path, target), { recursive: true });
}
await cp(new URL('favicon.ico', build), new URL('favicon.ico', target));
let html = await readFile(new URL('index.html', build), 'utf8');
html = html.replace('</head>', '<meta name="base:app_id" content="6a9fb9f7ad9c34826110fd88"><meta name="description" content="Give your AI agent a budget and a plan. Manage tokenized stocks on Base with your Coinbase wallet in Mandate."><link rel="canonical" href="https://mandate.horizonbase.app/"></head>');
await writeFile(new URL('index.html', target), html);
console.log('Web assets staged. Existing App Review media preserved.');
