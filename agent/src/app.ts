import { Hono } from 'hono';
import { eligibilityMiddleware, eligibilityRoutes } from './eligibility-routes.js';
import { cors } from 'hono/cors';
import { bodyLimit } from 'hono/body-limit';
import { z } from 'zod';
import { config } from './config.js';
import { db, save, uid, log } from './db.js';
import { USDC, spenderFor, publicClient, isBatchApproved, isPermissionRevoked, stockByToken } from './chain.js';
import { modeMatches, registerPermission, runMandate, revokeMandate } from './runner.js';
import type { Mandate } from './types.js';
import { aiRoutes } from './ai-routes.js';
import { aiStatus } from './openrouter.js';
import { addSellPermission, hasCompleteSignatures } from './permissions.js';
import { authRoutes, requireAccount, authenticatedAccount, type AuthEnv } from './auth.js';
import { cancelOrder } from './order-state.js';
import { AdmissionError, assertMandateAdmission } from './admission.js';
import { chatRoutes } from './chat.js';
import { PipelineError, planPipelineTest, planWalletSwap, runPipelineTest } from './pipeline-test.js';
import { landingPage } from './landing.js';
import { cloudRuntime } from './runtime.js';
import { requestEvaluation } from './cloud-scheduler.js';

export const app = new Hono<AuthEnv>();
app.use('*', cors());
app.use('*', bodyLimit({ maxSize: 1_000_000, onError: c => c.json({ error: 'Request too large.' }, 413) }));
app.use('*', eligibilityMiddleware);
app.route('/eligibility', eligibilityRoutes);
app.route('/ai', aiRoutes);
app.route('/auth', authRoutes);
app.route('/chat', chatRoutes);
for (const route of ['/mandates', '/mandates/*', '/activity', '/orders', '/orders/*', '/mode', '/test-swap', '/test-swap/*']) app.use(route, requireAccount);
app.onError((error, c) => error instanceof AdmissionError
  ? c.json({ error: error.message }, 429)
  : c.json({ error: 'The agent could not complete this request. Please try again.' }, 500));

const addr = z.string().regex(/^0x[0-9a-fA-F]{40}$/).transform((s) => s as `0x${string}`);
const hex = z.string().max(8194).regex(/^0x(?:[0-9a-fA-F]{2})*$/).transform((s) => s as `0x${string}`);
const signature = z.string().max(65538).regex(/^0x(?:[0-9a-fA-F]{2})+$/).transform((s) => s as `0x${string}`);
const uint48 = z.number().int().nonnegative().max(2 ** 48 - 1);
const uintString = (bits: number) => z.string().regex(/^\d+$/).max(Math.ceil(bits * Math.LOG10E * Math.LN2))
  .refine(value => value.length <= 78 && /^\d+$/.test(value) && BigInt(value) < (1n << BigInt(bits)), 'Integer is outside the permission range.');

const CreateMandate = z.object({
  control: z.enum(['chat', 'automatic']).default('automatic'),
  account: addr,
  budgetUsdc: z.number().positive().max(1_000_000),
  period: z.enum(['daily', 'weekly', 'monthly']),
  universe: z.array(addr).min(1).max(13),
  strategy: z.string().max(1000),
  risk: z.enum(['conservative', 'balanced', 'aggressive']),
  maxPositionPct: z.number().min(1).max(100),
  takeProfitPct: z.number().min(0.5).max(200),
  stopLossPct: z.number().min(0.5).max(100),
  batch: z.object({
    account: addr,
    period: uint48.positive(),
    start: uint48,
    end: uint48,
    permissions: z.array(
      z.object({ spender: addr, token: addr, allowance: uintString(160), salt: uintString(256), extraData: hex, signature: signature.optional() }),
    ).min(1).max(14),
  }),
  signature: signature.optional(),
  approvalTx: z.string().regex(/^0x[0-9a-fA-F]{64}$/).transform(s => s as `0x${string}`).optional(),
}).refine(value => config.dryRun || hasCompleteSignatures(value) || (value.approvalTx && !value.signature && value.batch.permissions.every(p => !p.signature)), { message: 'Complete the wallet approval before saving.' })
  .refine(value => value.batch.end > value.batch.start, { message: 'Permission expiration must follow its start.' })
  // The USDC budget is always signed at setup. A chat mandate adds each stock's sell permission on its first sell;
  // an automatic mandate must exit positions unattended, so it needs every stock's sell permission before it starts.
  .refine(value => value.batch.permissions.some(p => p.token.toLowerCase() === USDC.toLowerCase()), { message: 'The USDC budget permission is missing.' })
  .refine(value => value.batch.permissions.every(p => p.token.toLowerCase() === USDC.toLowerCase() || value.universe.some(t => t.toLowerCase() === p.token.toLowerCase())),
    { message: 'Every permission must be for USDC or a stock in this mandate.' })
  .refine(value => value.control === 'chat' || value.universe.every(t => value.batch.permissions.some(p => p.token.toLowerCase() === t.toLowerCase())),
    { message: 'An automatic mandate needs a sell permission for every stock before it starts.' });
const SellPermission = z.object({ spender: addr, token: addr, allowance: uintString(160), salt: uintString(256), extraData: hex, signature }).strict();

// Browsers get the landing page; the app and other API clients get the health document.
app.get('/', (c) => {
  const accept = c.req.header('accept') ?? '*/*';
  const jsonClient = accept.includes('application/json') || c.req.header('content-type')?.includes('application/json');
  // Domain verifiers and link crawlers commonly request */* instead of text/html.
  if (accept.includes('text/html') || (!jsonClient && accept.includes('*/*'))) {
    const host = c.req.header('x-forwarded-host') ?? c.req.header('host') ?? 'localhost:8842';
    const proto = c.req.header('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https');
    return c.html(landingPage({
      publicUrl: process.env.PUBLIC_URL || `${proto}://${host}`, testFlightUrl: process.env.TESTFLIGHT_URL || undefined,
      repoUrl: process.env.REPO_URL || undefined, dryRun: config.dryRun,
    }));
  }
  return c.json({ ok: true, name: 'mandate-agent', dryRun: config.dryRun });
});

app.get('/agent', (c) => {
  const account = authenticatedAccount(c.req.header('authorization'));
  const ai = aiStatus(account);
  return c.json({
    spender: account ? spenderFor(account as `0x${string}`).address : null, model: ai.configured ? ai.model : 'rules-only', dryRun: config.dryRun, ai,
    liveAvailable: config.hasSpenderKey && !config.modeLocked && (!account || config.canSwitchMode(account)),
  });
});

// Runtime execution mode. Any verified wallet on this backend may switch it; pin it with
// DRY_RUN=0 or LOCK_MODE=1 when the backend is shared. Existing mandates keep their stamped mode.
// Live pipeline smoke test: plan (GET) and execute (POST with an explicit confirm). See pipeline-test.ts.
const TestSwapInput = z.object({ usd: z.number().finite(), confirm: z.literal(true) }).strict();
const pipelineFailure = (c: { json: (body: unknown, status?: 400 | 409 | 500) => Response }, error: unknown) => {
  if (!(error instanceof PipelineError)) console.error('pipeline_request_failed', { name: error instanceof Error ? error.name : 'unknown', rpcHost: new URL(config.rpcUrl).hostname });
  return c.json({ error: error instanceof PipelineError ? error.message : 'Could not reach the trading network. Please try again.' }, error instanceof PipelineError ? error.status : 500);
};
app.get('/test-swap', async (c) => {
  try { return c.json(await planPipelineTest(c.get('account') as `0x${string}`, Number(c.req.query('usd') ?? 1))); } catch (error) { return pipelineFailure(c, error); }
});
// Wallet-signed variant: the app shows this plan, then the user's Coinbase wallet signs and pays for the swap itself.
app.get('/test-swap/wallet', async (c) => {
  try { return c.json(await planWalletSwap(c.get('account') as `0x${string}`, Number(c.req.query('usd') ?? 1))); } catch (error) { return pipelineFailure(c, error); }
});
app.post('/test-swap', async (c) => {
  const parsed = TestSwapInput.safeParse(await c.req.json().catch(() => undefined));
  if (!parsed.success) return c.json({ error: 'Send { usd, confirm: true }.' }, 400);
  try { return c.json(await runPipelineTest(c.get('account') as `0x${string}`, parsed.data.usd)); } catch (error) { return pipelineFailure(c, error); }
});

const ModeInput = z.object({ live: z.boolean() }).strict();
app.post('/mode', async (c) => {
  const parsed = ModeInput.safeParse(await c.req.json().catch(() => undefined));
  if (!parsed.success) return c.json({ error: 'Send { live: true } or { live: false }.' }, 400);
  if (!config.canSwitchMode(c.get('account'))) return c.json({ error: 'Only the backend operator can switch the execution mode.' }, 403);
  try { config.setLive(parsed.data.live); } catch (error) { return c.json({ error: (error as Error).message }, 409); }
  console.log(`execution mode → ${config.dryRun ? 'simulation' : 'LIVE'} (switched by ${c.get('account')})`);
  return c.json({ dryRun: config.dryRun });
});

app.get('/mandates', (c) => {
  const account = c.get('account');
  const list = db.mandates.filter((m) => m.account.toLowerCase() === account);
  return c.json(list);
});

app.get('/activity', (c) => {
  const account = c.get('account');
  return c.json(db.activity.filter((a) => a.account.toLowerCase() === account).slice(0, 500));
});

app.get('/orders', (c) => c.json(db.orders.filter((o) => o.account.toLowerCase() === c.get('account')).slice(0, 500)));
app.post('/orders/:id/cancel', (c) => {
  const order = db.orders.find((o) => o.id === c.req.param('id'));
  if (!order) return c.json({ error: 'Order not found.' }, 404);
  const result = cancelOrder(order, c.get('account'));
  if (result === 'not-found') return c.json({ error: 'Order not found.' }, 404);
  if (result === 'not-queued') return c.json({ error: 'This order has already left the queue and cannot be cancelled.' }, 409);
  save();
  log({ mandateId: order.mandateId, account: order.account, kind: 'cancelled', symbol: order.symbol, rationale: 'Pending order cancelled by the wallet owner.' });
  return c.json(order);
});

app.post('/mandates', async (c) => {
  const account = c.get('account') as `0x${string}`;
  const parsed = CreateMandate.safeParse(await c.req.json());
  if (!parsed.success) {
    const rule = parsed.error.issues.find(issue => issue.code === 'custom')?.message;
    return c.json({ error: rule ?? 'Invalid mandate or incomplete permission signatures. Complete every wallet approval and retry.' }, 400);
  }
  const b = parsed.data;
  // Simulations must not retain real, reusable spending signatures.
  if (config.dryRun) {
    delete b.signature;
    delete b.approvalTx;
    for (const permission of b.batch.permissions) delete permission.signature;
  }
  if (b.account.toLowerCase() !== c.get('account')) return c.json({ error: 'This mandate belongs to a different wallet.' }, 403);
  if (b.batch.permissions.some((p) => p.spender.toLowerCase() !== spenderFor(account as `0x${string}`).address.toLowerCase())) {
    return c.json({ error: 'permissions must name this agent as spender' }, 400);
  }
  if (b.batch.account.toLowerCase() !== b.account.toLowerCase()) {
    return c.json({ error: 'batch.account mismatch' }, 400);
  }
  // A transaction hash is only a hint, never authorization. Check the exact
  // account/token/spender/allowance/period/salt permissions independently on Base.
  if (!config.dryRun && b.approvalTx && !hasCompleteSignatures(b)) {
    try {
      const receipt = await publicClient.getTransactionReceipt({ hash: b.approvalTx });
      if (receipt.status !== 'success' || !await isBatchApproved(b.batch) || (await Promise.all(b.batch.permissions.map(p => isPermissionRevoked(b.batch, p)))).some(Boolean)) {
        return c.json({ error: 'The wallet transaction has not approved every mandate permission.' }, 409);
      }
    } catch {
      return c.json({ error: 'Could not confirm the wallet approval on Base. Please try again.' }, 409);
    }
  }
  assertMandateAdmission(db.mandates, c.get('account'));
  const m: Mandate = {
    id: uid(),
    spender: spenderFor(account as `0x${string}`).address,
    status: 'pending',
    createdAt: Math.floor(Date.now() / 1000),
    ...b,
    executionMode: config.dryRun ? 'simulation' : 'live',
  };
  db.mandates.unshift(m);
  save();
  const per = { daily: 'day', weekly: 'week', monthly: 'month' }[m.period];
  log({ mandateId: m.id, account: m.account, kind: 'hold', rationale: `Mandate created: $${m.budgetUsdc} per ${per}, ${m.universe.length} stocks, ${m.risk}.` });
  // Kick off the first run without blocking the response.
  if (!cloudRuntime) setTimeout(() => runMandate(m), 500); // Hosted activation is picked up by a durable alarm.
  return c.json(m, 201);
});

app.post('/mandates/:id/run', async (c) => {
  const m = db.mandates.find((x) => x.id === c.req.param('id') && x.account.toLowerCase() === c.get('account'));
  if (!m) return c.json({ error: 'not found' }, 404);
  if (m.lastRunAt && Date.now() / 1000 - m.lastRunAt < 60) return c.json({ error: 'Wait a minute between evaluations.' }, 429);
  if (!modeMatches(m)) {
    const created = m.executionMode ?? 'simulation';
    return c.json({ error: `Mandate created in ${created} mode. Switch the backend to ${created} in Settings to run it.` }, 409);
  }
  if (cloudRuntime) requestEvaluation(m.id);
  else runMandate(m);
  return c.json({ ok: true });
});

// A chat mandate's first sell of a stock: the owner signed that stock's sell permission in the wallet, the agent
// registers it on Base, and only then does the app confirm the order. Repeating a covered token changes nothing.
app.post('/mandates/:id/permissions', async (c) => {
  const account = c.get('account') as `0x${string}`;
  const m = db.mandates.find((x) => x.id === c.req.param('id') && x.account.toLowerCase() === account);
  if (!m) return c.json({ error: 'not found' }, 404);
  const parsed = SellPermission.safeParse(await c.req.json().catch(() => undefined));
  if (!parsed.success) return c.json({ error: 'Send one signed sell permission.' }, 400);
  if (config.dryRun || !modeMatches(m)) return c.json({ error: 'Sell approvals apply to live mandates on a live backend.' }, 409);
  let result: ReturnType<typeof addSellPermission>;
  try { result = addSellPermission(m, parsed.data, spenderFor(account).address, Math.floor(Date.now() / 1000)); }
  catch (error) { return c.json({ error: (error as Error).message }, 409); }
  if (result.added) save();
  const symbol = stockByToken(result.permission.token)?.symbol ?? 'stock';
  const journaled = m.transactions?.length ?? 0;
  let hash: `0x${string}` | undefined;
  try { hash = (await registerPermission(m, result.permission)).hash; }
  catch (error) {
    // Nothing reached Base: forget the new record so the next confirmation asks the wallet again instead of retrying a bad signature.
    if (result.added && (m.transactions?.length ?? 0) === journaled) { m.batch.permissions = m.batch.permissions.filter(p => p !== result.permission); save(); }
    const reason = error instanceof Error && /revoked|busy|no ETH for fees|Could not reach Base/.test(error.message) ? error.message
      : `Could not register the ${symbol} sell permission. Check the agent account has ETH for fees, then confirm again.`;
    return c.json({ error: reason }, 409);
  }
  if (hash) log({ mandateId: m.id, account: m.account, kind: 'approved', symbol, token: result.permission.token, rationale: `${symbol} sell permission registered on Base.`, txHash: hash });
  return c.json(m, result.added ? 201 : 200);
});

app.post('/mandates/:id/revoke', async (c) => {
  const m = db.mandates.find((x) => x.id === c.req.param('id') && x.account.toLowerCase() === c.get('account'));
  if (!m) return c.json({ error: 'not found' }, 404);
  try { await revokeMandate(m); } catch (error) { return c.json({ error: (error as Error).message }, 409); }
  return c.json({ ok: true });
});
