// Pieces shared by Home and Mandate detail: the mandate row, "what happens next" copy,
// and the one way to open a mandate in the Agent tab.
import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import type { useRouter } from 'expo-router';
import type { Mandate } from '@/lib/api';
import { stockByToken } from '@/lib/stocks';
import { colors, radius, space } from '@/lib/theme';
import { mandateAccessibilityLabel, mandateStatusLabel, mandateStatusTone, mandateTitle, whenLabel } from '@/lib/ui-presentation';
import { Badge, Body, Button, LogoStack, Muted } from './ui';
import { BudgetMeter } from './app-ui';

/** Mandates that still need the user's attention on Home; revoked and expired ones live in History. */
export const isOpenMandate = (m: Pick<Mandate, 'status'>) => m.status === 'active' || m.status === 'pending' || m.status === 'error';

/** Known tickers in a mandate's universe, in universe order. Unknown tokens are skipped. */
export function mandateSymbols(m: Pick<Mandate, 'universe'>) {
  return m.universe.map(t => stockByToken(t)?.symbol).filter((s): s is string => !!s);
}

/** One line on what happens next for this mandate. Status problems outrank the control mode. */
/** The backend runs one mode at a time; a mandate created in the other mode waits (it can still be revoked). */
export function mandatePaused(m: Pick<Mandate, 'executionMode'>, backendDryRun: boolean | undefined) {
  if (backendDryRun === undefined || !m.executionMode) return false;
  return (m.executionMode === 'simulation') !== backendDryRun;
}

export function mandateNextStep(m: Pick<Mandate, 'status' | 'control' | 'lastRunAt' | 'executionMode'>, now = Date.now(), paused = false) {
  if (paused) return `Paused · created in ${m.executionMode === 'live' ? 'live mode' : 'simulation'}`;
  if (m.status === 'pending') return 'Activating…';
  if (m.status === 'error') return 'Needs manual review';
  if (m.control === 'chat') return 'Confirm each trade in chat';
  return m.lastRunAt ? `Last run ${whenLabel(m.lastRunAt, now)}` : 'First run soon';
}

/** Selects a mandate in the Agent tab. The nonce makes the same id re-apply on a repeat tap. */
export function openMandateChat(router: ReturnType<typeof useRouter>, mandateId: string) {
  router.navigate({ pathname: '/(tabs)/agent', params: { mandateId, nonce: String(Date.now()) } });
}

/** Card-like row for the Home list: identity, status, universe, envelope, next step, and a chat shortcut. */
export const MandateRow = React.memo(function MandateRow({ m, hidden, paused = false, onPress, onChat }: {
  m: Mandate; hidden: boolean; paused?: boolean; onPress: () => void; onChat?: () => void;
}) {
  const symbols = mandateSymbols(m);
  const chat = m.control === 'chat' && !paused ? onChat : undefined;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={mandateAccessibilityLabel(m, symbols, hidden)}
      // The nested Chat button is grouped away by VoiceOver; expose it as a custom action instead.
      accessibilityActions={chat ? [{ name: 'chat', label: 'Open chat' }] : undefined}
      onAccessibilityAction={chat ? e => { if (e.nativeEvent.actionName === 'chat') chat(); } : undefined}
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
    >
      <View style={styles.titleLine}>
        <Body numberOfLines={2} style={styles.title}>{mandateTitle(m, hidden)}</Body>
        <Badge text={paused ? 'Paused' : mandateStatusLabel[m.status]} tone={paused ? 'muted' : mandateStatusTone[m.status]} />
      </View>
      {symbols.length ? <LogoStack symbols={symbols} size={24} /> : null}
      <BudgetMeter compact budget={m.budgetUsdc} spent={m.spentThisPeriod} period={m.period} periodStart={m.periodStart} hidden={hidden} />
      <View style={styles.footer}>
        <Muted style={styles.next}>{mandateNextStep(m, Date.now(), paused)}</Muted>
        {chat ? <Button title="Chat" variant="ghost" size="md" onPress={chat} accessibilityHint="Opens the Agent tab with this mandate selected" /> : null}
      </View>
    </Pressable>
  );
});

const styles = StyleSheet.create({
  row: { backgroundColor: colors.card, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: 14, gap: space.md },
  pressed: { backgroundColor: colors.cardAlt },
  titleLine: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.sm },
  title: { fontWeight: '600', flexShrink: 1 },
  footer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.md, minHeight: 24 },
  next: { flexShrink: 1 },
});
