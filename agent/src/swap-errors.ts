export type QuoteFailure = 'no_route' | 'unavailable' | 'rate_limited' | 'authentication' | 'blocked';
const messages: Record<QuoteFailure, string> = {
  no_route: 'No swap route is available for this amount and token pair right now.',
  unavailable: 'Swap quote unavailable. The provider could not be reached; try again shortly.',
  rate_limited: 'The swap provider is busy. Please try again shortly.',
  authentication: 'Swap provider authentication failed. Contact the operator.',
  blocked: 'Swap quote unavailable. The provider rejected this request.',
};
export class QuoteError extends Error {
  constructor(readonly kind: QuoteFailure) { super(messages[kind]); }
}

/** Classify known provider codes; never expose raw upstream messages or treat every 400 as missing liquidity. */
export async function quoteHttpError(res: Response): Promise<QuoteError> {
  const body = await res.json().catch(() => null) as { errorCode?: string; code?: number } | null;
  const code = body?.errorCode ?? body?.code;
  if (res.status === 403 || ['FORBIDDEN', 'SANCTIONED_CURRENCY', 'SANCTIONED_WALLET_ADDRESS'].includes(String(code))) return new QuoteError('blocked');
  if (res.status === 401) return new QuoteError('authentication');
  if (res.status === 429 || code === 1005) return new QuoteError('rate_limited');
  if ([1002, 'NO_SWAP_ROUTES_FOUND', 'NO_INTERNAL_SWAP_ROUTES_FOUND', 'NO_QUOTES', 'INSUFFICIENT_LIQUIDITY'].includes(code ?? '')) return new QuoteError('no_route');
  if (res.status >= 500 || res.status === 408 || [1006, 1008, 1009, 1012, 'PRICE_FETCH_FAILED', 'REQUEST_TIMED_OUT', 'RPC_HTTP_ERROR', 'SERVICE_UNAVAILABLE', 'ROUTE_TEMPORARILY_RESTRICTED'].includes(code ?? '')) return new QuoteError('unavailable');
  // Includes redirects, unknown client errors, and restrictions: fail closed.
  return new QuoteError('blocked');
}

export async function fetchQuote(url: string, init: RequestInit): Promise<Response> {
  try { return await fetch(url, init); }
  catch { throw new QuoteError('unavailable'); }
}
