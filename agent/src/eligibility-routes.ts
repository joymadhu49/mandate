import { Hono, type MiddlewareHandler } from 'hono';
import { authenticatedAccount, requireAccount, type AuthEnv } from './auth.js';
import { cloudRuntime } from './runtime.js';
import { config } from './config.js';
import { countries, Declaration, eligibility, permittedLocation, requiresTradingEligibility } from './eligibility.js';

// Only the Worker can provide this header. Node deployments have no trusted geo
// source and fail closed; client-supplied CF-IPCountry never grants access.
const country = (header?: string) => cloudRuntime ? header : undefined;
export const eligibilityMiddleware: MiddlewareHandler<AuthEnv> = async (c, next) => {
  const account = authenticatedAccount(c.req.header('authorization'));
  if (account) eligibility.observe(account, country(c.req.header('x-mandate-country')));
  if ((!config.dryRun || c.req.path.startsWith('/test-swap')) && requiresTradingEligibility(c.req.method, c.req.path)) {
    if (!account) return c.json({ error: 'Verify your wallet to access your account.' }, 401);
    const status = eligibility.status(account);
    if (!status.allowed) return c.json({ error: `${status.reason} Visit https://mandate.horizonbase.app/eligibility with the same wallet.`, code: 'ELIGIBILITY_REQUIRED' }, 403);
  }
  await next();
};
export const eligibilityRoutes = new Hono<AuthEnv>();
eligibilityRoutes.get('/location', c => {
  const value = country(c.req.header('x-mandate-country'));
  const names = new Intl.DisplayNames(['en'], { type: 'region' });
  return c.json({ country: value ?? null, locationAllowed: permittedLocation(value), countries: [...countries].map(code => ({ code, name: names.of(code) ?? code })).sort((a, b) => a.name.localeCompare(b.name)) });
});
eligibilityRoutes.use('*', requireAccount);
eligibilityRoutes.get('/', c => c.json(eligibility.status(c.get('account'))));
eligibilityRoutes.delete('/', c => c.json(eligibility.withdraw(c.get('account'))));
eligibilityRoutes.post('/', async c => {
  const parsed = Declaration.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'Complete the eligibility declaration with a valid country.' }, 400);
  return c.json(eligibility.declare(c.get('account'), parsed.data, country(c.req.header('x-mandate-country'))));
});
