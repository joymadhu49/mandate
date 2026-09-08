import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { serveStatic } from '@hono/node-server/serve-static';
import { serve } from '@hono/node-server';
import { app } from './app.js';
import { config } from './config.js';
import { spender } from './chain.js';
import { startScheduler } from './runner.js';

if (existsSync(join(dirname(config.dbPath), 'cloud-hosted.json'))) {
  throw new Error('This ledger is hosted on Cloudflare. Use a separate database and signer for local development.');
}

app.use('/demo/*', serveStatic({ root: './public' }));
startScheduler();
serve({ fetch: app.fetch, port: config.port, hostname: '0.0.0.0' }, info => {
  console.log(`mandate-agent on http://0.0.0.0:${info.port}`);
  console.log(`agent root: ${spender.address} (${config.spenderKeySource} key; one agent account is derived per wallet)  mode: ${config.dryRun ? 'simulation' : 'LIVE'}${config.modeLocked ? ' (pinned)' : ' (switchable in-app)'}  model: ${config.openrouterKey ? config.model : 'rules-only (no OPENROUTER_API_KEY)'}`);
  if (!config.hasSpenderKey) console.log('note: ephemeral spender — live mode unavailable until a persistent key exists');
});
