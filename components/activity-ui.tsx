// One rendering of an Activity event, shared by History and Mandate detail.
import React from 'react';
import { StyleSheet, View } from 'react-native';
import type { Activity } from '@/lib/api';
import { colors, money } from '@/lib/theme';
import { activityAccessibilityLabel, activityLabels, activityTone, privateAccountText, whenLabel } from '@/lib/ui-presentation';
import { Badge, Logo, Muted } from './ui';
import { Icon, ListRow, type IconName } from './app-ui';

const kindIcon: Record<Activity['kind'], IconName> = {
  buy: 'arrow.down.circle', sell: 'arrow.up.circle', hold: 'checkmark.circle', error: 'exclamationmark.circle',
  approved: 'checkmark.shield', revoked: 'xmark.shield', queued: 'clock', cancelled: 'xmark.circle',
};

/** A run of consecutive "hold" decisions, collapsed to one row. */
export type ActivityGroup = { kind: 'holds'; id: string; count: number; first: number; last: number; mandateId: string };
export type ActivityItem = Activity | ActivityGroup;

/** Collapse consecutive hold rows so an overnight automatic mandate does not read as sixteen identical lines. */
export function collapseHolds(items: Activity[]): ActivityItem[] {
  const out: ActivityItem[] = [];
  for (const a of items) {
    const prev = out[out.length - 1];
    if (a.kind === 'hold' && prev && prev.kind === 'holds' && prev.mandateId === a.mandateId) {
      prev.count += 1; prev.last = Math.min(prev.last, a.ts); prev.first = Math.max(prev.first, a.ts);
    } else if (a.kind === 'hold') {
      out.push({ kind: 'holds', id: `holds-${a.id}`, count: 1, first: a.ts, last: a.ts, mandateId: a.mandateId });
    } else out.push(a);
  }
  // A lone hold reads better as itself.
  return out.map(item => item.kind === 'holds' && item.count === 1 ? items.find(a => `holds-${a.id}` === item.id)! : item);
}

export function ActivityRow({ item, hidden, onPress, first, meta }: {
  item: ActivityItem; hidden: boolean; onPress?: () => void; first?: boolean; meta?: string;
}) {
  if (item.kind === 'holds') {
    return (
      <ListRow first={first} onPress={onPress} chevron={false}
        leading={<View style={styles.icon}><Icon name="checkmark.circle" color={colors.muted} size={20} /></View>}
        title={`Checked ${item.count}× · no action`}
        subtitle={`${whenLabel(item.last)} – ${whenLabel(item.first)}`}
        accessibilityLabel={`Agent checked ${item.count} times with no action, from ${whenLabel(item.last)} to ${whenLabel(item.first)}`} />
    );
  }
  const a = item;
  const amount = a.amountUsd !== undefined ? (hidden ? '••••' : money(a.amountUsd)) : undefined;
  const detail = [
    a.qty !== undefined && !hidden ? `${a.qty.toFixed(4)} sh` : undefined,
    a.price !== undefined && !hidden ? `at ${money(a.price)}` : undefined,
  ].filter(Boolean).join(' · ');
  const tone = activityTone[a.kind];
  const iconColor = tone === 'muted' ? colors.muted : colors[tone === 'base' ? 'link' : tone];
  return (
    <ListRow first={first} onPress={onPress} chevron={!!onPress}
      accessibilityLabel={activityAccessibilityLabel(a, hidden)}
      leading={a.symbol
        ? <Logo symbol={a.symbol} size={40} />
        : <View style={styles.icon}><Icon name={kindIcon[a.kind]} color={iconColor} size={20} /></View>}
      title={`${activityLabels[a.kind]}${a.symbol ? ` ${a.symbol.replace(/c$/, '')}` : ''}`}
      subtitle={<View style={styles.lines}>
        <Muted numberOfLines={2}>{privateAccountText(a.rationale, hidden)}</Muted>
        <Muted style={styles.meta}>{[whenLabel(a.ts), meta, detail || undefined].filter(Boolean).join(' · ')}</Muted>
      </View>}
      value={amount}
      valueBelow={a.kind === 'error' ? <Badge text="Needs review" tone="red" /> : a.kind === 'queued' ? <Badge text="Pending" tone="amber" /> : undefined} />
  );
}

const styles = StyleSheet.create({
  icon: {
    width: 40, height: 40, borderRadius: 11, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border,
    alignItems: 'center', justifyContent: 'center',
  },
  lines: { gap: 3 },
  meta: { color: colors.faint },
});
