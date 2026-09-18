import { closeSync, existsSync, mkdirSync, openSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { z } from 'zod';
import { generatePrivateKey } from 'viem/accounts';
import { atomicWriteJson, persistentObject } from './persistence.js';

import { cloudRuntime } from './runtime.js';

// Minimal .env loader (no dependency): KEY=VALUE lines, # comments.
const envPath = resolve(process.cwd(), '.env');
if (!cloudRuntime && process.env.NODE_ENV !== 'test' && existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i === -1) continue;
    const k = t.slice(0, i).trim();
    const v = t.slice(i + 1).trim().replace(/^["']|["']$/g, '');
    if (!(k in process.env)) process.env[k] = v;
  }
}

const isTest = process.env.NODE_ENV === 'test';
const dbPath = cloudRuntime ? '/data/db.json' : resolve(process.cwd(), process.env.DB_PATH ?? 'data/db.json');

type SpenderKey = { key: `0x${string}` | ''; source: 'env' | 'file' | 'ephemeral' };

// The spender must be stable: users authorize its address, and a restart must not orphan those
// permissions. AGENT_PRIVATE_KEY wins; otherwise a key file beside the database is created once
// (owner-only). Tests keep an ephemeral key and never touch the filesystem.
function loadSpenderKey(): SpenderKey {
  const fromEnv = process.env.AGENT_PRIVATE_KEY?.trim();
  if (fromEnv) {
    if (!/^0x[0-9a-fA-F]{64}$/.test(fromEnv)) throw new Error('Invalid agent key configuration.');
    return { key: fromEnv as `0x${string}`, source: 'env' };
  }
  if (cloudRuntime) throw new Error('Cloud deployment requires the existing AGENT_PRIVATE_KEY secret.');
  if (isTest) return { key: '', source: 'ephemeral' };
  const path = resolve(dirname(dbPath), 'spender.key');
  if (existsSync(path)) {
    const key = readFileSync(path, 'utf8').trim();
    if (!/^0x[0-9a-fA-F]{64}$/.test(key)) throw new Error(`Spender key file is invalid: ${path}. Restore it from a backup before starting the agent.`);
    return { key: key as `0x${string}`, source: 'file' };
  }
  const key = generatePrivateKey();
  mkdirSync(dirname(path), { recursive: true });
  const fd = openSync(path, 'wx', 0o600);
  try { writeFileSync(fd, `${key}\n`); } finally { closeSync(fd); }
  return { key, source: 'file' };
}

const spenderKey = loadSpenderKey();
const hasSpenderKey = spenderKey.key !== '';

// Execution mode. DRY_RUN=0 pins live; LOCK_MODE=1 pins whatever the file says. Otherwise the
// mode is switchable from the app and remembered in <DB_PATH>.mode.json (default: simulation).
// Live is never possible without a persistent spender key.
const Mode = z.object({ live: z.boolean() }).strict();
const modePath = `${dbPath}.mode.json`;
const pinnedLive = process.env.DRY_RUN === '0';
const modeLocked = pinnedLive || process.env.LOCK_MODE === '1';
const savedMode = isTest ? { live: false } : persistentObject(modePath, Mode, { live: false });
const state = savedMode;
// Wallets allowed to switch the mode when the backend is reachable by strangers (comma-separated). Empty = any verified wallet.
const owners = new Set((process.env.OWNER_ACCOUNTS ?? '').split(',').map(a => a.trim().toLowerCase()).filter(Boolean));

export const config = {
  port: Number(process.env.PORT ?? 8842),
  rpcUrl: process.env.BASE_RPC_URL ?? 'https://mainnet.base.org',
  rpcFallbackUrl: process.env.BASE_RPC_FALLBACK_URL || undefined,
  privateKey: spenderKey.key,
  spenderKeySource: spenderKey.source,
  hasSpenderKey,
  modeLocked,
  /** True when this wallet may switch the execution mode. */
  canSwitchMode(account: string) { return owners.size === 0 || owners.has(account.toLowerCase()); },
  get dryRun() { return !((hasSpenderKey || isTest) && (pinnedLive || state.live)); },
  // Tests flip this directly; runtime code goes through setLive so the choice is validated and saved.
  set dryRun(value: boolean) { state.live = !value; },
  setLive(live: boolean) {
    if (live && !hasSpenderKey) throw new Error('Live mode needs a persistent spender key on the backend (AGENT_PRIVATE_KEY or data/spender.key).');
    if (modeLocked) throw new Error('Execution mode is pinned by the backend environment (DRY_RUN=0 or LOCK_MODE=1).');
    if (!isTest) atomicWriteJson(modePath, { live });
    state.live = live;
  },
  /** Preferred swap venue. Recoverable quote failures try the other provider once. */
  swapProvider: process.env.SWAP_PROVIDER === 'lifi' ? 'lifi' as const : 'relay' as const,
  openrouterKey: process.env.OPENROUTER_API_KEY ?? '',
  model: process.env.MODEL ?? 'google/gemini-2.5-flash',
  devAiSettings: process.env.DEV_AI_SETTINGS === '1' && process.env.NODE_ENV !== 'production',
  intervalMin: Number(process.env.AGENT_INTERVAL_MIN ?? 30),
  dbPath,
};
