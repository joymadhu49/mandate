// Home: the portfolio, the mandates that need attention, open positions, and the tokenized-stock feed.
// One primary path (create or chat), everything else is a row.
import React, { useCallback, useMemo } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, View } from 'react-native';
import { useIsFocused, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AccountAccess } from '@/components/account-access';
import { MarketStatus } from '@/components/market-status';
import {
  appStyles, Banner, BrandMark, EmptyState, Icon, ListRow, ModeLine, PreviewBanner, SectionHeader, SettingRow, SkeletonRows, useNow,
} from '@/components/app-ui';
import { isOpenMandate, MandateRow, openMandateChat, mandatePaused } from '@/components/mandate-ui';
import { feesReady, useAgentFees } from '@/components/agent-account-sheet';
import { Amount, Badge, Button, Caption, Card, H1, H2, Logo, Muted, Row, Screen, Skeleton } from '@/components/ui';
import { api, type AgentInfo } from '@/lib/api';
import { fetchHoldings, fetchQuotes, type Holding, type Quote } from '@/lib/chain';
import { usePreferences } from '@/lib/preferences';
import { colors, money, space, tabBarClearance } from '@/lib/theme';
import { marketIsOpen, modeLabel, reopensLabel, whenLabel } from '@/lib/ui-presentation';
import { useWallet } from '@/lib/wallet';

type Valuation = { usd: number; incomplete: boolean };
type HoldingsData = { usdc: number; holdings: Holding[]; incomplete: boolean };

/** USDC plus every position at its latest feed price; incomplete when a balance or price is missing. */
function valuePortfolio(data: HoldingsData | undefined, quoteFor: (token: string) => Quote | undefined): Valuation {
  if (!data) return { usd: 0, incomplete: false };
  let incomplete = data.incomplete;
  let usd = data.usdc;
  for (const h of data.holdings) {
    const price = quoteFor(h.stock.token)?.price;
    if (!price) incomplete = true; else usd += h.shares * price;
  }
  return { usd, incomplete };
}

/** Composer prefill for a stock row: a trade when a chat mandate can act, research otherwise. */
const stockDraft = (name: string, canTrade: boolean) => (canTrade ? `Buy $25 of ${name}` : `Explain ${name} and its risks`);

export default function Home() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const qc = useQueryClient();
  const focused = useIsFocused();
  const address = useWallet(s => s.address);
  const hidden = usePreferences(s => s.hideBalances);
  const autoRefresh = usePreferences(s => s.autoRefresh);
  const displayName = usePreferences(s => (address ? s.profiles[address.toLowerCase()]?.displayName : undefined));
  const poll = focused && autoRefresh;
  // One clock for every frozen row's reopen countdown; a minute is the finest unit those labels show.
  const now = useNow(60_000);

  const quotes = useQuery({ queryKey: ['quotes'], queryFn: fetchQuotes, refetchInterval: poll ? 30_000 : false });
  const holdings = useQuery({
    queryKey: ['holdings', address], queryFn: () => fetchHoldings(address!), enabled: !!address, refetchInterval: poll ? 30_000 : false,
  });
  const mandates = useQuery({
    queryKey: ['mandates', address], queryFn: () => api.mandates(address!), enabled: !!address, refetchInterval: poll ? 20_000 : false,
  });
  const agent = useQuery({ queryKey: ['agent'], queryFn: api.agent, refetchInterval: poll ? 30_000 : false });
  // Only live trades pay real fees, so the checklist asks about them, and reads the balance, only once the backend is live.
  const live = agent.data?.dryRun === false;
  const fees = useAgentFees(agent.data?.spender, { enabled: live, poll });

  const quoteByToken = useMemo(() => new Map((quotes.data ?? []).map(q => [q.stock.token.toLowerCase(), q] as const)), [quotes.data]);
  const quoteFor = useCallback((token: string) => quoteByToken.get(token.toLowerCase()), [quoteByToken]);
  const valuation = useMemo(() => valuePortfolio(holdings.data, quoteFor), [holdings.data, quoteFor]);
  const open = useMemo(() => (mandates.data ?? []).filter(isOpenMandate), [mandates.data]);
  const canTrade = useMemo(() => (mandates.data ?? []).some(m => m.status === 'active' && m.control === 'chat'), [mandates.data]);
  const positions = holdings.data?.holdings ?? [];
  const anyStale = (quotes.data ?? []).some(q => q.stale);

  const refreshing = quotes.isRefetching || holdings.isRefetching || mandates.isRefetching;
  const refresh = () => {
    void quotes.refetch(); void holdings.refetch(); void mandates.refetch();
    void qc.invalidateQueries({ queryKey: ['agent'] });
    void qc.invalidateQueries({ queryKey: ['spender-eth'] });
  };
  const createMandate = () => router.push('/new-mandate');
  const openSettings = () => router.navigate('/(tabs)/settings');
  const openDraft = useCallback((name: string) => {
    router.navigate({ pathname: '/(tabs)/agent', params: { draft: stockDraft(name, canTrade), nonce: String(Date.now()) } });
  }, [router, canTrade]);

  return (
    <Screen style={{ paddingTop: insets.top + 12 }}>
      <FlatList
        data={quotes.data ?? []}
        keyExtractor={q => q.stock.token}
        renderItem={({ item, index }) => <StockRow q={item} first={index === 0} now={now} onPress={openDraft} />}
        showsVerticalScrollIndicator={false}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.muted} />}
        ListHeaderComponent={
          <View style={styles.header}>
            <Row>
              <View style={styles.brand}><BrandMark size={34} /><H1 accessibilityRole="header" numberOfLines={1}>Mandate</H1></View>
              <Pressable accessibilityRole="button" accessibilityLabel="Profile and wallet" onPress={() => router.push('/profile')}
                style={styles.profileButton}>
                <Icon name="person.crop.circle" size={30} color={colors.link} />
              </Pressable>
            </Row>
            <PreviewBanner />
            <Portfolio
              owner={displayName ? `${displayName}’s portfolio` : 'Portfolio'}
              hidden={hidden}
              pending={holdings.isPending || quotes.isPending}
              unavailable={holdings.isError || quotes.isError || valuation.incomplete}
              usd={valuation.usd}
              usdc={holdings.data?.usdc}
              positions={positions.length}
              holdingsError={holdings.isError}
              dryRun={agent.data?.dryRun}
            />
            {valuation.incomplete ? (
              <Banner tone="amber" icon="exclamationmark.triangle" text="Some balances or prices are unavailable. Pull down to retry." />
            ) : null}
            <MarketStatus anyStale={anyStale} quotesReady={!!quotes.data} />
            <AccountAccess>
              {mandates.data?.length === 0 ? (
                <GetStarted ai={agent.data?.ai} onAI={() => router.push('/ai-settings')} onCreate={createMandate}
                  fees={live ? { done: feesReady(fees), onPress: openSettings } : undefined} />
              ) : (
                <View style={styles.section}>
                  <SectionHeader title="Mandates" action={mandates.data?.length ? { label: 'New', icon: 'plus', onPress: createMandate } : undefined} />
                  {mandates.isError ? (
                    <Banner tone={mandates.data ? 'muted' : 'red'} icon="wifi.exclamationmark" action={{ label: 'Retry', onPress: () => mandates.refetch() }}
                      text={mandates.data
                        ? `Mandates could not refresh · showing the result last updated ${whenLabel(Math.floor(mandates.dataUpdatedAt / 1000))}`
                        : 'Agent unavailable. Check the connection and try again.'} />
                  ) : null}
                  {mandates.isPending ? <SkeletonRows count={2} /> : open.length ? (
                    <View style={styles.mandates}>
                      {open.map(m => (
                        <MandateRow key={m.id} m={m} hidden={hidden} paused={mandatePaused(m, agent.data?.dryRun)} onPress={() => router.push(`/mandate/${m.id}`)}
                          onChat={() => openMandateChat(router, m.id)} />
                      ))}
                    </View>
                  ) : mandates.data?.length ? (
                    <Muted>No active mandates</Muted>
                  ) : null}
                </View>
              )}
            </AccountAccess>
            {positions.length ? (
              <View style={styles.section}>
                <SectionHeader title="Positions" />
                <View>
                  {positions.map((h, i) => <PositionRow key={h.stock.token} h={h} quote={quoteFor(h.stock.token)} hidden={hidden} first={i === 0} />)}
                </View>
              </View>
            ) : null}
            <View style={styles.stocksHeader}>
              <SectionHeader title="Tokenized stocks"
                caption={anyStale ? 'Chainlink · frozen while US markets are closed' : 'Chainlink · 24/5 · latest prices'} />
              {quotes.isError && quotes.data ? (
                <Banner tone="muted" icon="wifi.exclamationmark" text="Prices could not refresh · showing the last saved prices" />
              ) : null}
            </View>
          </View>
        }
        ListEmptyComponent={quotes.isPending ? <SkeletonRows count={5} /> : quotes.isError ? (
          <Banner tone="red" icon="wifi.exclamationmark" text="Prices unavailable. Pull down to retry." />
        ) : (
          <EmptyState icon="chart.line.uptrend.xyaxis" title="No stock quotes" message="Chainlink returned no prices. Pull down to try again." />
        )}
      />
    </Screen>
  );
}

/** Hero figure. One accessible group so VoiceOver reads value, breakdown and mode in a single swipe. */
function Portfolio({ owner, hidden, pending, unavailable, usd, usdc, positions, holdingsError, dryRun }: {
  owner: string; hidden: boolean; pending: boolean; unavailable: boolean; usd: number; usdc: number | undefined;
  positions: number; holdingsError: boolean; dryRun: boolean | undefined;
}) {
  const value = hidden ? '••••••' : pending ? undefined : unavailable ? 'Unavailable' : money(usd);
  const detail = hidden ? 'Balances hidden in Settings'
    : holdingsError ? 'Could not load balances. Pull down to retry.'
    : pending ? undefined
    : `${money(usdc ?? 0)} USDC · ${positions} ${positions === 1 ? 'position' : 'positions'}`;
  const note = 'USDC + tokenized stocks · excludes ETH';
  const label = [owner, value ?? 'Loading', detail, modeLabel(dryRun), note].filter(Boolean).join('. ');
  return (
    <View accessible accessibilityLabel={label} style={styles.portfolio}>
      <Muted>{owner}</Muted>
      {value ? <Amount>{value}</Amount> : <Skeleton width={180} height={40} radius={8} />}
      {detail ? <Muted>{detail}</Muted> : <Skeleton width={150} height={12} />}
      <ModeLine dryRun={dryRun} />
      <Caption>{note}</Caption>
    </View>
  );
}

const done = <Icon name="checkmark.circle.fill" color={colors.green} />;

/** First-run checklist: shown only once the wallet is verified and no mandate exists yet. The fee step exists only while live. */
function GetStarted({ ai, onAI, onCreate, fees }: {
  ai: AgentInfo['ai'] | undefined; onAI: () => void; onCreate: () => void; fees?: { done: boolean; onPress: () => void };
}) {
  const aiDone = !!ai?.configured;
  return (
    <Card style={styles.getStarted}>
      <H2 accessibilityRole="header" style={styles.getStartedTitle}>Get started</H2>
      <SettingRow icon="sparkles" title="Connect AI" detail={aiDone ? `Connected · ${ai!.model}` : 'Needed for chat trades'} onPress={onAI}
        trailing={aiDone ? done : undefined} />
      <View style={appStyles.divider} />
      <SettingRow icon="doc.badge.plus" title="Create your first mandate" detail="Budget, stocks, rules, expiry" onPress={onCreate} />
      {fees ? (
        <>
          <View style={appStyles.divider} />
          <SettingRow icon="fuelpump" title="Fund your agent’s fees" onPress={fees.onPress} trailing={fees.done ? done : undefined}
            detail={fees.done ? 'Funded · ready for live trades' : 'Send a little ETH on Base to your agent account'} />
        </>
      ) : null}
      <View style={styles.getStartedAction}><Button title="Create a mandate" onPress={onCreate} /></View>
    </Card>
  );
}

function PositionRow({ h, quote, hidden, first }: { h: Holding; quote: Quote | undefined; hidden: boolean; first: boolean }) {
  const shares = hidden ? '•••• shares' : `${h.shares.toFixed(4)} shares`;
  const value = hidden ? '••••' : quote?.price ? money(h.shares * quote.price) : 'Unavailable';
  return (
    <ListRow first={first} leading={<Logo symbol={h.stock.symbol} size={40} />} title={h.stock.name} subtitle={shares} value={value}
      accessibilityLabel={`${h.stock.name}, ${hidden ? 'shares hidden, value hidden' : `${shares}, ${value}`}`} />
  );
}

/** A frozen feed is expected while the exchange is closed; during the session it is the feed that is behind. */
const frozenStatus = (now: number) => (marketIsOpen(now) ? 'feed stale' : reopensLabel(now));

const StockRow = React.memo(function StockRow({ q, first, now, onPress }: { q: Quote; first: boolean; now: number; onPress: (name: string) => void }) {
  const ticker = q.stock.symbol.replace(/c$/, '');
  const updated = q.updatedAt ? whenLabel(q.updatedAt) : 'No price';
  const status = q.stale ? frozenStatus(now) : updated;
  const price = q.price ? money(q.price) : '—';
  return (
    <ListRow first={first} onPress={() => onPress(q.stock.name)}
      leading={<Logo symbol={q.stock.symbol} size={40} />}
      title={q.stock.name} subtitle={`${ticker} · ${status}`}
      value={price} valueBelow={q.stale ? <Badge text="Frozen" tone="amber" /> : undefined}
      accessibilityLabel={[q.stock.name, ticker, q.price ? price : 'No price', q.stale ? `Frozen, ${status}` : `Updated ${updated}`].join(', ')}
      accessibilityHint="Opens Agent chat with a draft message" />
  );
});

const styles = StyleSheet.create({
  content: { paddingBottom: tabBarClearance },
  header: { gap: space.xxl, marginBottom: space.md },
  brand: { flexDirection: 'row', alignItems: 'center', gap: 10, flexShrink: 1, minWidth: 0 },
  profileButton: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  portfolio: { gap: 6 },
  section: { gap: space.md },
  mandates: { gap: space.md },
  getStarted: { paddingHorizontal: 0, paddingVertical: 12, gap: 2 },
  getStartedTitle: { paddingHorizontal: 16, paddingBottom: 6 },
  getStartedAction: { paddingHorizontal: 16, paddingTop: 12 },
  stocksHeader: { gap: space.md },
});
