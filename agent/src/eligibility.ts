import { z } from 'zod';
import { config } from './config.js';
import { atomicWriteJson, loadValidatedJson } from './persistence.js';

export const ELIGIBILITY_VERSION = '2026-09-08';
export const LOCATION_TTL = 24 * 3600_000;
export const DECLARATION_TTL = 30 * 24 * 3600_000;
// U.S. territories are excluded conservatively. Other jurisdiction restrictions
// require the owner's declaration; this is not identity or residency verification.
const excluded = new Set(['US', 'AS', 'GU', 'MP', 'PR', 'UM', 'VI']);
export const countries = new Set('AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW'.split(' '));
export const validCountry = (value: string | undefined): value is string => !!value && countries.has(value);
export const permittedLocation = (value: string | undefined) => validCountry(value) && !excluded.has(value);
export const Declaration = z.object({
  version: z.literal(ELIGIBILITY_VERSION), residenceCountry: z.string().refine(validCountry),
  nonUsPerson: z.boolean(), eligibleJurisdiction: z.boolean(), accurate: z.boolean(),
}).strict();
const Record = z.object({
  declaration: Declaration.optional(), declaredAt: z.number().optional(),
  country: z.string().optional(), observedAt: z.number().optional(),
  // A restricted/unknown observation invalidates the prior declaration, even if
  // another browser or session later connects from an allowed country.
  needsRenewal: z.boolean(),
}).strict();
type Entry = z.infer<typeof Record>;
export class EligibilityError extends Error {
  constructor(message: string) { super(message); }
}
export class EligibilityStore {
  constructor(private read: () => { [account: string]: Entry }, private write: (data: { [account: string]: Entry }) => void, private clock = Date.now) {}
  observe(account: string, country: string | undefined) {
    const all = this.read(); const key = account.toLowerCase(); const old = all[key] ?? { needsRenewal: true };
    const normalized = validCountry(country) ? country : undefined;
    // Avoid a durable write for every poll, while never delaying a restriction.
    if (old.country === normalized && this.clock() - (old.observedAt ?? 0) < 60_000) return;
    this.write({ ...all, [key]: { ...old, country: normalized, observedAt: this.clock(), needsRenewal: old.needsRenewal || !permittedLocation(normalized) } });
  }
  declare(account: string, input: unknown, country: string | undefined) {
    const declaration = Declaration.parse(input);
    const all = this.read(); const key = account.toLowerCase();
    const accepted = permittedLocation(country) && permittedLocation(declaration.residenceCountry) && declaration.nonUsPerson && declaration.eligibleJurisdiction && declaration.accurate;
    this.write({ ...all, [key]: { declaration, declaredAt: this.clock(), country: validCountry(country) ? country : undefined, observedAt: this.clock(), needsRenewal: !accepted } });
    console.info(accepted ? 'eligibility_declared' : 'eligibility_denied');
    return this.status(account);
  }
  withdraw(account: string) {
    const all = this.read(); const key = account.toLowerCase();
    this.write({ ...all, [key]: { ...all[key], declaration: undefined, declaredAt: undefined, needsRenewal: true } });
    console.info('eligibility_withdrawn');
    return this.status(account);
  }
  status(account?: string) {
    const entry = account ? this.read()[account.toLowerCase()] : undefined;
    const d = entry?.declaration;
    const locationFresh = !!entry?.observedAt && this.clock() < entry.observedAt + LOCATION_TTL;
    const declarationFresh = !!entry?.declaredAt && this.clock() < entry.declaredAt + DECLARATION_TTL;
    const allowed = !!(locationFresh && declarationFresh && !entry?.needsRenewal && permittedLocation(entry?.country) && d?.version === ELIGIBILITY_VERSION && permittedLocation(d.residenceCountry) && d.nonUsPerson && d.eligibleJurisdiction && d.accurate);
    const reason = allowed ? 'Trading access confirmed. Open Mandate at least once every 24 hours to keep automatic trading enabled.'
      : !locationFresh ? 'Open Mandate to refresh your location check before trading.'
      : !permittedLocation(entry?.country) ? 'Trading is unavailable in the United States and its territories, or when your location cannot be verified.'
      : 'Confirm your eligibility before trading. Existing automatic mandates are paused until you do.';
    return { allowed, reason, version: ELIGIBILITY_VERSION, country: entry?.country ?? null, residenceCountry: d?.residenceCountry ?? null, expiresAt: allowed ? Math.min(entry!.observedAt! + LOCATION_TTL, entry!.declaredAt! + DECLARATION_TTL) : null };
  }
  assert(account: string) { const status = this.status(account); if (!status.allowed) throw new EligibilityError(status.reason); }
}
const path = () => `${config.dbPath}.eligibility.json`;
export const eligibility = new EligibilityStore(
  () => loadValidatedJson(path(), z.record(Record), {}),
  data => atomicWriteJson(path(), data),
);

// Restrict execution paths, not portfolio reads, sign-in, cancellation or revocation.
export function requiresTradingEligibility(method: string, path: string) {
  if (/^\/test-swap(?:\/|$)/.test(path)) return true;
  return method === 'POST' && (path === '/mandates' || /^\/mandates\/[^/]+\/(?:run|permissions)$/.test(path) || /^\/chat\/proposals\/[^/]+\/confirm$/.test(path));
}
