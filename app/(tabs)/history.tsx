import React, { useMemo, useState } from 'react';
import { FlatList, RefreshControl, StyleSheet, View } from 'react-native';
import { useIsFocused, useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { AccountFeed, usePullToRefresh } from '@/components/account-feed';
import { ActivityRow, collapseHolds, type ActivityItem } from '@/components/activity-ui';
import { Banner, EmptyState, SkeletonRows, appStyles, useNow, type IconName } from '@/components/app-ui';
import { Button, Chip, Muted } from '@/components/ui';
import { api, type Activity } from '@/lib/api';
import { useWallet } from '@/lib/wallet';
import { usePreferences } from '@/lib/preferences';
import { colors, space, tabBarClearance } from '@/lib/theme';
import { mandateTitle, whenLabel } from '@/lib/ui-presentation';

type Filter = 'all' | 'trades' | 'decisions' | 'account';
const filters: { key: Filter; label: string }[] = [
  { key: 'all', label: 'All' }, { key: 'trades', label: 'Trades' }, { key: 'decisions', label: 'Decisions' }, { key: 'account', label: 'Account' },
];
const kinds: Record<Exclude<Filter, 'all'>, Activity['kind'][]> = {
  trades: ['buy', 'sell'], decisions: ['hold', 'error', 'queued', 'cancelled'], account: ['approved', 'revoked'],
};
const emptyCopy: Record<Filter, { icon: IconName; title: string; message: string }> = {
  all: {
    icon: 'clock.arrow.circlepath', title: 'No activity yet',
    message: 'Decisions, trades and approvals appear here.',
  },
  trades: { icon: 'arrow.left.arrow.right', title: 'No trades yet', message: 'Completed buys and sells appear here. Pending orders are in the Orders tab.' },
  decisions: { icon: 'checkmark.circle', title: 'No decisions yet', message: 'Agent checks, orders and errors appear here.' },
  account: { icon: 'checkmark.shield', title: 'No account events yet', message: 'Spending approvals and mandate revocations appear here.' },
};

export default function History() {
  return (
    <AccountFeed title="History" subtitle="Decisions, trades and approvals.">
      <HistoryList />
    </AccountFeed>
  );
}

/** Runs of holds collapse only where holds are shown; trades and account events stay one per line. */
function visibleActivity(items: Activity[], filter: Filter): ActivityItem[] {
  const shown = filter === 'all' ? items : items.filter(a => kinds[filter].includes(a.kind));
  return filter === 'all' || filter === 'decisions' ? collapseHolds(shown) : shown;
}

function HistoryList() {
  const address = useWallet(s => s.address)!;
  const router = useRouter();
  const focused = useIsFocused();
  const hidden = usePreferences(s => s.hideBalances);
  const [filter, setFilter] = useState<Filter>('all');
  const activity = useQuery({ queryKey: ['activity', address], queryFn: () => api.activity(address), refetchInterval: focused ? 30_000 : false });
  const mandates = useQuery({ queryKey: ['mandates', address], queryFn: () => api.mandates(address) });
  const data = useMemo(() => visibleActivity(activity.data ?? [], filter), [activity.data, filter]);
  // Each row names its mandate the same way Home and Mandate detail do; budget masked with balances.
  const titles = useMemo(
    () => new Map((mandates.data ?? []).map((m): [string, string] => [m.id, mandateTitle(m, hidden, 'short')])),
    [mandates.data, hidden],
  );
  const minute = useNow(60_000);
  const extra = useMemo(() => ({ minute, hidden, titles }), [minute, hidden, titles]);
  const { refreshing, onRefresh } = usePullToRefresh(activity.refetch);
  const hasMandate = (mandates.data?.length ?? 0) > 0;
  const copy = emptyCopy[filter];

  const empty = activity.isPending ? <SkeletonRows count={4} />
    : activity.isError && !activity.data ? (
      <EmptyState icon="wifi.exclamationmark" title="History unavailable" message={activity.error.message}>
        <Button title="Retry" variant="ghost" onPress={() => activity.refetch()} />
      </EmptyState>
    ) : (
      <EmptyState icon={copy.icon} title={copy.title} message={copy.message}>
        {filter !== 'all' && activity.data?.length
          ? <Button title="Show all activity" variant="ghost" onPress={() => setFilter('all')} />
          : filter === 'all' && hasMandate
            ? <Button title="Ask the agent" onPress={() => router.navigate('/(tabs)/agent')} />
            : filter === 'all'
              ? <Button title="Create a mandate" onPress={() => router.push('/new-mandate')} />
              : null}
      </EmptyState>
    );

  return (
    <FlatList
      data={data}
      keyExtractor={item => item.id}
      extraData={extra}
      showsVerticalScrollIndicator={false}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.muted} />}
      ListHeaderComponent={
        <View style={styles.header}>
          <View accessibilityRole="tablist" accessibilityLabel="Show" style={appStyles.wrap}>
            {filters.map(f => <Chip key={f.key} label={f.label} active={filter === f.key} onPress={() => setFilter(f.key)} />)}
          </View>
          {activity.isError && activity.data ? (
            <Banner tone="muted" icon="wifi.exclamationmark" action={{ label: 'Retry', onPress: () => activity.refetch() }}
              text={`Could not refresh · showing activity last updated ${whenLabel(Math.floor(activity.dataUpdatedAt / 1000))}`} />
          ) : null}
        </View>
      }
      ListEmptyComponent={empty}
      ListFooterComponent={(activity.data?.length ?? 0) >= 500 ? <Muted style={styles.footer}>Showing the latest 500 events.</Muted> : null}
      renderItem={({ item, index }) => (
        <ActivityRow item={item} hidden={hidden} first={index === 0} meta={titles.get(item.mandateId)}
          onPress={() => router.push(`/mandate/${item.mandateId}`)} />
      )}
    />
  );
}

const styles = StyleSheet.create({
  content: { paddingBottom: tabBarClearance },
  header: { gap: space.md, marginBottom: space.sm },
  footer: { paddingVertical: space.lg, textAlign: 'center' },
});
