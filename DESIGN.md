---
name: Mandate
description: Dark native iPhone interface for delegated tokenized-stock trading inside a signed spending envelope.
colors:
  bg: "#0A0A0F"
  card: "#14141C"
  card-alt: "#1B1B26"
  border: "#262633"
  text: "#F2F2F7"
  muted: "#8B8B9E"
  faint: "#5A5A6E"
  base: "#0052FF"
  link: "#729FFF"
  base-soft: "#1A2C6B"
  green: "#22C55E"
  green-soft: "#12291D"
  red: "#EF4444"
  red-soft: "#3A1518"
  amber: "#F59E0B"
  amber-soft: "#2F2410"
  danger-bg: "#3A1518"
  white: "#FFFFFF"
  on-light: "#101114"
typography:
  hero: { fontSize: "40px", lineHeight: 1.15, fontWeight: 700, letterSpacing: "-1px" }
  display: { fontSize: "34px", lineHeight: 1.176, fontWeight: 700, letterSpacing: "-0.6px" }
  title: { fontSize: "22px", lineHeight: 1.273, fontWeight: 700, letterSpacing: "-0.3px" }
  section: { fontSize: "18px", lineHeight: 1.333, fontWeight: 600 }
  headline: { fontSize: "17px", lineHeight: 1.294, fontWeight: 600 }
  body: { fontSize: "15px", lineHeight: 1.4 }
  label: { fontSize: "13px", lineHeight: 1.385 }
  caption: { fontSize: "12px", lineHeight: 1.333 }
  badge: { fontSize: "12px", lineHeight: 1.333, fontWeight: 600 }
  button: { fontSize: "16px", fontWeight: 600 }
rounded:
  sm: "10px"
  input: "12px"
  md: "16px"
  lg: "22px"
  pill: "999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "20px"
  xxl: "24px"
  section: "28px"
  page-inset: "20px"
  card-inset: "16px"
  row-vertical: "14px"
  tab-bar-clearance: "110px"
components:
  button-primary: { backgroundColor: "{colors.base}", textColor: "{colors.text}", typography: "{typography.button}", rounded: "{rounded.md}", padding: "12px 20px" }
  button-ghost: { backgroundColor: "{colors.card-alt}", textColor: "{colors.text}", typography: "{typography.button}", rounded: "{rounded.md}", padding: "12px 20px" }
  button-danger: { backgroundColor: "{colors.danger-bg}", textColor: "{colors.red}", typography: "{typography.button}", rounded: "{rounded.md}", padding: "12px 20px" }
  button-link: { backgroundColor: "transparent", textColor: "{colors.link}", typography: "{typography.button}", rounded: "{rounded.md}", padding: "12px 20px" }
  card: { backgroundColor: "{colors.card}", textColor: "{colors.text}", rounded: "{rounded.md}", padding: "16px" }
  input: { backgroundColor: "{colors.card-alt}", textColor: "{colors.text}", rounded: "{rounded.input}", padding: "13px 14px" }
  chip: { backgroundColor: "{colors.card}", textColor: "{colors.muted}", rounded: "{rounded.pill}", padding: "8px 14px" }
  chip-active: { backgroundColor: "{colors.base-soft}", textColor: "{colors.text}", rounded: "{rounded.pill}", padding: "8px 14px" }
  badge: { backgroundColor: "{colors.card-alt}", textColor: "{colors.muted}", typography: "{typography.badge}", rounded: "{rounded.pill}", padding: "4px 9px" }
  badge-green: { backgroundColor: "{colors.green-soft}", textColor: "{colors.green}", typography: "{typography.badge}", rounded: "{rounded.pill}", padding: "4px 9px" }
  badge-amber: { backgroundColor: "{colors.amber-soft}", textColor: "{colors.amber}", typography: "{typography.badge}", rounded: "{rounded.pill}", padding: "4px 9px" }
  badge-red: { backgroundColor: "{colors.red-soft}", textColor: "{colors.red}", typography: "{typography.badge}", rounded: "{rounded.pill}", padding: "4px 9px" }
  badge-base: { backgroundColor: "{colors.base-soft}", textColor: "{colors.link}", typography: "{typography.badge}", rounded: "{rounded.pill}", padding: "4px 9px" }
  banner: { backgroundColor: "{colors.card-alt}", textColor: "{colors.text}", rounded: "{rounded.input}", padding: "11px 14px" }
  choice-row: { backgroundColor: "{colors.card-alt}", textColor: "{colors.text}", rounded: "14px", padding: "14px" }
  navigation: { backgroundColor: "{colors.card}", textColor: "{colors.link}" }
---

# Design System: Mandate

## Overview

Mandate is a native iPhone app in which a user signs a spending envelope (a USDC budget per period, a list of tokenized stocks, a risk preset, an expiry) and an AI agent trades inside it, either by proposing trades in chat or automatically. The interface is dark, tonal, and built from a small set of shared blocks so the same object reads the same on every screen: a mandate is always "$100 / week · Confirm in chat", a timestamp is always "2m ago" or "Sep 5, 2:42 AM", and execution mode is always "Simulation · no real funds" or "Live · real funds".

Source of truth: `lib/theme.ts` (tokens), `components/ui.tsx` (primitives), `components/app-ui.tsx` (page chrome, rows, banners, meter, sheets), `components/activity-ui.tsx` (activity events), `lib/ui-presentation.ts` (shared vocabulary, pinned by `scripts/ui-presentation.test.mjs`). Reviewed phone captures live in `.impeccable/review/rebuild-2026-09-07/` (default and accessibility-large text). The numeric lengths above serialize React Native logical points as portable CSS lengths. Typography is the iOS system family; no custom font is loaded.

Key characteristics:

- The envelope is drawn, not described: a `BudgetMeter` shows spent versus budget wherever a mandate appears.
- Status is tinted, sentence-case text: `Active`, `Pending`, `Needs review`, `Frozen`.
- One row anatomy for stocks, positions, orders, history and activity.
- High-stakes confirmations happen in native sheets that show the projected budget, never in a bare alert.
- Native bottom tabs, native stack headers, SF Symbols, native switches, alerts and sheets.

## Colors

Neutral: `bg` anchors screens, `card` groups content, `card-alt` distinguishes fields, secondary buttons and choice rows. `border` separates content with one-point or hairline lines. `text`, `muted` and `faint` are the text hierarchy.

Primary: `base` is Coinbase blue for filled actions, active switches and the Orders tab badge. `link` is the lighter blue for links, SF Symbols, native tab selection and informational badge text. `base-soft` backs selected chips, informational badges and banners.

Semantic: green is success or an active state, amber is a recoverable warning or a pending state, red is a failure or a destructive action, blue is informational. Each has a `-soft` surface for badges and banners so the hue reads at low opacity over `card`. Text always states the meaning alongside the color. `danger-bg` backs destructive buttons.

Identity exception: the Coinbase connection button on Welcome is `white` with `on-light` text.

## Typography

One family, tight steps. `hero` (40) is reserved for the single figure a screen is about: portfolio value, a mandate budget, an order amount. It never wraps: the `Amount` primitive caps Dynamic Type growth at 1.6× and shrinks to fit. `display` (34) is the page title on every tab and nested page. `title` (22) names a sheet's subject. `section` (18) heads a group of rows. `body` (15) and `label` (13, muted) carry content; `caption` (12, faint) carries footnotes. `badge` text is 12 semibold, sentence case.

Numbers use tabular figures (`Mono`, `Amount`). Section labels are sentence case; nothing is set in uppercase.

## Layout

Every screen is a single column with a 20-point gutter (`inset`), on tab pages and nested pages alike. Tab pages start at the top safe-area inset plus 12–16 points and reserve 110 points at the bottom for the floating native tab bar. Nested pages sit under a native bar that shows only the back chevron; the 34-point page title lives in content.

Vertical rhythm: 24 points between sections, 12 within a section, 14 above and below a list row, 16 inside a card. The dev preview banner is the first thing inside the gutter on every screen.

Sticky footers (New mandate, the composer) hold one action and cap their text at 1.3× so accessibility sizes leave room for content.

## Elevation & Depth

Tonal layering and borders only. Cards carry a one-point border on `card`; grouped rows clip at the card radius and divide with inset hairlines. Sheets, alerts, switches, the tab bar and its badge are native iOS materials and are never redrawn.

## Shapes

Cards, grouped rows and buttons use the medium radius (16). Inputs and banners use 12. Choice rows use 14. Chips, badges, the Agent context pill and progress tracks are fully rounded. Logos are squircles at 28% of their size.

The installed icon and the Home brand mark use `assets/mandate-icon.png`, the blue inverted-V silhouette. Welcome uses only the Mandate wordmark.

## Motion

Two authored moments, both state changes: the budget meter fills over 600 ms with an exponential ease-out when a mandate appears, and skeleton rows pulse while a list loads. Countdowns tick once per second only inside the component that shows them. No decorative motion.

## Components

- **Page / TabHeader / SectionHeader:** the page title block and section headings, with an optional trailing action (`+ New`).
- **ListRow:** leading logo or icon box (40), title, one- or two-line subtitle, right-aligned value and an optional badge under it, chevron when tappable. Used for stocks, positions, orders, history, activity and transaction steps.
- **Badge:** tinted status. `Pill` is a deprecated alias.
- **Banner:** inline notice with an icon and optional action; tone follows the semantic rule above. `PreviewBanner` and `ModeLine` are fixed-copy variants.
- **BudgetMeter:** "$15 of $100 this week · resets in 3d" over a 6-point track; amber above 80%, red at 100%; `after` projects a proposed trade.
- **Buttons:** primary, ghost, danger and link variants, 52 points tall (44 for the medium size). Pressed opacity 0.8, disabled 0.45, loading replaces the label with a spinner.
- **Chip / ChoiceRow:** chips for mutually exclusive small choices; choice rows (radio affordance, title plus detail) for decisions that need explanation.
- **Field:** label, control, hint or error. All text inputs share one treatment.
- **Sheet / ConfirmSheet:** native page sheet with a titled header and a pinned primary/secondary footer. Used for the Agent controls, trade confirmation, and the mandate review before signing.
- **EmptyState / SkeletonRows:** empty states teach the next step with an action; loading is a skeleton, never a string.
- **Navigation:** five native tabs (Home, Agent, Orders, History, Settings) with SF Symbol pairs and an Orders badge for open orders.

## Do's and Don'ts

- Do use `mandateTitle`, `modeLabel` and `whenLabel` for identity, mode and time; do not invent a second phrasing.
- Do keep simulation versus live in visible text next to any action that spends.
- Do keep Hide balances masking every amount, rationale and chat body.
- Do put a `PreviewBanner` first inside the gutter on every screen.
- Don't use `Alert` for financial confirmations; use `ConfirmSheet`. Alerts remain for errors, sign-out, discard guards and small destructive confirms.
- Don't add uppercase labels, outlined pills, kicker text above headings, or a colored left border on cards.
- Don't restore the rejected M badge or replace the Welcome wordmark with an icon.
- Don't open external links with `Linking`; use `lib/links.ts` for the in-app browser.
