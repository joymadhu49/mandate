/** Overwrite all caller-supplied geo hints using only Cloudflare's request metadata. */
export function withTrustedCountry(request: Request & { cf?: { country?: unknown } }) {
  const headers = new Headers(request.headers);
  headers.set('x-mandate-country', typeof request.cf?.country === 'string' ? request.cf.country : 'XX');
  return headers;
}
