import { z } from 'zod';
import { DatabaseSchema } from './db.js';
import { ChatStore } from './chat.js';
import { CredentialRecords, AICredentials } from './ai-credentials.js';
import { UsageSchema } from './admission.js';
import { spender, spenderFor } from './chain.js';
import { config } from './config.js';
import { atomicWriteJson } from './persistence.js';

export const MigrationSnapshot = z.object({
  rootAddress: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  database: DatabaseSchema,
  mode: z.object({ live: z.boolean() }).strict(),
  chats: ChatStore,
  usage: UsageSchema,
  credentials: CredentialRecords,
}).strict();

/** Called only in a one-time, authenticated import into an empty ledger. */
export function importSnapshot(input: unknown) {
  const snapshot = MigrationSnapshot.parse(input);
  if (snapshot.rootAddress.toLowerCase() !== spender.address.toLowerCase()) throw new Error('Agent key does not match the source deployment.');
  for (const m of snapshot.database.mandates) {
    if (m.executionMode === 'live' && !['revoked', 'expired'].includes(m.status) && m.spender.toLowerCase() !== spenderFor(m.account as `0x${string}`).address.toLowerCase()) {
      throw new Error('An active mandate has a different agent account.');
    }
  }
  atomicWriteJson(config.dbPath, snapshot.database);
  atomicWriteJson(`${config.dbPath}.mode.json`, snapshot.mode);
  atomicWriteJson(`${config.dbPath}.chat.json`, snapshot.chats);
  atomicWriteJson(`${config.dbPath}.ai-usage.json`, snapshot.usage);
  atomicWriteJson(`${config.dbPath}.ai-credentials.json`, snapshot.credentials);
  const vault = new AICredentials(`${config.dbPath}.ai-credentials.json`);
  for (const owner of Object.keys(snapshot.credentials)) vault.get(owner); // Wrong vault key aborts the surrounding SQL transaction.
  return {
    mandates: snapshot.database.mandates.length,
    orders: snapshot.database.orders.length,
    positions: snapshot.database.positions.length,
    activity: snapshot.database.activity.length,
    messages: snapshot.chats.messages.length,
    credentials: Object.keys(snapshot.credentials).length,
  };
}
