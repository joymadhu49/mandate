// Settings → "Your agent account": the address the backend derives for this wallet to submit its trades. It holds tokens only
// mid-trade, but it pays every network fee itself, so it needs a little ETH on Base before live orders can execute.
// The fee helpers live here so Settings and the Home checklist agree on one threshold and one wording.
import React from 'react';
import { StyleSheet } from 'react-native';
import { Alert, Share } from '@/lib/browser-dialogs';
import { useQuery } from '@tanstack/react-query';
import { fetchEthBalance } from '@/lib/chain';
import type { Address } from '@/lib/stocks';
import { colors, space } from '@/lib/theme';
import { Body, Button, Card, Mono } from './ui';
import { Banner, DetailRow, Sheet } from './app-ui';

export type FeesState = { data?: number; isError: boolean };

/** Below this the agent account cannot pay for a swap on Base. */
export const LOW_GAS_ETH = 0.002;
/** Registering one spend permission costs far less than a swap; below this even that fails. */
export const ACTIVATION_GAS_ETH = 0.0001;
/** Covers several trades; what every top-up sentence asks for. */
export const TOP_UP_ETH = 0.003;

/** The agent account's ETH on Base under the one shared key. Off until the backend has answered the address. */
export function useAgentFees(spender: Address | null | undefined, { enabled = true, poll = true }: { enabled?: boolean; poll?: boolean } = {}) {
  return useQuery({
    queryKey: ['spender-eth', spender], queryFn: () => fetchEthBalance(spender!), enabled: !!spender && enabled,
    refetchInterval: poll ? 60_000 : false,
  });
}

/** Masked first; then the last known balance, even while a refresh fails; "Unavailable" only with nothing to show. */
export function feesText(fees: FeesState, hidden: boolean) {
  if (hidden) return '••••';
  if (fees.data !== undefined) return `${fees.data.toFixed(4)} ETH`;
  return fees.isError ? 'Unavailable' : '—';
}

/** Only a balance in hand can be low or ready: an unknown balance is neither. */
export const feesLow = (fees: FeesState) => fees.data !== undefined && fees.data < LOW_GAS_ETH;
export const feesReady = (fees: FeesState) => fees.data !== undefined && fees.data >= LOW_GAS_ETH;

const EXPLANATION = 'Spends only within permissions you sign. Needs a little ETH on Base for fees.';

export function AgentAccountSheet({ visible, onClose, spender, fees, live, hidden }: {
  visible: boolean; onClose: () => void; spender: Address; fees: FeesState; live: boolean; hidden: boolean;
}) {
  // No clipboard module ships in this build; the iOS share sheet's first row is Copy.
  const share = () => { Share.share({ message: spender }).catch(() => Alert.alert('Could not share', 'Try again.')); };
  const footer = (
    <>
      <Button title="Copy address" onPress={share} accessibilityHint="Opens the share sheet, which includes Copy" />
      <Button title="Close" variant="ghost" onPress={onClose} />
    </>
  );
  return (
    <Sheet visible={visible} onClose={onClose} title="Your agent account" subtitle="Pays the network fees for your trades"
      footer={footer}>
      <Body style={styles.explanation}>{EXPLANATION}</Body>
      {/* Shown in full so it can be checked against a wallet's send screen character by character. */}
      <Mono selectable accessibilityLabel={`Agent account address ${spender}`} style={styles.address}>{spender}</Mono>
      <Card style={styles.details}>
        <DetailRow label="ETH for fees" value={feesText(fees, hidden)} />
      </Card>
      {live && feesLow(fees) ? (
        <Banner tone="amber" icon="exclamationmark.triangle" live text={`Send ${TOP_UP_ETH} ETH on Base to this address.`} />
      ) : null}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  explanation: { color: colors.muted },
  address: { fontSize: 13, lineHeight: 18 },
  details: { paddingVertical: space.sm },
});
