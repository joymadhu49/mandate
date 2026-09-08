// Market clock for the top of Home: what the feeds are doing right now and when that changes.
// Ticks once per second inside this component only, so the rest of the screen stays still.
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { colors, radius, space, toneSurface } from '@/lib/theme';
import { localTimeLabel, longCountdownLabel, marketIsOpen, newYorkTimeLabel, nextMarketClose, nextMarketOpen } from '@/lib/ui-presentation';
import { Caption, Mono, Muted } from './ui';
import { Icon, useNow } from './app-ui';

export function MarketStatus({ anyStale, quotesReady }: { anyStale: boolean; quotesReady: boolean }) {
  const now = useNow(1000);
  const open = marketIsOpen(now);
  const target = open ? nextMarketClose(now) ?? nextMarketOpen(now) : nextMarketOpen(now);
  const staleWhileOpen = open && anyStale && quotesReady;
  const tone = staleWhileOpen ? 'amber' : open ? 'green' : 'amber';
  const title = staleWhileOpen ? 'Market open · feeds stale' : open ? 'US markets open' : 'US markets closed';
  const verb = open ? 'Closes in' : 'Reopens in';
  const when = `${newYorkTimeLabel(target)} · ${localTimeLabel(target)} your time`;
  const label = `${title}. ${verb} ${longCountdownLabel(target, now)}. ${when}.`;
  return (
    <View accessible accessibilityRole="timer" accessibilityLabel={label} style={[styles.card, { backgroundColor: toneSurface[tone] }]}>
      <View style={styles.iconBox}><Icon name={open ? 'chart.line.uptrend.xyaxis' : 'clock'} size={20} color={colors[tone]} /></View>
      <View style={styles.text}>
        <Muted style={{ color: colors[tone], fontWeight: '600' }}>{title}</Muted>
        <View style={styles.countdownRow}>
          <Muted>{verb}</Muted>
          <Mono style={styles.countdown}>{longCountdownLabel(target, now)}</Mono>
        </View>
        <Caption>{when}{open ? '' : ' · trades wait for a fresh price'}</Caption>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: 14, paddingVertical: 12, borderRadius: radius.input },
  iconBox: { width: 36, height: 36, borderRadius: 10, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center', opacity: 0.85 },
  text: { flex: 1, gap: 3, minWidth: 0 },
  countdownRow: { flexDirection: 'row', alignItems: 'baseline', gap: 6, flexWrap: 'wrap' },
  countdown: { fontSize: 20, fontWeight: '700', letterSpacing: -0.3 },
});
