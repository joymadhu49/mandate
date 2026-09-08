import { createHash } from 'node:crypto';
import { getConnInfo } from '@hono/node-server/conninfo';
import type { Context } from 'hono';
import { z } from 'zod';
import { cloudRuntime } from './runtime.js';
import { persistentMap } from './persistent-map.js';

// Use the transport peer, never caller-supplied forwarding headers. A deployment
// behind a proxy must enforce its own source limits at that trusted proxy too.
export function authSource(c: Context): string {
  let peer = 'unknown-transport';
  if (cloudRuntime) peer = c.req.header('x-mandate-client-ip') ?? peer;
  else try { peer = getConnInfo(c).remote.address ?? peer; } catch { /* In-memory requests have no socket. */ }
  return createHash('sha256').update(peer.replace(/^::ffff:/, '')).digest('hex');
}

export class AuthLimiter {
  private windows = persistentMap('/data/auth-limits.json', z.object({ count: z.number(), reset: z.number() }).strict());
  constructor(private clock = Date.now) {}

  allow(endpoint: 'challenge' | 'verify', source: string): boolean {
    const now = this.clock();
    for (const [key, window] of this.windows) if (window.reset <= now) this.windows.delete(key);
    const key = `${endpoint}:${source}`;
    const window = this.windows.get(key);
    if (window) { window.count++; this.windows.set(key, window); return window.count <= 30; }
    if (this.windows.size >= 5000) return false;
    this.windows.set(key, { count: 1, reset: now + 60_000 });
    return true;
  }
}
