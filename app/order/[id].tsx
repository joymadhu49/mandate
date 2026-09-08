// Order detail: one trade from proposal to result, with its countdown, reasoning and on-chain steps.
import React from 'react';
import { Pressable, RefreshControl, StyleSheet, View } from 'react-native';
import { useIsFocused, useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { AccountAccess } from '@/components/account-access';
import { Banner, DetailRow, EmptyState, Icon, Page, PreviewBanner, SkeletonRows, useNow } from '@/components/app-ui';
import { CancelOrderButton, OrderStatus, isOpenOrder, orderAmount } from '@/components/order-ui';
import { TransactionSteps } from '@/components/transaction-steps';
import { Amount, Body, Button, Card, H2, Logo, Muted, Screen, Title } from '@/components/ui';
import { api, type Order } from '@/lib/api';
import { openTransaction } from '@/lib/links';
import { usePreferences } from '@/lib/preferences';
import { stockByToken } from '@/lib/stocks';
import { colors, space } from '@/lib/theme';
import { countdownLabel, mandateTitle, modeLabel, privateAccountText, shortDateTime, transactionUrl, whenLabel } from '@/lib/ui-presentation';
import { useWallet } from '@/lib/wallet';

const LIVE_FAILURE_NOTE = ' Check your wallet on Base before another order. A partial transaction may still settle.';

const failureText = (o: Order, hidden: boolean) => `${privateAccountText(o.error || 'Execution failed.', hidden)}${o.dryRun ? '' : LIVE_FAILURE_NOTE}`;

export default function OrderDetail() {
  return <Screen><AccountAccess><Detail /></AccountAccess></Screen>;
}

function Detail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const focused = useIsFocused();
  const address = useWallet(s => s.address)!;
  const hidden = usePreferences(s => s.hideBalances);
  const orders = useQuery({
    queryKey: ['orders', address], queryFn: api.orders,
    // 5 s only while this order can still move; 10 s otherwise; nothing while the screen is off.
    refetchInterval: q => (!focused ? false : q.state.data?.some(o => o.id === id && isOpenOrder(o)) ? 5_000 : 10_000),
  });
  const mandates = useQuery({ queryKey: ['mandates', address], queryFn: () => api.mandates(address) });
  const o = orders.data?.find(x => x.id === id);
  const mandate = mandates.data?.find(x => x.id === o?.mandateId);
  const refreshControl = <RefreshControl refreshing={orders.isRefetching} onRefresh={() => orders.refetch()} tintColor={colors.muted} />;

  if (!o) {
    return (
      <Page nested contentContainerStyle={styles.content} refreshControl={refreshControl}>
        <PreviewBanner />
        {orders.isPending ? <SkeletonRows count={4} /> : (
          <EmptyState icon={orders.isError ? 'wifi.exclamationmark' : 'doc.text.magnifyingglass'}
            title={orders.isError ? 'Order unavailable' : 'Order not found'}
            message={orders.isError ? privateAccountText(orders.error.message, hidden) : 'Only orders belonging to your verified wallet are visible.'}>
            <Button title="Refresh" variant="ghost" onPress={() => orders.refetch()} loading={orders.isFetching} />
          </EmptyState>
        )}
      </Page>
    );
  }

  const ticker = o.symbol.replace(/c$/, '');
  const name = stockByToken(o.token)?.name ?? ticker;
  const txHash = o.txHash;
  const stepsCarryTx = !!txHash && (o.transactions ?? []).some(s => s.hash.toLowerCase() === txHash.toLowerCase());
  const mandateLabel = mandate ? mandateTitle(mandate, hidden) : 'View mandate';

  return (
    <Page nested contentContainerStyle={styles.content} refreshControl={refreshControl}>
      <PreviewBanner />
      <View style={styles.header}>
        <Logo symbol={o.symbol} size={48} />
        <View style={styles.headerText}>
          <Title accessibilityRole="header">{`${o.action === 'buy' ? 'Buy' : 'Sell'} ${name}`}</Title>
          <Muted>{`${ticker} · ${modeLabel(o.dryRun)}`}</Muted>
        </View>
      </View>
      <View style={styles.amountRow}>
        <Amount style={styles.amount} accessibilityLabel={hidden ? 'Amount hidden' : undefined}>{hidden ? '••••' : orderAmount(o)}</Amount>
        <OrderStatus order={o} />
      </View>
      <StatusBanner order={o} hidden={hidden} />
      <Card style={styles.card}>
        <H2 accessibilityRole="header">Why this trade</H2>
        <Body>{privateAccountText(o.rationale, hidden)}</Body>
      </Card>
      <Card style={styles.details}>
        <DetailRow label="Mandate">
          <Pressable accessibilityRole="link" accessibilityLabel={`${mandateLabel}. Opens the mandate`} hitSlop={10}
            onPress={() => router.push(`/mandate/${o.mandateId}`)} style={({ pressed }) => [styles.link, pressed && styles.pressed]}>
            <Body numberOfLines={2} style={styles.linkText}>{mandateLabel}</Body>
            <Icon name="chevron.right" size={13} color={colors.link} />
          </Pressable>
        </DetailRow>
        <DetailRow label="Proposed" value={whenLabel(o.createdAt)} />
        <DetailRow label="Updated" value={whenLabel(o.updatedAt)} />
        {o.status === 'queued' ? <DetailRow label="Eligible after" value={shortDateTime(o.executeAfter)} /> : null}
        <DetailRow label="Source" value={o.source === 'chat' ? 'Agent chat' : 'Automatic agent'} />
      </Card>
      {orders.isError ? (
        <Banner tone="muted" icon="wifi.exclamationmark" action={{ label: 'Retry', onPress: () => orders.refetch() }}
          text={`Status could not refresh · showing the result last updated ${whenLabel(Math.floor(orders.dataUpdatedAt / 1000))}`} />
      ) : null}
      <TransactionSteps steps={o.transactions} />
      <CancelOrderButton order={o} />
      {txHash && transactionUrl(txHash) && !stepsCarryTx ? (
        <Button title="View transaction on Basescan" variant="ghost" onPress={() => openTransaction(txHash)} />
      ) : null}
    </Page>
  );
}

function StatusBanner({ order: o, hidden }: { order: Order; hidden: boolean }) {
  switch (o.status) {
    case 'queued': return <QueuedBanner executeAfter={o.executeAfter} />;
    case 'executing': return <Banner tone="amber" icon="bolt" live text="Execution has started. This order can no longer be cancelled." />;
    case 'failed': return <Banner tone="red" icon="exclamationmark.triangle" text={failureText(o, hidden)} />;
    case 'cancelled': return <Banner tone="muted" icon="xmark.circle" text="This order will not execute. Your mandate stays active." />;
    case 'filled': return <Banner tone="green" icon="checkmark.circle" text={o.dryRun ? 'Completed (simulated) · no tokens moved' : 'Completed on Base'} />;
    default: return null;
  }
}

/** Ticks once a second; only this banner re-renders while the order waits in the queue. */
function QueuedBanner({ executeAfter }: { executeAfter: number }) {
  const now = useNow(1000);
  const countdown = countdownLabel(executeAfter, now);
  const text = countdown === '0:00' ? 'Executing shortly · prices and limits are checked again first' : `Executes in ${countdown} · you can still cancel`;
  return <Banner tone="amber" icon="clock" live text={text} />;
}

const styles = StyleSheet.create({
  // The outer Screen owns the page gutter so the verify card and the page share one inset.
  content: { paddingHorizontal: 0 },
  header: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  headerText: { flex: 1, minWidth: 0, gap: 3 },
  amountRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.md },
  amount: { flexShrink: 1 },
  card: { gap: space.md },
  details: { gap: 2 },
  link: { flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1, minHeight: 32 },
  linkText: { color: colors.link, fontWeight: '600', flexShrink: 1, textAlign: 'right' },
  pressed: { opacity: 0.7 },
});
