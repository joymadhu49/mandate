import { createHash, randomBytes } from 'node:crypto';
import { Hono, type MiddlewareHandler } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { z } from 'zod';
import { publicClient } from './chain.js';
import { AuthLimiter, authSource } from './auth-limits.js';
import { persistentMap } from './persistent-map.js';
import { config } from './config.js';

type Address = `0x${string}`;
export type AuthEnv = { Variables: { account: Address } };
const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/).transform((s) => s.toLowerCase() as Address);
const digest = (s: string) => createHash('sha256').update(s).digest('hex');
const challenges = persistentMap(`${config.dbPath}.challenges.json`, z.object({ account: address, message: z.string(), expires: z.number() }).strict());
const sessions = persistentMap(`${config.dbPath}.sessions.json`, z.object({ account: address, expiresAt: z.number() }).strict());
const limiter = new AuthLimiter();

export const authRoutes = new Hono<AuthEnv>();
authRoutes.use('*', bodyLimit({ maxSize: 70_000, onError: (c) => c.json({ error: 'Request too large.' }, 413) }));
authRoutes.use('*', async (c, next) => {
  for (const [key, value] of challenges) if (value.expires < Date.now()) challenges.delete(key);
  for (const [key, value] of sessions) if (value.expiresAt < Date.now()) sessions.delete(key);
  await next();
});
authRoutes.onError((_, c) => c.json({ error: 'Wallet verification failed. Please try again.' }, 400));
authRoutes.post('/challenge', async (c) => {
  if (!limiter.allow('challenge', authSource(c))) return c.json({ error: 'Too many sign-in attempts from this connection. Please wait a minute.' }, 429);
  const parsed = z.object({ account: address }).strict().safeParse(await c.req.json());
  if (!parsed.success || challenges.size >= 1000) return c.json({ error: 'Invalid wallet verification request.' }, 400);
  const nonce = randomBytes(32).toString('hex');
  const expires = Date.now() + 300_000;
  const message = `Mandate wallet verification\n\nSign in to view your private orders and history and manage your mandates. This does not authorize token transfers.\n\nAccount: ${parsed.data.account}\nChain: 8453\nNonce: ${nonce}\nExpires: ${new Date(expires).toISOString()}`;
  challenges.set(nonce, { ...parsed.data, message, expires });
  return c.json({ nonce, message });
});
authRoutes.post('/verify', async (c) => {
  if (!limiter.allow('verify', authSource(c))) return c.json({ error: 'Too many verification attempts from this connection. Please wait a minute.' }, 429);
  const parsed = z.object({ nonce: z.string().regex(/^[a-f0-9]{64}$/), signature: z.string().regex(/^0x(?:[a-fA-F0-9]{2})+$/).max(65538) }).strict().safeParse(await c.req.json());
  if (!parsed.success) return c.json({ error: 'Invalid wallet signature.' }, 400);
  const challenge = challenges.get(parsed.data.nonce);
  challenges.delete(parsed.data.nonce); // Single use, including rejected attempts.
  if (!challenge || challenge.expires < Date.now()) return c.json({ error: 'Verification expired. Please try again.' }, 401);
  const valid = await publicClient.verifyMessage({ address: challenge.account, message: challenge.message, signature: parsed.data.signature as `0x${string}` });
  if (!valid) { console.warn('wallet_verification_denied'); return c.json({ error: 'The signature does not match this wallet.' }, 401); }
  if (sessions.size >= 10_000) return c.json({ error: 'Sign-in is busy. Please try again later.' }, 429);
  const token = randomBytes(32).toString('hex');
  const expiresAt = Date.now() + 24 * 3600_000;
  sessions.set(digest(token), { account: challenge.account, expiresAt });
  console.info('wallet_session_created');
  return c.json({ token, expiresAt, account: challenge.account });
});

export function authenticatedAccount(header?: string) {
  const token = header?.replace(/^Bearer /, '') ?? '';
  const session = sessions.get(digest(token));
  return session && session.expiresAt > Date.now() ? session.account : undefined;
}
export const requireAccount: MiddlewareHandler<AuthEnv> = async (c, next) => {
  const account = authenticatedAccount(c.req.header('authorization'));
  if (!account) return c.json({ error: 'Verify your wallet to access your account.' }, 401);
  c.set('account', account);
  await next();
};
authRoutes.get('/session', requireAccount, (c) => c.json({ account: c.get('account') }));
authRoutes.post('/logout', requireAccount, (c) => {
  sessions.delete(digest(c.req.header('authorization')!.slice(7)));
  return c.json({ ok: true });
});
