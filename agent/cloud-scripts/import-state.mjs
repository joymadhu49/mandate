import { readFileSync, writeFileSync } from 'node:fs';
import { privateKeyToAccount } from 'viem/accounts';
const secrets = JSON.parse(readFileSync('data/cloud-secrets.json', 'utf8'));
const cutover = JSON.parse(readFileSync('data/cloud-cutover.json','utf8'));
const read = name => JSON.parse(readFileSync(`${cutover.backup}/${name}`,'utf8'));
const snapshot = {
  rootAddress: privateKeyToAccount(secrets.AGENT_PRIVATE_KEY).address,
  database:read('db.json'),mode:read('db.json.mode.json'),chats:read('db.json.chat.json'),
  usage:read('db.json.ai-usage.json'),credentials:read('db.json.ai-credentials.json'),
};
writeFileSync('data/cloud-snapshot.json',JSON.stringify(snapshot),{mode:0o600});
const response=await fetch('https://mandate.horizonbase.app/_migration/import',{
  method:'POST',headers:{authorization:`Bearer ${secrets.MIGRATION_TOKEN}`,'content-type':'application/json'},body:JSON.stringify(snapshot),
});
const result=await response.json();
if(!response.ok) throw new Error(`Import failed (${response.status}): ${result.error}`);
writeFileSync('data/cloud-import-receipt.json',JSON.stringify({at:new Date().toISOString(),...result}),{mode:0o600});
console.log('Cloudflare import confirmed:',JSON.stringify(result));
