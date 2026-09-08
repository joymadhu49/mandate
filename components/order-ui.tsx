// One rendering of an Order everywhere: status badge, amount, list row, cancel action.
// The Orders tab, Order detail and the Agent thread compose these.
import React from 'react';
import { Alert, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Badge, Button, Logo, Muted } from './ui';
import { ListRow, useNow } from './app-ui';
import { api, type Order } from '@/lib/api';
import { money, type Tone } from '@/lib/theme';
import { usePreferences } from '@/lib/preferences';
import { stockByToken } from '@/lib/stocks';
import { countdownLabel, orderAccessibilityLabel, privateAccountText, whenLabel } from '@/lib/ui-presentation';

export const orderLabel: Record<Order['status'], string> = {
  queued: 'Pending', executing: 'Executing', filled: 'Completed', cancelled: 'Cancelled', failed: 'Failed',
};
const orderTone: Record<Order['status'], Tone> = { queued: 'amber', executing: 'amber', filled: 'green', cancelled: 'muted', failed: 'red' };

/** A simulated fill says so instead of claiming "Completed". */
export function orderStatusText(order: Order) {
  return order.status === 'filled' && order.dryRun ? 'Simulated' : orderLabel[order.status];
}

export function isOpenOrder(order: Order) {
  return order.status === 'queued' || order.status === 'executing';
}

export function OrderStatus({ order }: { order: Order }) {
  return <Badge text={orderStatusText(order)} tone={orderTone[order.status]} />;
}

export function orderAmount(order: Order) {
  if (order.filledUsd !== undefined) return money(order.filledUsd);
  if (order.usd !== undefined) return money(order.usd);
  return `${Math.round((order.fraction ?? 0) * 100)}% of position`;
}

/** "Buy Apple": the stock name when the token is known, else the ticker. */
export function orderTitle(order: Order) {
  const name = stockByToken(order.token)?.name ?? order.symbol.replace(/c$/, '');
  return `${order.action === 'buy' ? 'Buy' : 'Sell'} ${name}`;
}

/** Ticking countdown to the execution window; mounted only inside queued rows. */
function ExecutesIn({ executeAfter }: { executeAfter: number }) {
  const now = useNow(1000);
  const left = countdownLabel(executeAfter, now);
  return <Muted>{left === '0:00' ? 'Executes any moment' : `Executes in ${left}`}</Muted>;
}

export function OrderRow({ order, first }: { order: Order; first?: boolean }) {
  const router = useRouter();
  const hidden = usePreferences(s => s.hideBalances);
  const when = `${whenLabel(order.createdAt)} · ${order.dryRun ? 'Simulation' : 'Live'}`;
  return (
    <ListRow
      first={first}
      leading={<Logo symbol={order.symbol} size={40} />}
      title={orderTitle(order)}
      subtitle={order.status === 'queued'
        ? <View style={styles.lines}><Muted numberOfLines={1}>{when}</Muted><ExecutesIn executeAfter={order.executeAfter} /></View>
        : when}
      value={hidden ? '••••' : orderAmount(order)}
      valueBelow={<OrderStatus order={order} />}
      onPress={() => router.push(`/order/${order.id}`)}
      accessibilityLabel={orderAccessibilityLabel(order, orderLabel[order.status], orderAmount(order), hidden)}
    />
  );
}

export function CancelOrderButton({ order }: { order: Order }) {
  const qc = useQueryClient();
  const hidden = usePreferences(s => s.hideBalances);
  const cancel = useMutation({
    mutationFn: () => api.cancelOrder(order.id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['orders'] }); qc.invalidateQueries({ queryKey: ['activity'] }); },
    onError: (e: Error) => { qc.invalidateQueries({ queryKey: ['orders'] }); Alert.alert('Order not cancelled', privateAccountText(e.message, hidden)); },
  });
  if (order.status !== 'queued') return null;
  const confirm = () => Alert.alert(
    'Cancel this order?',
    `This stops this ${order.action} before execution. Your mandate stays active and may propose future orders.`,
    [{ text: 'Keep order', style: 'cancel' }, { text: 'Cancel order', style: 'destructive', onPress: () => cancel.mutate() }],
  );
  return <Button title="Cancel pending order" variant="danger" loading={cancel.isPending} onPress={confirm} />;
}

const styles = StyleSheet.create({ lines: { gap: 3 } });
