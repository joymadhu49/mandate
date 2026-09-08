import { DurableObject } from 'cloudflare:workers';
import { timingSafeEqual, createHash } from 'node:crypto';
import { browserAPI, wantsWebApp } from './browser-api.js';
import { withTrustedCountry } from './eligibility-edge.js';
import { app } from './app.js';
import { withRuntime, type RuntimeStore } from './runtime.js';
import { importSnapshot } from './migration.js';
import { recoverInterruptedExecutions } from './runner.js';
import { nextScheduledAt, schedulerStep } from './cloud-scheduler.js';

interface Env {
  LEDGER: DurableObjectNamespace<MandateLedger>;
  ASSETS: Fetcher;
  SCHEDULER_ENABLED: string;
  PUBLIC_URL: string;
  MIGRATION_TOKEN?: string;
}
const LEDGER_NAME = 'mandate-production-v1';
const failure = () => Response.json({ error: 'The agent is temporarily unavailable. Please try again.' }, { status: 503 });
const hash = (value: string) => createHash('sha256').update(value).digest();

/** The existing beta's shared trading ledger and global AI budget form one coordination unit.
 * Static media is served separately. Do not create another ledger with the same live signer.
 */
export class MandateLedger extends DurableObject<Env> {
  private runtime: RuntimeStore;
  private recovered = false;
  private alarmRunning = false;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    const sql = ctx.storage.sql;
    sql.exec('CREATE TABLE IF NOT EXISTS documents (path TEXT NOT NULL, part INTEGER NOT NULL, body TEXT NOT NULL, PRIMARY KEY(path, part))');
    this.runtime = {
      cache: new Map(),
      read: path => {
        const rows = sql.exec<{ body: string }>('SELECT body FROM documents WHERE path = ? ORDER BY part', path).toArray();
        return rows.length ? rows.map(row => row.body).join('') : undefined;
      },
      write: (path, value) => ctx.storage.transactionSync(() => {
        sql.exec('DELETE FROM documents WHERE path = ?', path);
        for (let offset = 0, part = 0; offset < value.length; offset += 32_000, part++) {
          sql.exec('INSERT INTO documents (path, part, body) VALUES (?, ?, ?)', path, part, value.slice(offset, offset + 32_000));
        }
      }),
      flush: () => ctx.storage.sync(),
    };
  }

  private initialized() { return this.runtime.read('/imported') !== undefined; }
  private recover() {
    if (!this.recovered) {
      withRuntime(this.runtime, () => recoverInterruptedExecutions());
      this.recovered = true;
    }
  }
  private async reschedule() {
    if (!this.initialized() || this.env.SCHEDULER_ENABLED !== '1') { await this.ctx.storage.deleteAlarm(); return; }
    const at = withRuntime(this.runtime, nextScheduledAt);
    if (at === null) await this.ctx.storage.deleteAlarm();
    else {
      const current = await this.ctx.storage.getAlarm();
      if (current === null || current > at) await this.ctx.storage.setAlarm(at);
    }
  }

  async handle(request: Request): Promise<Response> {
    const path = new URL(request.url).pathname;
    if (path === '/_migration/import') {
      if (!this.env.MIGRATION_TOKEN || !timingSafeEqual(hash(request.headers.get('authorization') ?? ''), hash(`Bearer ${this.env.MIGRATION_TOKEN}`))) {
        return new Response('Not found', { status: 404 });
      }
      if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });
      if (this.initialized()) return Response.json({ error: 'This ledger has already been imported.' }, { status: 409 });
      const reader = request.body?.getReader();
      if (!reader) return new Response('Snapshot required', { status: 400 });
      let size = 0;
      const parts: Uint8Array[] = [];
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > 2_000_000) { await reader.cancel(); return new Response('Snapshot too large', { status: 413 }); }
        parts.push(value);
      }
      // Recheck after awaiting the body to prevent concurrent import replacement.
      if (this.initialized()) return Response.json({ error: 'This ledger has already been imported.' }, { status: 409 });
      try {
        const input = JSON.parse(Buffer.concat(parts).toString('utf8'));
        const counts = withRuntime(this.runtime, () => this.ctx.storage.transactionSync(() => {
          const result = importSnapshot(input);
          this.runtime.write('/imported', JSON.stringify({ at: Date.now(), counts: result }));
          return result;
        }));
        this.runtime.cache.clear();
        await this.runtime.flush();
        console.info('ledger_imported', counts);
        return Response.json({ ok: true, counts });
      } catch {
        this.runtime.cache.clear();
        console.error('ledger_import_failed');
        return Response.json({ error: 'Snapshot validation failed. No state was imported.' }, { status: 400 });
      }
    }
    if (path.startsWith('/_migration')) return new Response('Not found', { status: 404 });
    if (!this.initialized()) return failure();
    this.recover();
    // Keep an un-routed deployment read-only during migration/cutover.
    if (this.env.SCHEDULER_ENABLED !== '1' && !['GET', 'HEAD', 'OPTIONS'].includes(request.method)) return failure();
    try {
      const response = await withRuntime(this.runtime, () => app.fetch(request));
      await this.runtime.flush();
      return response;
    } finally { await this.reschedule(); }
  }

  async ensureScheduled(): Promise<void> {
    if (this.initialized()) { this.recover(); await this.reschedule(); }
  }

  async alarm(): Promise<void> {
    if (!this.initialized() || this.env.SCHEDULER_ENABLED !== '1') return;
    if (this.alarmRunning) return;
    this.alarmRunning = true;
    this.recover();
    try {
      await withRuntime(this.runtime, schedulerStep);
      this.runtime.write('/last-alarm', JSON.stringify({ at: Date.now(), ok: true }));
      await this.runtime.flush();
    } catch {
      console.error('ledger_alarm_failed');
      throw new Error('Scheduled agent work failed.');
    } finally {
      this.alarmRunning = false;
      await this.reschedule();
    }
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const path = new URL(request.url).pathname;
    if (['GET', 'HEAD'].includes(request.method) && (path.startsWith('/demo/') || path.startsWith('/assets/') || path.startsWith('/_expo/') || path === '/favicon.ico')) return env.ASSETS.fetch(request);
    if (wantsWebApp(request)) {
      const url = new URL(request.url); url.pathname = '/index.html'; url.search = '';
      const asset = await env.ASSETS.fetch(new Request(url, { method: request.method }));
      const result = new Response(asset.body, asset);
      result.headers.set('cache-control', 'no-cache');
      result.headers.set('x-frame-options', 'DENY');
      result.headers.set('x-content-type-options', 'nosniff');
      result.headers.set('referrer-policy', 'strict-origin-when-cross-origin');
      result.headers.set('x-mandate-host', 'cloudflare');
      return result;
    }
    try {
      const headers = withTrustedCountry(request);
      // Only Cloudflare's transport value is trusted; discard any caller-supplied internal header.
      headers.set('x-mandate-client-ip', request.headers.get('cf-connecting-ip') ?? 'unknown');
      const forwarded = new Request(request, { headers });
      const ledger = env.LEDGER.getByName(LEDGER_NAME);
      const response = path === '/api' || path.startsWith('/api/')
        ? await browserAPI(forwarded, new URL(env.PUBLIC_URL).origin, req => ledger.handle(req))
        : await ledger.handle(forwarded);
      const result = new Response(response.body, response);
      result.headers.set('x-mandate-host', 'cloudflare');
      result.headers.set('cache-control', 'no-store');
      return result;
    } catch {
      console.error('ledger_request_failed');
      return failure();
    }
  },
  async scheduled(_event: ScheduledController, env: Env) {
    // Watchdog only; actual execution runs inside durable alarms and survives zero app traffic.
    await env.LEDGER.getByName(LEDGER_NAME).ensureScheduled();
  },
} satisfies ExportedHandler<Env>;
