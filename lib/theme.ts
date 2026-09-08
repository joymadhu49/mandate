// Mandate design tokens. Dark tonal surfaces, Coinbase blue actions, system type.
// Source of truth for DESIGN.md. Screen-local exceptions stay local.

export const colors = {
  bg: '#0A0A0F',
  card: '#14141C',
  cardAlt: '#1B1B26',
  border: '#262633',
  text: '#F2F2F7',
  muted: '#8B8B9E',
  faint: '#5A5A6E',
  base: '#0052FF',
  link: '#729FFF',
  baseSoft: '#1A2C6B',
  green: '#22C55E',
  red: '#EF4444',
  amber: '#F59E0B',
  // Tinted surfaces for badges and banners: the semantic hue at low opacity over `card`.
  greenSoft: '#12291D',
  redSoft: '#3A1518',
  amberSoft: '#2F2410',
  dangerBg: '#3A1518',
  overlay: 'rgba(10, 10, 15, 0.6)',
  // Identity exception: the white Coinbase connection button on Welcome.
  white: '#FFFFFF',
  onLight: '#101114',
};

export const radius = { sm: 10, md: 16, lg: 22, input: 12, pill: 999 };

// Spacing scale (logical points). `inset` is the page gutter on every screen.
export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 24, section: 28 };
export const inset = 20;
// Tab screens reserve room for the floating native tab bar.
export const tabBarClearance = 110;

// Type scale: one family (system), tight steps.
export const type = {
  display: { fontSize: 34, lineHeight: 40, fontWeight: '700' as const, letterSpacing: -0.6 },
  hero: { fontSize: 40, lineHeight: 46, fontWeight: '700' as const, letterSpacing: -1 },
  title: { fontSize: 22, lineHeight: 28, fontWeight: '700' as const, letterSpacing: -0.3 },
  section: { fontSize: 18, lineHeight: 24, fontWeight: '600' as const },
  headline: { fontSize: 17, lineHeight: 22, fontWeight: '600' as const },
  body: { fontSize: 15, lineHeight: 21, fontWeight: '400' as const },
  label: { fontSize: 13, lineHeight: 18, fontWeight: '400' as const },
  caption: { fontSize: 12, lineHeight: 16, fontWeight: '400' as const },
};

export type Tone = 'muted' | 'green' | 'red' | 'amber' | 'base';

export const toneColor: Record<Tone, string> = {
  muted: colors.muted, green: colors.green, red: colors.red, amber: colors.amber, base: colors.link,
};
export const toneSurface: Record<Tone, string> = {
  muted: colors.cardAlt, green: colors.greenSoft, red: colors.redSoft, amber: colors.amberSoft, base: colors.baseSoft,
};

export const money = (n: number, digits = 2) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: digits });

export const pct = (n: number) => `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`;

export const timeAgo = (unix: number) => {
  const s = Math.max(0, Math.floor(Date.now() / 1000 - unix));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
};
