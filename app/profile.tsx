import React, { useRef, useState } from 'react';
import { Alert, RefreshControl, Share, StyleSheet, TextInput, View } from 'react-native';
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { Banner, CoinbaseLogo, Field, ListRow, Page, PreviewBanner, SectionHeader, SettingRow, appStyles } from '@/components/app-ui';
import { usePullToRefresh } from '@/components/account-feed';
import { Badge, Button, Caption, Card, H2, Logo, Mono, Muted } from '@/components/ui';
import { useWallet } from '@/lib/wallet';
import { usePreferences } from '@/lib/preferences';
import { fetchEthBalance, fetchHoldings } from '@/lib/chain';
import { colors, money, space } from '@/lib/theme';

type Holdings = Awaited<ReturnType<typeof fetchHoldings>>;

/** Masked first; then the last known value, even while a refresh fails; "Unavailable" only with nothing to show. */
function balanceText<T>(query: { data?: T; isError: boolean }, hidden: boolean, format: (value: T) => string) {
  if (hidden) return '••••';
  if (query.data !== undefined) return format(query.data);
  return query.isError ? 'Unavailable' : '—';
}

type Notice = { tone: 'muted' | 'amber' | 'red'; text: string };

/** Stale data is muted, a partial read is amber, nothing at all is red. */
function balanceNotice(balances: UseQueryResult<Holdings, Error>, eth: UseQueryResult<number, Error>): Notice | undefined {
  if (balances.isError && !balances.data) return { tone: 'red', text: balances.error.message };
  if (balances.isError) return { tone: 'muted', text: 'Could not refresh balances. Showing the last saved result.' };
  if (balances.data?.incomplete) return { tone: 'amber', text: 'Some stock balances are unavailable.' };
  if (eth.isError) {
    if (eth.data === undefined) return { tone: 'amber', text: 'ETH balance unavailable.' };
    return { tone: 'muted', text: 'Could not refresh the ETH balance. Showing the last saved result.' };
  }
  return undefined;
}

export default function Profile() {
  const address = useWallet(s => s.address)!;
  const hidden = usePreferences(s => s.hideBalances);
  const autoRefresh = usePreferences(s => s.autoRefresh);
  const profile = usePreferences(s => s.profiles[address.toLowerCase()]);
  const saveProfile = usePreferences(s => s.saveProfile);
  const [displayName, setDisplayName] = useState(profile?.displayName ?? '');
  const [walletLabel, setWalletLabel] = useState(profile?.walletLabel ?? '');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const walletInput = useRef<TextInput>(null);
  const balances = useQuery({ queryKey: ['holdings', address], queryFn: () => fetchHoldings(address), refetchInterval: autoRefresh ? 30_000 : false });
  const eth = useQuery({ queryKey: ['eth', address], queryFn: () => fetchEthBalance(address), refetchInterval: autoRefresh ? 30_000 : false });
  const { refreshing, onRefresh } = usePullToRefresh(() => Promise.all([balances.refetch(), eth.refetch()]));

  const save = async () => {
    setSaving(true);
    try {
      await saveProfile(address, { displayName: displayName.trim(), walletLabel: walletLabel.trim() });
      setSaved(true);
    } catch {
      Alert.alert('Could not save profile', 'Please try again.');
    } finally {
      setSaving(false);
    }
  };
  const share = () => { Share.share({ message: address }).catch(() => Alert.alert('Could not share', 'Try again.')); };

  const notice = balanceNotice(balances, eth);
  const holdings = balances.data?.holdings ?? [];

  return (
    <Page nested title="Profile & wallet" refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.muted} />}>
      <PreviewBanner />

      <Card style={styles.wallet}>
        <View style={styles.walletHead}>
          <CoinbaseLogo size={28} />
          <H2 numberOfLines={1} style={styles.walletName}>{profile?.walletLabel || 'Coinbase wallet'}</H2>
          <Badge text="Base" tone="base" />
        </View>
        <Mono selectable numberOfLines={1} ellipsizeMode="middle" style={styles.address}>{address}</Mono>
        <Button title="Share address" variant="ghost" size="md" onPress={share} />
        <Caption>Receive assets only on the Base network.</Caption>
      </Card>

      <View style={appStyles.section}>
        <SectionHeader title="Balances" />
        <View style={appStyles.group}>
          <SettingRow icon="dollarsign.circle" title="USDC" detail="Available stablecoin balance"
            trailing={<Mono>{balanceText(balances, hidden, b => money(b.usdc))}</Mono>} />
          <View style={appStyles.divider} />
          <SettingRow icon="fuelpump" title="ETH" detail="Network fees" trailing={<Mono>{balanceText(eth, hidden, v => v.toFixed(6))}</Mono>} />
        </View>
        {notice ? <Banner tone={notice.tone} icon="exclamationmark.triangle" text={notice.text} action={{ label: 'Retry', onPress: onRefresh }} /> : null}
        {holdings.length ? (
          <View>
            {holdings.map((h, i) => (
              <ListRow key={h.stock.token} first={i === 0} leading={<Logo symbol={h.stock.symbol} size={40} />}
                title={h.stock.name} subtitle={h.stock.symbol.replace(/c$/, '')}
                value={hidden ? '••••' : `${h.shares.toFixed(4)} shares`}
                accessibilityLabel={`${h.stock.name}, ${hidden ? 'shares hidden' : `${h.shares.toFixed(4)} shares`}`} />
            ))}
          </View>
        ) : null}
        {balances.data && !balances.data.incomplete && !holdings.length ? <Muted>No tokenized stock positions in this wallet yet.</Muted> : null}
      </View>

      <View style={appStyles.section}>
        <SectionHeader title="Labels" caption="Saved only on this device." />
        <Field label="Display name">
          <TextInput accessibilityLabel="Display name" value={displayName} onChangeText={v => { setDisplayName(v); setSaved(false); }}
            placeholder="Your name" placeholderTextColor={colors.muted} maxLength={40} style={appStyles.input} autoComplete="name"
            returnKeyType="next" submitBehavior="submit" onSubmitEditing={() => walletInput.current?.focus()} />
        </Field>
        <Field label="Wallet label" hint="Does not change your Coinbase account or wallet address.">
          <TextInput ref={walletInput} accessibilityLabel="Wallet label" value={walletLabel} onChangeText={v => { setWalletLabel(v); setSaved(false); }}
            placeholder="My Coinbase wallet" placeholderTextColor={colors.muted} maxLength={40} style={appStyles.input}
            returnKeyType="done" onSubmitEditing={save} />
        </Field>
        <Button title={saved ? 'Saved' : 'Save labels'} variant={saved ? 'ghost' : 'primary'} loading={saving} onPress={save} />
      </View>
    </Page>
  );
}

const styles = StyleSheet.create({
  wallet: { gap: space.lg - 2 },
  walletHead: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  walletName: { flex: 1, minWidth: 0 },
  address: { fontSize: 13, lineHeight: 20 },
});
