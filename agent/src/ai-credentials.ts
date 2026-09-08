import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { z } from 'zod';
import { cloudRuntime } from './runtime.js';
import { atomicWriteJson, loadValidatedJson } from './persistence.js';

const Settings = z.object({ apiKey: z.string().min(20).max(512), model: z.string().min(3).max(160) }).strict();
export const CredentialRecords = z.record(z.string().regex(/^0x[0-9a-f]{40}$/), z.object({ iv: z.string(), tag: z.string(), data: z.string() }).strict());
type AISettings = z.infer<typeof Settings>;

// Local development vault: encrypted records and an owner-readable machine key.
// Protect both files in backups; host compromise can still decrypt this vault.
export class AICredentials {
  constructor(private path: string) {}
  private key(create = false): Buffer {
    if (cloudRuntime) {
      const key = process.env.AI_CREDENTIALS_KEY;
      if (!key || !/^[a-f0-9]{64}$/.test(key)) throw new Error('AI credential storage is unavailable.');
      return Buffer.from(key, 'hex');
    }
    const path = `${this.path}.key`;
    if (!existsSync(path) && create) atomicWriteJson(path, randomBytes(32).toString('hex'));
    const value = JSON.parse(readFileSync(path, 'utf8'));
    if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) throw new Error('AI credential storage is unavailable.');
    return Buffer.from(value, 'hex');
  }
  private records() { return loadValidatedJson(this.path, CredentialRecords, {}); }
  get(account: string): AISettings | undefined {
    const owner = account.toLowerCase();
    const record = this.records()[owner];
    if (!record) return undefined;
    const decipher = createDecipheriv('aes-256-gcm', this.key(), Buffer.from(record.iv, 'hex'));
    decipher.setAAD(Buffer.from(owner));
    decipher.setAuthTag(Buffer.from(record.tag, 'hex'));
    return Settings.parse(JSON.parse(Buffer.concat([decipher.update(Buffer.from(record.data, 'hex')), decipher.final()]).toString('utf8')));
  }
  set(account: string, settings: AISettings) {
    const owner = z.string().regex(/^0x[0-9a-f]{40}$/).parse(account.toLowerCase());
    const records = this.records();
    if (!records[owner] && Object.keys(records).length >= 1000) throw new Error('AI credential storage is full.');
    const iv = randomBytes(12);
    // Never silently replace a missing machine key for an existing vault.
    const cipher = createCipheriv('aes-256-gcm', this.key(Object.keys(records).length === 0), iv);
    cipher.setAAD(Buffer.from(owner));
    const data = Buffer.concat([cipher.update(JSON.stringify(Settings.parse(settings))), cipher.final()]);
    records[owner] = { iv: iv.toString('hex'), tag: cipher.getAuthTag().toString('hex'), data: data.toString('hex') };
    atomicWriteJson(this.path, records);
  }
  remove(account: string) {
    const records = this.records();
    delete records[account.toLowerCase()];
    atomicWriteJson(this.path, records);
  }
}
