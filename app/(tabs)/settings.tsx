import React, { useState } from 'react';
import { StyleSheet, Switch, View } from 'react-native';
import { Alert } from '@/lib/browser-dialogs';
import { useIsFocused, useRouter } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Banner, ConfirmSheet, DetailRow, Icon, Page, PreviewBanner, SectionHeader, SettingRow, appStyles } from '@/components/app-ui';
import { Card, Mono, Muted } from '@/components/ui';
import { WalletSwapSheet } from '@/components/wallet-swap-test';
import { AgentAccountSheet, TOP_UP_ETH, feesLow, feesText, useAgentFees } from '@/components/agent-account-sheet';
import { useWallet } from '@/lib/wallet';
import { usePreferences } from '@/lib/preferences';
import { api, type AgentInfo } from '@/lib/api';
import { clearAIAccess } from '@/lib/ai-access';
import { shortAddr } from '@/lib/chain';
import { colors, space } from '@/lib/theme';
import { modeLabel } from '@/lib/ui-presentation';

type AgentState = { data?: AgentInfo; isError: boolean };

// Every screen derives its mode from ['agent']; the rest carry per-mode data (simulated vs live rows, proposals).
const MODE_DEPENDENT_QUERIES = ['agent', 'mandates', 'orders', 'activity', 'chat'] as const;

/** AI row detail: the model when connected, otherwise the next step. */
function aiDetail(agent: AgentState) {
  if (agent.data) return agent.data.ai.configured ? agent.data.model : 'Not connected';
  return agent.isError ? 'Agent unavailable' : modeLabel(undefined);
}

/** Never claim a mode while the backend cannot be reached. */
function modeDetail(agent: AgentState) {
  return agent.isError && !agent.data ? 'Agent unavailable' : modeLabel(agent.data?.dryRun);
}

/** The switch row says what the position means in money terms; while connecting it says nothing about mode. */
function liveDetail(agent: AgentState) {
  if (agent.data) return agent.data.dryRun ? 'Off · trades are simulated' : 'On · trades use real funds';
  return agent.isError ? 'Agent unavailable' : modeLabel(undefined);
}

/** The backend only names the wallet's agent address to a verified session, so "not yet" is a next step, not a fault. */
function agentAccountDetail(agent: AgentState) {
  if (agent.data) return agent.data.spender ? shortAddr(agent.data.spender) : 'Verify your wallet to see it';
  return agent.isError ? 'Agent unavailable' : '—';
}

function PreferenceSwitch({ label, value, onChange, disabled }: { label: string; value: boolean; onChange: (value: boolean) => void; disabled?: boolean }) {
  return <Switch accessibilityLabel={label} value={value} onValueChange={onChange} disabled={disabled} trackColor={{ true: colors.base }} />;
}

export default function Settings() {
  const router = useRouter();
  const qc = useQueryClient();
  const focused = useIsFocused();
  const address = useWallet(s => s.address);
  const disconnect = useWallet(s => s.disconnect);
  const profile = usePreferences(s => s.profiles[address?.toLowerCase() ?? '']);
  const hideBalances = usePreferences(s => s.hideBalances);
  const autoRefresh = usePreferences(s => s.autoRefresh);
  const update = usePreferences(s => s.update);
  const [confirmingLive, setConfirmingLive] = useState(false);
  const [walletSwapOpen, setWalletSwapOpen] = useState(false);
  const [agentAccountOpen, setAgentAccountOpen] = useState(false);
  const agent = useQuery({ queryKey: ['agent'], queryFn: api.agent });
  const spender = agent.data?.spender;
  const gas = useAgentFees(spender, { poll: focused });
  const dryRun = agent.data?.dryRun;
  const lowGas = dryRun === false && feesLow(gas);
  const liveUnavailable = !!agent.data && agent.data.liveAvailable === false;
  const setMode = useMutation({
    mutationFn: (live: boolean) => api.setMode(live),
    onSuccess: () => {
      setConfirmingLive(false);
      for (const key of MODE_DEPENDENT_QUERIES) void qc.invalidateQueries({ queryKey: [key] });
    },
    // The sheet stays up on failure so the alert lands on top of it and the user can try again or keep simulating.
    onError: (e: Error) => Alert.alert('Could not switch mode', e.message),
  });
  const change = (values: Parameters<typeof update>[0]) => update(values).catch(() => Alert.alert('Could not save', 'Please try again.'));
  const toggleLive = (live: boolean) => {
    if (live) { setConfirmingLive(true); return; }
    Alert.alert('Switch back to simulation?', 'Live mandates pause until you switch live again. Nothing is revoked.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Switch', onPress: () => setMode.mutate(false) },
    ]);
  };
  const signOut = () => Alert.alert(
    'Sign out of Mandate?',
    'Active mandates keep running. Revoke them first if you want the agent to stop trading.',
    [
      { text: 'Stay signed in', style: 'cancel' },
      { text: 'Sign out', style: 'destructive', onPress: async () => {
        try { await api.logout(); } catch { /* Local sign-out must work offline. */ }
        try { await clearAIAccess(); await disconnect(); qc.clear(); } catch { Alert.alert('Could not sign out', 'Please try again.'); }
      } },
    ],
  );

  return (
    <Page title="Settings">
      <PreviewBanner />
      <View style={appStyles.group}>
        <SettingRow icon="person.crop.circle" title={profile?.displayName || 'Profile & wallet'} detail={profile?.walletLabel || shortAddr(address)}
          onPress={() => router.push('/profile')} />
      </View>

      <View style={appStyles.section}>
        <SectionHeader title="Agent" />
        <View style={appStyles.group}>
          <SettingRow icon="sparkles" title="AI settings" detail={aiDetail(agent)} onPress={() => router.push('/ai-settings')} />
          <View style={appStyles.divider} />
          <SettingRow icon="shield.lefthalf.filled" title="Execution mode" detail={modeDetail(agent)}
            trailing={<Icon name="checkmark.seal" size={18} color={colors.muted} />} />
        </View>
        {agent.isError
          ? <Banner tone="red" icon="wifi.exclamationmark" text={agent.error.message} action={{ label: 'Retry', onPress: () => agent.refetch() }} />
          : null}
      </View>

      <View style={appStyles.section}>
        <SectionHeader title="Live trading" />
        <SettingRow icon="lock.shield" title="Trading eligibility" detail="Review your location and eligibility declaration" onPress={() => router.push('/eligibility')} />
        <View style={appStyles.group}>
          <SettingRow icon="bolt.fill" title="Live mode" detail={liveDetail(agent)}
            trailing={<PreferenceSwitch label="Live mode" value={!!agent.data && !agent.data.dryRun} onChange={toggleLive}
              disabled={!agent.data || agent.isError || setMode.isPending || liveUnavailable} />} />
          <View style={appStyles.divider} />
          <SettingRow icon="person.badge.key" title="Your agent account" detail={agentAccountDetail(agent)}
            onPress={spender ? () => setAgentAccountOpen(true) : undefined}
            trailing={spender ? (
              <View style={styles.trailing}>
                <Mono>{feesText(gas, hideBalances)}</Mono>
                <Icon name="chevron.right" size={13} color={colors.faint} />
              </View>
            ) : undefined} />
          <View style={appStyles.divider} />
          <SettingRow icon="signature" title="Swap $1 with your wallet" detail="A real swap on Base, signed in Coinbase"
            onPress={() => setWalletSwapOpen(true)} />
        </View>
        {lowGas ? (
          <Banner tone="amber" icon="exclamationmark.triangle" live onPress={() => setAgentAccountOpen(true)}
            text={`Agent account needs ETH for fees. Send ${TOP_UP_ETH} ETH on Base.`} />
        ) : null}
        {liveUnavailable ? <Muted>Live mode needs a persistent spender key on the backend.</Muted> : null}
        <Muted>Live mode applies to every wallet on this backend.</Muted>
      </View>

      <View style={appStyles.section}>
        <SectionHeader title="Preferences" />
        <View style={appStyles.group}>
          <SettingRow icon="eye.slash" title="Hide balances" detail="Mask amounts on this device"
            trailing={<PreferenceSwitch label="Hide balances" value={hideBalances} onChange={hideBalances => change({ hideBalances })} />} />
          <View style={appStyles.divider} />
          <SettingRow icon="arrow.clockwise" title="Auto-refresh" detail="Refresh balances and market prices"
            trailing={<PreferenceSwitch label="Auto-refresh" value={autoRefresh} onChange={autoRefresh => change({ autoRefresh })} />} />
        </View>
      </View>

      <View style={appStyles.group}>
        <SettingRow icon="info.circle" title="About" detail="Version 0.1.0 · Base network" />
      </View>
      <View style={appStyles.group}>
        <SettingRow icon="rectangle.portrait.and.arrow.right" title="Sign out" danger onPress={signOut} />
      </View>

      <LiveModeSheet visible={confirmingLive} onClose={() => setConfirmingLive(false)} onConfirm={() => setMode.mutate(true)} loading={setMode.isPending}
        spender={agentAccountDetail(agent)} gas={feesText(gas, hideBalances)}
        ai={agent.data?.ai.configured ? agent.data.model : 'Not connected · chat unavailable'} />
      {spender ? (
        <AgentAccountSheet visible={agentAccountOpen} onClose={() => setAgentAccountOpen(false)} spender={spender} fees={gas} live={dryRun === false}
          hidden={hideBalances} />
      ) : null}
      <WalletSwapSheet visible={walletSwapOpen} onClose={() => setWalletSwapOpen(false)} />
    </Page>
  );
}

/** Financial confirmation: what live mode will spend with, and what it will not do on its own. */
function LiveModeSheet({ visible, onClose, onConfirm, loading, spender, gas, ai }: {
  visible: boolean; onClose: () => void; onConfirm: () => void; loading: boolean; spender: string; gas: string; ai: string;
}) {
  return (
    <ConfirmSheet visible={visible} onClose={onClose} title="Switch to live trading?" subtitle="Real funds within your signed permissions"
      primary={{ label: 'Switch to live', onPress: onConfirm, loading, variant: 'primary' }} secondaryLabel="Keep simulating">
      <Card style={styles.details}>
        <DetailRow label="Agent account" value={spender} />
        <DetailRow label="ETH for fees" value={gas} />
        <DetailRow label="AI" value={ai} />
      </Card>
      <Banner tone="amber" icon="exclamationmark.triangle" text="Simulation mandates stay simulated. Create a new mandate to trade live." />
      <Muted>You can switch back any time. Executed live orders are not reversed.</Muted>
    </ConfirmSheet>
  );
}

const styles = StyleSheet.create({
  details: { paddingVertical: space.sm },
  trailing: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
});
