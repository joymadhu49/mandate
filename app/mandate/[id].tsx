// Mandate detail: what the agent may do, what it has done, and the one action that fits its state.
import React, { useEffect, useMemo, useState } from 'react';
import { Alert, FlatList, Pressable, RefreshControl, StyleSheet, View } from 'react-native';
import { useIsFocused, useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AccountAccess } from '@/components/account-access';
import { ActivityRow, collapseHolds } from '@/components/activity-ui';
import { ACTIVATION_GAS_ETH, AgentAccountSheet, TOP_UP_ETH, useAgentFees } from '@/components/agent-account-sheet';
import { Banner, BudgetMeter, DetailRow, EmptyState, Icon, ModeLine, PreviewBanner, SectionHeader, SkeletonRows } from '@/components/app-ui';
import { mandateSymbols, openMandateChat, mandatePaused } from '@/components/mandate-ui';
import { isOpenOrder } from '@/components/order-ui';
import { TransactionSteps } from '@/components/transaction-steps';
import { Amount, Badge, Body, Button, Caption, Card, Divider, LogoStack, Muted, Screen } from '@/components/ui';
import { api, type Mandate } from '@/lib/api';
import { openTransaction } from '@/lib/links';
import { usePreferences } from '@/lib/preferences';
import { colors, money, space } from '@/lib/theme';
import {
  controlLabel, mandateStatusLabel, mandateStatusTone, mandateTitle, periodNoun, privateAccountText, riskLabel, shortDate, whenLabel,
} from '@/lib/ui-presentation';
import { useWallet } from '@/lib/wallet';

/** How long "Evaluating…" may stand in for a run the backend has not reported yet. */
const EVALUATING_TIMEOUT_MS = 60_000;

const REVIEW_NOTICE = 'Needs review. Check the transaction steps and your wallet on Base before running again.';
const ACTIVATING_NOTICE = {
  chat: 'Activating… registering your USDC permission on Base.',
  automatic: 'Activating… the first run registers the permission.',
};
// Registration is a transaction the agent account pays for; without ETH it fails and the mandate stays pending.
const FEES_NOTICE = `Agent account needs ETH for fees. Send ${TOP_UP_ETH} ETH on Base.`;

const lastUpdated = (ms: number) => whenLabel(Math.floor(ms / 1000));
const tokensLabel = (n: number) => `${n} ${n === 1 ? 'token' : 'tokens'}`;

/** "Oct 5 · in 12 days" — the permission's end date and how far away it is. */
function expiresLabel(end: number, now = Date.now()) {
  const days = Math.ceil((end - now / 1000) / 86400);
  return `${shortDate(end)} · ${days <= 0 ? 'expired' : days === 1 ? 'in 1 day' : `in ${days} days`}`;
}

/** The empty Activity list names what will fill it. */
function emptyActivityText(m: Mandate) {
  if (m.status === 'revoked' || m.status === 'expired') return 'No activity was recorded for this mandate.';
  if (m.status === 'pending') return 'Activity appears here once the mandate is active.';
  if (m.control === 'chat') return 'No activity yet. Trades you confirm in chat appear here.';
  return 'No activity yet. Run the agent to see its first decision here.';
}

function revokeMessage(pendingOrders: number) {
  const orders = pendingOrders === 1 ? '1 pending order will be cancelled.' : `${pendingOrders} pending orders will be cancelled.`;
  return `${pendingOrders ? orders : 'The agent stops proposing trades.'} Submitted transactions may still settle.`;
}

export default function MandateDetail() {
  return <Screen style={styles.screen}><AccountAccess><MandateContent /></AccountAccess></Screen>;
}

function MandateContent() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const qc = useQueryClient();
  const focused = useIsFocused();
  const address = useWallet(s => s.address)!;
  const hidden = usePreferences(s => s.hideBalances);

  const mandates = useQuery({ queryKey: ['mandates', address], queryFn: () => api.mandates(address), refetchInterval: focused ? 20_000 : false });
  const activity = useQuery({ queryKey: ['activity', address], queryFn: () => api.activity(address), refetchInterval: focused ? 20_000 : false });
  const orders = useQuery({ queryKey: ['orders', address], queryFn: api.orders, refetchInterval: focused ? 10_000 : false });
  // Legacy mandates carry no executionMode; fall back to the backend's current mode rather than claiming one.
  const agent = useQuery({ queryKey: ['agent'], queryFn: api.agent, staleTime: 30_000 });
  const m = mandates.data?.find(x => x.id === id);
  const items = useMemo(() => collapseHolds((activity.data ?? []).filter(a => a.mandateId === id)), [activity.data, id]);
  const refresh = () => { void activity.refetch(); void mandates.refetch(); };
  // A live mandate cannot activate until its agent account can pay the registration fee.
  const fees = useAgentFees(m?.spender, { enabled: m?.status === 'pending' && m?.executionMode === 'live', poll: focused });
  const [agentAccountOpen, setAgentAccountOpen] = useState(false);

  // Optimistic run state: the button reads "Evaluating…" until the backend reports a new run or a minute passes.
  const [evaluating, setEvaluating] = useState<{ since: number; lastRunAt: number | undefined } | undefined>();
  const run = useMutation({
    mutationFn: () => api.runNow(id),
    onSuccess: () => { setEvaluating({ since: Date.now(), lastRunAt: m?.lastRunAt }); refresh(); },
    onError: (e: Error) => Alert.alert('Run failed', privateAccountText(e.message, hidden)),
  });
  useEffect(() => {
    if (!evaluating) return;
    if (m?.lastRunAt !== evaluating.lastRunAt) { setEvaluating(undefined); return; }
    const t = setTimeout(() => setEvaluating(undefined), Math.max(0, evaluating.since + EVALUATING_TIMEOUT_MS - Date.now()));
    return () => clearTimeout(t);
  }, [evaluating, m?.lastRunAt]);

  const revoke = useMutation({
    mutationFn: () => api.revoke(id),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['mandates'] }); void qc.invalidateQueries({ queryKey: ['orders'] }); router.back(); },
    onError: (e: Error) => Alert.alert('Revoke failed', privateAccountText(e.message, hidden)),
  });
  const confirmRevoke = () => {
    const pending = (orders.data ?? []).filter(o => o.mandateId === id && isOpenOrder(o)).length;
    Alert.alert('Revoke this mandate?', revokeMessage(pending), [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Revoke', style: 'destructive', onPress: () => revoke.mutate() },
    ]);
  };

  if (!m) {
    return (
      <View style={styles.fallback}>
        <PreviewBanner />
        {mandates.isPending ? <SkeletonRows count={4} /> : mandates.isError ? (
          <>
            <Banner tone="red" icon="wifi.exclamationmark" text={privateAccountText(mandates.error.message, hidden)} />
            <EmptyState icon="wifi.exclamationmark" title="Mandate unavailable"
              message="Your mandates could not be loaded from the agent. Check the connection and try again.">
              <Button title="Try again" variant="ghost" onPress={() => mandates.refetch()} loading={mandates.isFetching} />
            </EmptyState>
          </>
        ) : (
          <EmptyState icon="doc.text.magnifyingglass" title="Mandate not found" message="Only mandates belonging to your verified wallet are visible.">
            <Button title="Refresh" variant="ghost" onPress={() => mandates.refetch()} loading={mandates.isFetching} />
          </EmptyState>
        )}
      </View>
    );
  }

  const symbols = mandateSymbols(m);
  const busy = revoke.isPending;
  const dryRun = m.executionMode ? m.executionMode === 'simulation' : agent.data?.dryRun;
  const paused = mandatePaused(m, agent.data?.dryRun);
  const titleLabel = hidden ? `Budget hidden, per ${periodNoun[m.period]}, ${controlLabel[m.control ?? 'automatic']}` : undefined;
  const header = (
    <View style={styles.header}>
      <PreviewBanner />
      <View style={styles.titleBlock}>
        <View accessible accessibilityRole="header" accessibilityLabel={titleLabel ?? mandateTitle(m, hidden, 'none')} style={styles.titleLine}>
          <Amount size={34} style={styles.budget}>{hidden ? '••••' : money(m.budgetUsdc, 0)}</Amount>
          <Muted style={styles.period}>/ {periodNoun[m.period]}</Muted>
        </View>
        <View style={styles.statusLine}>
          <Badge text={mandateStatusLabel[m.status]} tone={mandateStatusTone[m.status]} />
          {m.control ? <Badge text={controlLabel[m.control]} tone="base" /> : null}
          {dryRun !== undefined ? <ModeLine dryRun={dryRun} /> : null}
        </View>
      </View>
      <BudgetMeter budget={m.budgetUsdc} spent={m.spentThisPeriod} period={m.period} periodStart={m.periodStart} hidden={hidden} />
      {mandates.isError ? (
        <Banner tone="muted" icon="wifi.exclamationmark" action={{ label: 'Retry', onPress: () => mandates.refetch() }}
          text={`Could not refresh · status and spending last updated ${lastUpdated(mandates.dataUpdatedAt)}`} />
      ) : null}
      <StatusBanner m={m} paused={paused} lowFees={m.executionMode === 'live' && fees.data !== undefined && fees.data < ACTIVATION_GAS_ETH}
        onShowAddress={() => setAgentAccountOpen(true)} />
      <PrimaryAction m={m} paused={paused} evaluating={!!evaluating} running={run.isPending} disabled={busy} onRun={() => run.mutate()}
        onChat={() => openMandateChat(router, m.id)} />
      {evaluating ? <Muted accessibilityLiveRegion="polite" style={styles.center}>Evaluating · results in Activity within a minute</Muted> : null}
      <DetailsCard m={m} symbols={symbols} />
      <View style={styles.section}>
        <SectionHeader title="Instructions" />
        <Body style={styles.instructions}>{privateAccountText(m.strategy, hidden)}</Body>
      </View>
      <TransactionSteps steps={m.transactions} />
      <View style={styles.activityHeader}>
        <SectionHeader title="Activity" />
        {activity.isError ? (
          <Banner tone={activity.data ? 'muted' : 'red'} icon="wifi.exclamationmark" action={{ label: 'Retry', onPress: () => activity.refetch() }}
            text={activity.data
              ? `Activity could not refresh · showing results last updated ${lastUpdated(activity.dataUpdatedAt)}`
              : `Activity unavailable · ${privateAccountText(activity.error.message, hidden)}`} />
        ) : null}
      </View>
    </View>
  );
  const footer = (
    <View style={styles.footer}>
      {(activity.data?.length ?? 0) >= 500 ? <Caption>Activity shows the latest 500 events across your account.</Caption> : null}
      <Divider />
      <Button title="Revoke mandate" variant="danger" onPress={confirmRevoke} loading={revoke.isPending} disabled={m.status === 'revoked' || run.isPending} />
      <Caption style={styles.center}>Also revocable at account.base.app.</Caption>
    </View>
  );

  return (
    <>
    <FlatList
      data={items}
      keyExtractor={item => item.id}
      renderItem={({ item, index }) => <ActivityRow item={item} hidden={hidden} first={index === 0} />}
      extraData={hidden}
      initialNumToRender={8}
      maxToRenderPerBatch={8}
      windowSize={7}
      showsVerticalScrollIndicator={false}
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ paddingBottom: insets.bottom + 30 }}
      refreshControl={<RefreshControl refreshing={activity.isRefetching || mandates.isRefetching} onRefresh={refresh} tintColor={colors.muted} />}
      ListHeaderComponent={header}
      ListEmptyComponent={activity.isPending ? <SkeletonRows count={3} /> : activity.isError && !activity.data ? null : (
        <Muted style={styles.empty}>{emptyActivityText(m)}</Muted>
      )}
      ListFooterComponent={footer}
    />
    <AgentAccountSheet visible={agentAccountOpen} onClose={() => setAgentAccountOpen(false)} spender={m.spender} fees={fees}
      live={m.executionMode === 'live'} hidden={hidden} />
    </>
  );
}

function StatusBanner({ m, paused, lowFees, onShowAddress }: { m: Mandate; paused: boolean; lowFees: boolean; onShowAddress: () => void }) {
  if (paused) {
    const created = m.executionMode === 'live' ? 'live mode' : 'simulation';
    const current = m.executionMode === 'live' ? 'simulating' : 'live';
    return <Banner tone="muted" icon="pause.circle" text={`Created in ${created}. The backend is ${current}, so this mandate is paused. You can still revoke it.`} />;
  }
  if (m.status === 'error') return <Banner tone="red" icon="exclamationmark.triangle" text={REVIEW_NOTICE} />;
  if (m.status === 'pending' && lowFees) {
    return <Banner tone="amber" icon="exclamationmark.triangle" live text={FEES_NOTICE} action={{ label: 'Show address', onPress: onShowAddress }} />;
  }
  if (m.status === 'pending') return <Banner tone="amber" icon="clock" live text={ACTIVATING_NOTICE[m.control === 'chat' ? 'chat' : 'automatic']} />;
  return null;
}

/** Exactly one full-width action per state; terminal states get none. */
function PrimaryAction({ m, paused, evaluating, running, disabled, onRun, onChat }: {
  m: Mandate; paused?: boolean; evaluating: boolean; running: boolean; disabled: boolean; onRun: () => void; onChat: () => void;
}) {
  if (paused) return null;
  if (m.status === 'pending') return <Button title="Retry activation" onPress={onRun} loading={running} disabled={disabled} />;
  if (m.status !== 'active') return null;
  if (m.control === 'chat') {
    return <Button title="Open Agent chat" onPress={onChat} disabled={disabled} accessibilityHint="Opens the Agent tab with this mandate selected" />;
  }
  return <Button title={evaluating ? 'Evaluating…' : 'Run agent now'} onPress={onRun} loading={running} disabled={disabled || evaluating} />;
}

function DetailsCard({ m, symbols }: { m: Mandate; symbols: string[] }) {
  const automatic = m.control !== 'chat';
  return (
    <Card style={styles.details}>
      <DetailRow label="Stocks">
        {symbols.length ? <LogoStack symbols={symbols} size={26} /> : <Body style={styles.value}>{tokensLabel(m.universe.length)}</Body>}
      </DetailRow>
      <DetailRow label="Risk" value={`${riskLabel[m.risk]} · max ${m.maxPositionPct}% per position`} />
      <DetailRow label="Exits"
        value={automatic ? `+${m.takeProfitPct}% take profit · −${m.stopLossPct}% stop loss` : 'None automatic · you confirm every trade'} />
      <DetailRow label="Expires" value={expiresLabel(m.batch.end)} />
      <DetailRow label="Control" value={controlLabel[m.control ?? 'automatic']} />
      <PermissionRow m={m} />
    </Card>
  );
}

function PermissionRow({ m }: { m: Mandate }) {
  const hash = m.approvalTx;
  if (hash) {
    return (
      <DetailRow label="Permission">
        <Pressable accessibilityRole="link" accessibilityLabel="Registered on Base. View the approval transaction on Basescan" hitSlop={10}
          onPress={() => openTransaction(hash)} style={({ pressed }) => [styles.link, pressed && styles.pressed]}>
          <Body style={styles.linkText}>Registered on Base</Body>
          <Icon name="arrow.up.right" size={13} color={colors.link} />
        </Pressable>
      </DetailRow>
    );
  }
  if (m.executionMode === 'simulation') return <DetailRow label="Permission" value="Not registered on Base (simulation)" />;
  if (m.status === 'error') return <DetailRow label="Permission" value="Not confirmed · see transaction steps" tone="amber" />;
  return <DetailRow label="Permission" value="Registered with the first trade" tone="muted" />;
}

const styles = StyleSheet.create({
  screen: { paddingTop: space.sm },
  fallback: { gap: space.lg },
  header: { gap: space.xxl },
  titleBlock: { gap: 10 },
  // Budget and period share a baseline; the budget shrinks at accessibility sizes instead of orphaning the period.
  titleLine: { flexDirection: 'row', alignItems: 'baseline', gap: space.sm },
  budget: { flexShrink: 1 },
  period: { flexShrink: 0, fontSize: 20, lineHeight: 26 },
  statusLine: { flexDirection: 'row', alignItems: 'center', gap: space.md, flexWrap: 'wrap' },
  section: { gap: space.md },
  instructions: { color: colors.muted },
  details: { gap: 2 },
  value: { fontVariant: ['tabular-nums'], flexShrink: 1, textAlign: 'right' },
  link: { flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1, minHeight: 32 },
  linkText: { color: colors.link, fontWeight: '600', flexShrink: 1, textAlign: 'right' },
  pressed: { opacity: 0.7 },
  activityHeader: { gap: space.md, marginBottom: 2 },
  empty: { paddingVertical: space.lg },
  footer: { gap: space.lg, paddingTop: space.xxl },
  center: { textAlign: 'center' },
});
