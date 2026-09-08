import { randomBytes } from 'node:crypto';

const COOKIE = 'mandate_local_session';
const JSON_HEADERS = { 'content-type': 'application/json', 'cache-control': 'no-store' };
const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), { status, headers: { ...JSON_HEADERS, ...headers } });
// Explicitly allow only the public app API. Never proxy migration or operator internals.
const ROUTES = /^\/(?:eligibility(?:\/location)?|auth\/(?:challenge|verify|session|logout)|agent|orders(?:\/[^/]+\/cancel)?|mandates(?:\/[^/]+(?:\/(?:run|permissions|revoke))?)?|activity|chat(?:\/(?:proposals\/[^/]+\/confirm|authorization\/[^/]+))?|ai\/(?:models|settings|draft)|mode|test-swap\/wallet)\/?$/;

/** Local-only browser gateway. No environment files or signing keys are loaded. */
export function createGateway({ origin, upstream = 'https://mandate.horizonbase.app', fetcher = fetch, now = Date.now }) {
  const sessions = new Map();
  const cookie = (id, age) => `${COOKIE}=${id}; HttpOnly; SameSite=Strict; Path=/api; Max-Age=${age}`;
  return async function gateway(request) {
    const url = new URL(request.url);
    if (url.origin !== origin) return json({ error: 'Invalid host.' }, 403);
    if (request.headers.get('sec-fetch-site') === 'cross-site') return json({ error: 'Cross origin request refused.' }, 403);
    if (request.headers.has('origin') && request.headers.get('origin') !== origin) return json({ error: 'Cross origin request refused.' }, 403);
    const write = !['GET', 'HEAD'].includes(request.method);
    if (write && (request.headers.get('origin') !== origin || !request.headers.get('content-type')?.startsWith('application/json'))) return json({ error: 'Use a same origin JSON request.' }, 403);
    const path = url.pathname.slice(4) || '/';
    if (path !== '/' && !ROUTES.test(path)) return json({ error: 'Not found.' }, 404);
    if (!['GET', 'POST', 'DELETE'].includes(request.method)) return json({ error: 'Method not allowed.' }, 405);
    const id = request.headers.get('cookie')?.split(';').map(part => part.trim()).find(part => part.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);
    const session = sessions.get(id);
    for (const [key, value] of sessions) if (value.expiresAt <= now()) sessions.delete(key);
    if (path === '/auth/logout' && request.method === 'POST') {
      sessions.delete(id);
      if (session) void fetcher(`${upstream}/auth/logout`, { method: 'POST', headers: { authorization: `Bearer ${session.token}`, 'content-type': 'application/json' }, signal: AbortSignal.timeout(10_000), redirect: 'error' }).catch(() => {});
      return json({ ok: true }, 200, { 'set-cookie': cookie('', 0) });
    }
    const body = write ? await request.text() : undefined;
    if (body && Buffer.byteLength(body) > 128 * 1024) return json({ error: 'Request too large.' }, 413);
    // Cookie credentials are translated server-side. Browser-supplied bearer values are ignored.
    const headers = { accept: 'application/json', 'content-type': 'application/json' };
    if (session && session.expiresAt > now()) headers.authorization = `Bearer ${session.token}`;
    try {
      const response = await fetcher(`${upstream}${path}${url.search}`, { method: request.method, headers, body: body || undefined, redirect: 'error', signal: AbortSignal.timeout(38_000) });
      const result = await response.json().catch(() => null);
      if (!result) return json({ error: 'The agent could not respond. Please try again.' }, 502);
      if (path === '/auth/verify' && response.ok) {
        if (!/^[a-f0-9]{64}$/i.test(result.token) || !/^0x[a-f0-9]{40}$/i.test(result.account) || !Number.isFinite(result.expiresAt)) return json({ error: 'Invalid wallet session.' }, 502);
        // Backend expiry is a Unix timestamp in milliseconds.
        if (result.expiresAt <= now()) return json({ error: 'Wallet session expired.' }, 401);
        if (sessions.size >= 1024) return json({ error: 'Too many local sessions. Restart the local server.' }, 503);
        const nextId = randomBytes(32).toString('hex');
        sessions.delete(id);
        sessions.set(nextId, { token: result.token, account: result.account, expiresAt: result.expiresAt });
        return json({ account: result.account, expiresAt: result.expiresAt, token: 'browser-session' }, 200, { 'set-cookie': cookie(nextId, Math.floor((result.expiresAt - now()) / 1000)) });
      }
      return json(result, response.status);
    } catch { return json({ error: 'Cannot reach the agent. Please try again.' }, 502); }
  };
}
