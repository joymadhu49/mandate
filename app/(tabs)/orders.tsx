import React, { useMemo, useRef, useState } from 'react';
import { FlatList, RefreshControl, StyleSheet, View } from 'react-native';
import { useIsFocused, useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { AccountFeed, usePullToRefresh } from '@/components/account-feed';
import { Banner, EmptyState, SkeletonRows, appStyles, useNow } from '@/components/app-ui';
import { Button, Chip, Muted } from '@/components/ui';
import { OrderRow, isOpenOrder } from '@/components/order-ui';
import { api, type Order } from '@/lib/api';
import { useWallet } from '@/lib/wallet';
import { colors, space, tabBarClearance } from '@/lib/theme';
import { whenLabel } from '@/lib/ui-presentation';

type Filter = 'open' | 'all';
const filters: { key: Filter; label: string }[] = [{ key: 'open', label: 'Open' }, { key: 'all', label: 'All' }];

export default function Orders() {
  return (
    <AccountFeed title="Orders" subtitle="Every trade the agent proposed, from queue to result.">
      <OrdersList />
    </AccountFeed>
  );
}

/** Queued and executing orders first; the rest keep the backend's newest-first order. */
function visibleOrders(orders: Order[], filter: Filter) {
  const shown = filter === 'open' ? orders.filter(isOpenOrder) : orders;
  return [...shown].sort((a, b) => Number(isOpenOrder(b)) - Number(isOpenOrder(a)));
}

function OrdersList() {
  const address = useWallet(s => s.address)!;
  const router = useRouter();
  const focused = useIsFocused();
  const [chosen, setChosen] = useState<Filter>();
  const orders = useQuery({
    queryKey: ['orders', address],
    queryFn: api.orders,
    // 5 s only while something on this screen is waiting to execute.
    refetchInterval: focused ? query => (query.state.data?.some(isOpenOrder) ? 5000 : 10000) : false,
  });
  const mandates = useQuery({ queryKey: ['mandates', address], queryFn: () => api.mandates(address) });
  // Decided once from the first result: open the queue when something is waiting, else the full list.
  const initial = useRef<Filter | undefined>(undefined);
  if (initial.current === undefined && orders.data) initial.current = orders.data.some(isOpenOrder) ? 'open' : 'all';
  const filter = chosen ?? initial.current ?? 'all';
  const data = useMemo(() => visibleOrders(orders.data ?? [], filter), [orders.data, filter]);
  // Relative timestamps in rows would otherwise freeze between polls; queued rows tick on their own.
  const minute = useNow(60_000);
  const { refreshing, onRefresh } = usePullToRefresh(orders.refetch);
  const hasMandate = (mandates.data?.length ?? 0) > 0;

  const empty = orders.isPending ? <SkeletonRows count={4} />
    : orders.isError && !orders.data ? (
      <EmptyState icon="wifi.exclamationmark" title="Orders unavailable" message={orders.error.message}>
        <Button title="Retry" variant="ghost" onPress={() => orders.refetch()} />
      </EmptyState>
    ) : filter === 'open' ? (
      <EmptyState icon="checkmark.circle" title="No open orders" message="Orders wait 60 seconds before executing. Only pending orders can be cancelled.">
        {orders.data?.length ? <Button title="Show all orders" variant="ghost" onPress={() => setChosen('all')} /> : null}
      </EmptyState>
    ) : (
      <EmptyState icon="arrow.left.arrow.right" title="No orders yet" message="Proposed trades appear here with their status.">
        {hasMandate
          ? <Button title="Ask the agent" onPress={() => router.navigate('/(tabs)/agent')} />
          : <Button title="Create a mandate" onPress={() => router.push('/new-mandate')} />}
      </EmptyState>
    );

  return (
    <FlatList
      data={data}
      keyExtractor={o => o.id}
      extraData={minute}
      showsVerticalScrollIndicator={false}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.muted} />}
      ListHeaderComponent={
        <View style={styles.header}>
          <View accessibilityRole="tablist" accessibilityLabel="Show" style={appStyles.wrap}>
            {filters.map(f => <Chip key={f.key} label={f.label} active={filter === f.key} onPress={() => setChosen(f.key)} />)}
          </View>
          {orders.isError && orders.data ? (
            <Banner tone="muted" icon="wifi.exclamationmark" action={{ label: 'Retry', onPress: () => orders.refetch() }}
              text={`Could not refresh · showing orders last updated ${whenLabel(Math.floor(orders.dataUpdatedAt / 1000))}`} />
          ) : null}
        </View>
      }
      ListEmptyComponent={empty}
      ListFooterComponent={data.length >= 500 ? <Muted style={styles.footer}>Showing the latest 500 orders.</Muted> : null}
      renderItem={({ item, index }) => <OrderRow order={item} first={index === 0} />}
    />
  );
}

const styles = StyleSheet.create({
  content: { paddingBottom: tabBarClearance },
  header: { gap: space.md, marginBottom: space.sm },
  footer: { paddingVertical: space.lg, textAlign: 'center' },
});
