// Browser transport for the existing durable wallet sessions. Native bearer routes
// remain unchanged. The browser never receives the bearer token in JSON or JS storage.
const COOKIE = '__Host-mandate_session';
const ROUTES = /^\/(?:eligibility(?:\/location)?|auth\/(?:challenge|verify|session|logout)|agent|orders(?:\/[^/]+\/cancel)?|mandates(?:\/[^/]+(?:\/(?:run|permissions|revoke))?)?|activity|chat(?:\/(?:proposals\/[^/]+\/confirm|authorization\/[^/]+))?|ai\/(?:models|settings|draft)|mode|test-swap\/wallet)\/?$/;
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) => Response.json(body, { status, headers: { 'cache-control': 'no-store', ...headers } });
const cookie = (value: string, seconds: number) => `${COOKIE}=${value}; Secure; HttpOnly; SameSite=Strict; Path=/; Max-Age=${seconds}`;
type Forward = (request: Request) => Promise<Response>;

export async function browserAPI(request: Request, origin: string, forward: Forward): Promise<Response> {
  const url = new URL(request.url);
  if (url.origin !== origin || url.protocol !== 'https:') return json({ error: 'Invalid browser origin.' }, 403);
  const suppliedOrigin = request.headers.get('origin');
  if (request.headers.get('sec-fetch-site') === 'cross-site' || (suppliedOrigin && suppliedOrigin !== origin)) return json({ error: 'Cross origin request refused.' }, 403);
  if (!['GET', 'POST', 'DELETE'].includes(request.method)) return json({ error: 'Method not allowed.' }, 405);
  const write = request.method !== 'GET';
  if (write && (suppliedOrigin !== origin || !request.headers.get('content-type')?.startsWith('application/json'))) return json({ error: 'Use a same origin JSON request.' }, 403);
  const path = url.pathname.slice(4) || '/';
  if (path !== '/' && !ROUTES.test(path)) return json({ error: 'Not found.' }, 404);
  const token = request.headers.get('cookie')?.split(';').map(value => value.trim()).find(value => value.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);
  const headers = new Headers({ accept: 'application/json', 'content-type': 'application/json' });
  // The Worker overwrites this from Cloudflare's transport before invoking us.
  headers.set('x-mandate-client-ip', request.headers.get('x-mandate-client-ip') ?? 'unknown');
  headers.set('x-mandate-country', request.headers.get('x-mandate-country') ?? 'XX');
  if (token && /^[a-f0-9]{64}$/.test(token)) headers.set('authorization', `Bearer ${token}`);
  let body: Uint8Array | undefined;
  if (write && request.body) {
    const reader = request.body.getReader();
    const chunks: Uint8Array[] = []; let size = 0;
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.length;
      if (size > 128 * 1024) { await reader.cancel(); return json({ error: 'Request too large.' }, 413); }
      chunks.push(part.value);
    }
    body = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.length; }
  }
  url.pathname = path;
  try {
    const response = await forward(new Request(url, { method: request.method, headers, body: body?.buffer as ArrayBuffer | undefined }));
    if (path === '/auth/logout' && write && (response.ok || response.status === 401)) return json({ ok: true }, 200, { 'set-cookie': cookie('', 0) });
    if (path === '/auth/verify' && response.ok) {
      const session = await response.json() as { token?: string; account?: string; expiresAt?: number };
      if (!session.token || !/^[a-f0-9]{64}$/.test(session.token) || !session.account || !/^0x[a-f0-9]{40}$/i.test(session.account) || !session.expiresAt || !Number.isFinite(session.expiresAt) || session.expiresAt <= Date.now()) return json({ error: 'Invalid wallet session.' }, 502);
      return json({ token: 'browser-session', account: session.account, expiresAt: session.expiresAt }, 200, { 'set-cookie': cookie(session.token, Math.min(86400, Math.floor((session.expiresAt - Date.now()) / 1000))) });
    }
    // Deliberately do not copy wildcard CORS headers from the native API.
    return new Response(response.body, { status: response.status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
  } catch { return json({ error: 'The agent is temporarily unavailable. Please try again.' }, 503); }
}

const WEB_PAGES = /^\/(?:home|agent|orders|history|settings|eligibility|new-mandate|profile|ai-settings|mandate\/[^/]+|order\/[^/]+)?\/?$/;
export function wantsWebApp(request: Request) {
  if (!['GET', 'HEAD'].includes(request.method) || !WEB_PAGES.test(new URL(request.url).pathname)) return false;
  const accept = request.headers.get('accept') ?? '*/*';
  if (request.headers.get('content-type')?.includes('application/json') || accept.includes('application/json')) return false;
  return accept.includes('text/html') || (new URL(request.url).pathname === '/' && accept.includes('*/*'));
}
