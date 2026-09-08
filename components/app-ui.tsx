// App-level building blocks composed from the primitives in ./ui.
// Page chrome, list rows, banners, the budget meter, fields, and the confirm sheet.
import React, { useEffect, useState, type ComponentProps } from 'react';
import { Image, Modal, Pressable, ScrollView, StyleSheet, View, type ScrollViewProps, type ViewProps } from 'react-native';
import { SymbolView } from 'expo-symbols';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, inset, money, radius, space, tabBarClearance, toneColor, toneSurface, type Tone } from '@/lib/theme';
import { budgetProgress, modeLabel, periodNoun, resetsLabel, type PeriodKey } from '@/lib/ui-presentation';
import { useWallet } from '@/lib/wallet';
import { Body, Button, Caption, H1, H2, Mono, Muted, ProgressBar, Skeleton } from './ui';

export type IconName = ComponentProps<typeof SymbolView>['name'];
type IconWeight = ComponentProps<typeof SymbolView>['weight'];

export function Icon({ name, size = 22, color = colors.muted, weight }: { name: IconName; size?: number; color?: string; weight?: IconWeight }) {
  return <SymbolView name={name} size={size} tintColor={color} weight={weight} style={{ width: size, height: size }} />;
}
export function BrandMark({ size = 44 }: { size?: number }) {
  return (
    <Image accessibilityLabel="Mandate logo" source={require('@/assets/mandate-icon.png')}
      style={{ width: size, height: size, borderRadius: size * 0.22 }} />
  );
}
export function CoinbaseLogo({ size = 26 }: { size?: number }) {
  return (
    <Image accessibilityLabel="Coinbase" source={require('@/assets/logos/COINc.png')}
      style={{ width: size, height: size, borderRadius: size * 0.25 }} />
  );
}

/** Ticks every `intervalMs`; use for countdowns and relative times. */
export function useNow(intervalMs = 1000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), intervalMs); return () => clearInterval(t); }, [intervalMs]);
  return now;
}

// ---- Page chrome -------------------------------------------------------------

type PageProps = ScrollViewProps & { title?: string; subtitle?: string; trailing?: React.ReactNode; nested?: boolean };

/** Scrolling page. Tab pages get the safe-area top; nested pages sit under the native back bar. */
export function Page({ title, subtitle, trailing, children, nested = false, contentContainerStyle, ...props }: PageProps) {
  const insets = useSafeAreaInsets();
  const padding = {
    paddingHorizontal: inset,
    paddingTop: nested ? space.sm : insets.top + space.lg,
    paddingBottom: nested ? insets.bottom + 30 : tabBarClearance,
    gap: space.xxl,
  };
  return (
    <ScrollView {...props} showsVerticalScrollIndicator={false} showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled"
      automaticallyAdjustKeyboardInsets style={styles.page} contentContainerStyle={[padding, contentContainerStyle]}>
      {title ? <TabHeader title={title} subtitle={subtitle} trailing={trailing} /> : null}
      {children}
    </ScrollView>
  );
}

/** Title block used at the top of every tab and nested page. */
export function TabHeader({ title, subtitle, trailing }: { title: string; subtitle?: string; trailing?: React.ReactNode }) {
  return (
    <View style={styles.header}>
      <View style={styles.headerText}>
        <H1 accessibilityRole="header">{title}</H1>
        {subtitle ? <Muted>{subtitle}</Muted> : null}
      </View>
      {trailing}
    </View>
  );
}

type SectionAction = { label: string; onPress: () => void; icon?: IconName };

export function SectionHeader({ title, caption, action, style }: { title: string; caption?: string; action?: SectionAction; style?: ViewProps['style'] }) {
  return (
    <View style={[styles.sectionHeader, style]}>
      <View style={styles.sectionTitle}>
        <H2 accessibilityRole="header">{title}</H2>
        {caption ? <Muted>{caption}</Muted> : null}
      </View>
      {action ? (
        <Pressable accessibilityRole="button" accessibilityLabel={action.label} onPress={action.onPress} hitSlop={8}
          style={({ pressed }) => [styles.sectionAction, pressed && { opacity: 0.7 }]}>
          {action.icon ? <Icon name={action.icon} size={15} color={colors.link} /> : null}
          <Body style={styles.sectionActionText}>{action.label}</Body>
        </Pressable>
      ) : null}
    </View>
  );
}

// ---- Rows --------------------------------------------------------------------

type ListRowProps = {
  leading?: React.ReactNode; title: string; subtitle?: string | React.ReactNode; value?: string; valueBelow?: React.ReactNode; trailing?: React.ReactNode;
  onPress?: () => void; chevron?: boolean; accessibilityLabel?: string; accessibilityHint?: string; first?: boolean;
};

/** One row anatomy for stocks, positions, orders, history and activity. */
export function ListRow({
  leading, title, subtitle, value, valueBelow, trailing, onPress, chevron = true, accessibilityLabel, accessibilityHint, first,
}: ListRowProps) {
  const content = (
    <>
      {leading}
      <View style={styles.listText}>
        <Body numberOfLines={2} style={styles.listTitle}>{title}</Body>
        {typeof subtitle === 'string' ? <Muted numberOfLines={2}>{subtitle}</Muted> : subtitle}
      </View>
      {value || valueBelow ? (
        <View style={styles.listValue}>
          {value ? <Mono style={styles.listValueText}>{value}</Mono> : null}
          {valueBelow}
        </View>
      ) : null}
      {trailing}
      {onPress && chevron ? <Icon name="chevron.right" size={13} color={colors.faint} /> : null}
    </>
  );
  const style = [styles.listRow, first && styles.listRowFirst];
  return onPress ? (
    <Pressable accessibilityRole="button" accessibilityLabel={accessibilityLabel} accessibilityHint={accessibilityHint} onPress={onPress}
      style={({ pressed }) => [style, pressed && { opacity: 0.6 }]}>
      {content}
    </Pressable>
  ) : (
    <View accessible={!!accessibilityLabel} accessibilityLabel={accessibilityLabel} style={style}>{content}</View>
  );
}

export function DetailRow({ label, value, tone, children }: { label: string; value?: string; tone?: Tone; children?: React.ReactNode }) {
  return (
    <View style={styles.detailRow}>
      <Muted style={styles.detailLabel}>{label}</Muted>
      {children ?? <Body style={[styles.detailValue, { color: tone ? toneColor[tone] : colors.text }]}>{value}</Body>}
    </View>
  );
}

type SettingRowProps = { icon: IconName; title: string; detail?: string; onPress?: () => void; trailing?: React.ReactNode; danger?: boolean };

export function SettingRow({ icon, title, detail, onPress, trailing, danger }: SettingRowProps) {
  const content = (
    <>
      <Icon name={icon} color={danger ? colors.red : colors.link} />
      <View style={styles.settingText}>
        <Body style={[styles.settingTitle, danger && styles.settingDanger]}>{title}</Body>
        {detail ? <Muted>{detail}</Muted> : null}
      </View>
      {trailing ?? (onPress ? <Icon name="chevron.right" size={13} color={colors.faint} /> : null)}
    </>
  );
  return onPress ? (
    <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [styles.setting, pressed && styles.settingPressed]}>{content}</Pressable>
  ) : (
    <View style={styles.setting}>{content}</View>
  );
}

type ChoiceRowProps = { selected: boolean; title: string; detail?: string; onPress: () => void; leading?: React.ReactNode; disabled?: boolean };

/** Selectable option with a radio affordance. */
export function ChoiceRow({ selected, title, detail, onPress, leading, disabled }: ChoiceRowProps) {
  return (
    <Pressable accessibilityRole="radio" accessibilityState={{ checked: selected, disabled: !!disabled }} onPress={onPress} disabled={disabled}
      style={({ pressed }) => [styles.choice, selected && styles.choiceSelected, pressed && { opacity: 0.8 }, disabled && { opacity: 0.45 }]}>
      {leading}
      <View style={styles.choiceText}>
        <Body style={styles.choiceTitle}>{title}</Body>
        {detail ? <Muted>{detail}</Muted> : null}
      </View>
      <Icon name={selected ? 'checkmark.circle.fill' : 'circle'} color={selected ? colors.link : colors.faint} size={22} />
    </Pressable>
  );
}

export function SkeletonRows({ count = 3, leading = true }: { count?: number; leading?: boolean }) {
  return (
    <View accessibilityLabel="Loading" accessible>
      {Array.from({ length: count }).map((_, i) => (
        <View key={i} style={[styles.listRow, i === 0 && styles.listRowFirst]}>
          {leading ? <Skeleton width={40} height={40} radius={11} /> : null}
          <View style={styles.skeletonText}><Skeleton width="55%" height={14} /><Skeleton width="35%" height={12} /></View>
          <Skeleton width={64} height={14} />
        </View>
      ))}
    </View>
  );
}

// ---- Status surfaces ---------------------------------------------------------

type BannerProps = {
  tone?: Tone; icon?: IconName; text: string; action?: { label: string; onPress: () => void }; onPress?: () => void; live?: boolean;
};

/** Inline notice. Tone carries the severity; text always says it too. */
export function Banner({ tone = 'muted', icon, text, action, onPress, live }: BannerProps) {
  const c = toneColor[tone];
  const alert = tone === 'amber' || tone === 'red';
  const content = (
    <>
      {icon ? <Icon name={icon} size={18} color={c} /> : null}
      <Body accessibilityLiveRegion={live ? 'polite' : undefined} accessibilityRole={alert ? 'alert' : undefined}
        style={[styles.bannerText, { color: tone === 'muted' ? colors.text : c }]}>
        {text}
      </Body>
      {action ? (
        <Pressable accessibilityRole="button" accessibilityLabel={action.label} onPress={action.onPress} hitSlop={8} style={styles.bannerAction}>
          <Body style={styles.bannerActionText}>{action.label}</Body>
        </Pressable>
      ) : null}
      {onPress && !action ? <Icon name="chevron.right" size={13} color={c} /> : null}
    </>
  );
  const style = [styles.banner, { backgroundColor: toneSurface[tone] }];
  return onPress ? (
    <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [style, pressed && { opacity: 0.8 }]}>{content}</Pressable>
  ) : (
    <View style={style}>{content}</View>
  );
}

/** Dev preview notice. Render once per screen, at the top of the page inset. */
export function PreviewBanner() {
  const address = useWallet(s => s.address);
  if (!__DEV__ || address?.toLowerCase() !== '0x000000000000000000000000000000000000dead') return null;
  return <Banner tone="amber" icon="eye" text="Preview · sample data · no real transactions" />;
}

/** Execution mode, phrased exactly one way everywhere. */
export function ModeLine({ dryRun, style }: { dryRun: boolean | undefined; style?: ViewProps['style'] }) {
  const tone: Tone = dryRun === undefined ? 'muted' : dryRun ? 'amber' : 'green';
  return (
    <View style={[styles.mode, style]}>
      <View style={[styles.modeDot, { backgroundColor: toneColor[tone] }]} />
      <Muted>{modeLabel(dryRun)}</Muted>
    </View>
  );
}

type BudgetMeterProps = {
  budget: number; spent?: number; period: PeriodKey; periodStart?: number; hidden: boolean; compact?: boolean; after?: number;
};

/** The envelope: spent vs budget for the current period. */
export function BudgetMeter({ budget, spent = 0, period, periodStart, hidden, compact, after }: BudgetMeterProps) {
  const p = budgetProgress(budget, spent);
  const projected = after !== undefined ? budgetProgress(budget, spent + after) : undefined;
  const fraction = projected ? projected.fraction : p.fraction;
  const tone: Tone = fraction >= 1 ? 'red' : fraction >= 0.8 ? 'amber' : 'base';
  const resets = resetsLabel(periodStart, period);
  const label = hidden ? 'Budget hidden'
    : projected ? `${money(projected.spent, 0)} of ${money(budget, 0)} after this trade`
    : `${money(p.spent, 0)} of ${money(budget, 0)} this ${periodNoun[period]}`;
  const accessibilityLabel = hidden ? `Budget usage hidden, per ${periodNoun[period]}` : `${label}${resets ? `, ${resets}` : ''}`;
  return (
    <View accessible accessibilityLabel={accessibilityLabel} style={{ gap: compact ? 6 : 8 }}>
      <View style={styles.meterLine}>
        {compact ? <Muted style={styles.shrink}>{label}</Muted> : <Mono style={[styles.meterLabel, styles.shrink]}>{label}</Mono>}
        {!compact && !hidden ? <Muted>{resets ?? `${money(p.remaining, 0)} left`}</Muted> : null}
      </View>
      <ProgressBar value={hidden ? 0 : fraction} tone={tone} height={compact ? 4 : 6} />
    </View>
  );
}

export function EmptyState({ icon, title, message, children }: { icon: IconName; title: string; message: string; children?: React.ReactNode }) {
  return (
    <View style={styles.empty}>
      <View style={styles.emptyIcon}><Icon name={icon} size={26} color={colors.link} /></View>
      <Body style={styles.emptyTitle}>{title}</Body>
      <Muted style={styles.emptyMessage}>{message}</Muted>
      {children ? <View style={styles.emptyActions}>{children}</View> : null}
    </View>
  );
}

// ---- Forms -------------------------------------------------------------------

type FieldProps = { label: string; hint?: string; error?: string; trailing?: React.ReactNode; children: React.ReactNode };

export function Field({ label, hint, error, trailing, children }: FieldProps) {
  return (
    <View style={styles.field}>
      <View style={styles.fieldHead}>
        <Body style={styles.fieldLabel}>{label}</Body>
        {trailing}
      </View>
      {children}
      {error ? <Muted accessibilityRole="alert" style={styles.fieldError}>{error}</Muted> : hint ? <Muted>{hint}</Muted> : null}
    </View>
  );
}

// ---- Confirmation sheet -----------------------------------------------------

type SheetProps = {
  visible: boolean; onClose: () => void; title: string; subtitle?: string; children: React.ReactNode; footer?: React.ReactNode; closeLabel?: string;
  inline?: boolean;
};

/** Native page sheet with a titled header and optional pinned footer. */
export function Sheet({ visible, onClose, title, subtitle, children, footer, closeLabel = 'Close', inline = false }: SheetProps) {
  const insets = useSafeAreaInsets();
  const content = (
      <View style={styles.sheet}>
        <View style={styles.sheetHeader}>
          <View style={styles.sectionTitle}>
            <H2 accessibilityRole="header">{title}</H2>
            {subtitle ? <Muted>{subtitle}</Muted> : null}
          </View>
          <Pressable accessibilityRole="button" accessibilityLabel={closeLabel} onPress={onClose} hitSlop={8} style={styles.sheetClose}>
            <Icon name="xmark" size={15} color={colors.text} weight="semibold" />
          </Pressable>
        </View>
        <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled"
          contentContainerStyle={[styles.sheetContent, { paddingBottom: footer ? space.xl : insets.bottom + space.xxl }]}>
          {children}
        </ScrollView>
        {footer ? <View style={[styles.sheetFooter, { paddingBottom: Math.max(insets.bottom, 12) + 4 }]}>{footer}</View> : null}
      </View>
  );
  // A wallet review already lives in a stack modal. Render within it so an
  // ASWebAuthenticationSession never competes with a second presented modal.
  if (inline) return visible ? content : null;
  return <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>{content}</Modal>;
}

type ConfirmSheetProps = {
  visible: boolean; onClose: () => void; title: string; subtitle?: string; children: React.ReactNode;
  primary: { label: string; onPress: () => void; loading?: boolean; disabled?: boolean; variant?: 'primary' | 'danger' };
  secondaryLabel?: string; footnote?: string;
  inline?: boolean;
  notice?: React.ReactNode;
};

/** Sheet for high-stakes confirmations. Replaces Alert for financial actions. */
export function ConfirmSheet({ visible, onClose, title, subtitle, children, primary, secondaryLabel = 'Keep reviewing', footnote, inline, notice }: ConfirmSheetProps) {
  const footer = (
    <>
      {notice}
      {footnote ? <Caption style={styles.footnote}>{footnote}</Caption> : null}
      <Button title={primary.label} onPress={primary.onPress} loading={primary.loading} disabled={primary.disabled} variant={primary.variant ?? 'primary'} />
      <Button title={secondaryLabel} onPress={onClose} variant="ghost" />
    </>
  );
  return <Sheet inline={inline} visible={visible} onClose={onClose} title={title} subtitle={subtitle} footer={footer}>{children}</Sheet>;
}

export const appStyles = StyleSheet.create({
  group: { backgroundColor: colors.card, borderRadius: radius.md, overflow: 'hidden', borderWidth: 1, borderColor: colors.border },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginLeft: 50 },
  input: {
    minHeight: 50, backgroundColor: colors.cardAlt, borderRadius: radius.input, color: colors.text, fontSize: 16,
    paddingHorizontal: 14, paddingVertical: 13, borderWidth: 1, borderColor: colors.border,
  },
  inputMultiline: { minHeight: 112, paddingTop: 13, textAlignVertical: 'top' },
  section: { gap: space.md },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
});

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.bg },
  header: { flexDirection: 'row', alignItems: 'flex-start', gap: space.md },
  headerText: { flex: 1, gap: 4, minWidth: 0 },
  sectionHeader: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: space.md },
  sectionTitle: { flex: 1, gap: 2, minWidth: 0 },
  sectionAction: { flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 32, paddingVertical: 4 },
  sectionActionText: { color: colors.link, fontWeight: '600' },
  listRow: {
    flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: 14,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border,
  },
  listRowFirst: { borderTopWidth: 0 },
  listText: { flex: 1, minWidth: 0, gap: 3 },
  listTitle: { fontWeight: '600' },
  // The value column keeps its natural width so a long title yields first; 45% still caps a very long amount.
  listValue: { alignItems: 'flex-end', gap: 5, maxWidth: '45%', flexShrink: 0 },
  listValueText: { fontWeight: '600' },
  skeletonText: { flex: 1, gap: 8 },
  detailRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: space.md, paddingVertical: 6 },
  detailLabel: { flexShrink: 0 },
  detailValue: { fontVariant: ['tabular-nums'], flexShrink: 1, textAlign: 'right' },
  setting: { flexDirection: 'row', alignItems: 'center', minHeight: 64, paddingHorizontal: 16, paddingVertical: 12, gap: 14 },
  settingPressed: { backgroundColor: colors.cardAlt },
  settingText: { flex: 1, gap: 3 },
  settingTitle: { fontWeight: '500' },
  settingDanger: { color: colors.red },
  choice: {
    flexDirection: 'row', alignItems: 'center', gap: space.md, padding: 14, borderRadius: 14, minHeight: 60,
    backgroundColor: colors.cardAlt, borderWidth: 1, borderColor: colors.border,
  },
  choiceSelected: { borderColor: colors.link, backgroundColor: colors.card },
  choiceText: { flex: 1, gap: 3, minWidth: 0 },
  choiceTitle: { fontWeight: '600' },
  banner: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 11, borderRadius: radius.input },
  bannerText: { flex: 1, fontSize: 14, lineHeight: 20 },
  bannerAction: { minHeight: 32, justifyContent: 'center' },
  bannerActionText: { color: colors.link, fontWeight: '600', fontSize: 14 },
  mode: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  modeDot: { width: 7, height: 7, borderRadius: 4 },
  meterLine: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 },
  meterLabel: { fontWeight: '600' },
  shrink: { flexShrink: 1 },
  empty: { paddingVertical: 36, alignItems: 'center', gap: 12 },
  emptyIcon: {
    width: 56, height: 56, borderRadius: 18, backgroundColor: colors.card, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: colors.border,
  },
  emptyTitle: { fontSize: 19, fontWeight: '600', textAlign: 'center' },
  emptyMessage: { textAlign: 'center', maxWidth: 300 },
  emptyActions: { marginTop: 6, alignSelf: 'stretch', gap: 10 },
  field: { gap: 8 },
  fieldHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  fieldLabel: { fontWeight: '600' },
  fieldError: { color: colors.amber },
  sheet: { flex: 1, backgroundColor: colors.bg },
  sheetHeader: {
    flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: inset, paddingTop: 18, paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border,
  },
  sheetClose: { width: 32, height: 32, borderRadius: 16, backgroundColor: colors.cardAlt, alignItems: 'center', justifyContent: 'center' },
  sheetContent: { padding: inset, gap: space.xl },
  sheetFooter: {
    paddingHorizontal: inset, paddingTop: 12, gap: 10, backgroundColor: colors.bg,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border,
  },
  footnote: { textAlign: 'center', color: colors.muted },
});
