import type { TestContext } from 'node:test';

/** Existing execution tests supply an eligible owner so they can isolate their
 * original price, permission and transaction checks. Real eligibility enforcement
 * is exercised separately by src/eligibility.test.ts, without this fixture. */
export async function eligibleOwnerFixture(t: TestContext) {
  const { eligibility, ELIGIBILITY_VERSION } = await import('../src/eligibility.js');
  t.mock.method(eligibility, 'status', () => ({ allowed: true, reason: 'Eligible test owner', version: ELIGIBILITY_VERSION, country: 'DE', residenceCountry: 'DE', expiresAt: Date.now() + 3600_000 }));
}
