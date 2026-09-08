// Settings → "Swap $1 with your wallet": the user's own Coinbase wallet signs and pays for a real $1 ETH → USDC swap on Base.
// It proves the LI.FI route and the wallet round trip without the agent's spender. The figures are the terms of a transaction
// the user is about to sign, not balances, so Hide balances does not mask them: hiding them would hide what the wallet is about to do.
import React, { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import { useMutation, useQuery, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import { api, type WalletSwapPlan } from '@/lib/api';
import { publicClient, shortAddr } from '@/lib/chain';
import { openTransaction } from '@/lib/links';
import { PREVIEW_ACCOUNT } from '@/lib/preview';
import type { Address } from '@/lib/stocks';
import { colors, money, space } from '@/lib/theme';
import { countdownLabel } from '@/lib/ui-presentation';
import { sendTransaction, useWallet } from '@/lib/wallet';
import { Badge, Body, Button, Caption, Card, Muted } from './ui';
import { Banner, DetailRow, Sheet, SkeletonRows, useNow } from './app-ui';

/** Fixed test size: small enough to be harmless, large enough to survive slippage and gas. */
const TEST_USD = 1;
/** Base confirms in seconds; two minutes covers a slow bundler before the sheet points at Basescan instead. */
const RECEIPT_TIMEOUT_MS = 120_000;

type Hash = `0x${string}`;
type Receipt = Awaited<ReturnType<typeof publicClient.waitForTransactionReceipt>>;
type SignInput = { from: Address; plan: WalletSwapPlan };
type ConfirmState = UseMutationResult<Receipt, Error, Hash>;

const eth = (n: number) => `${n.toFixed(6)} ETH`;
/** "0.000403 ETH at $2,484.45": what leaves the wallet, and the price the quote used. */
const sendText = (plan: WalletSwapPlan) => `${eth(plan.ethAmount)} at ${money(plan.ethPrice)}`;
const receiveText = (plan: WalletSwapPlan) => `${money(plan.expectedUsdc)} USDC, min ${money(plan.minUsdc)}`;
const routeText = (plan: WalletSwapPlan) => `${plan.tool} · LI.FI`;
const quoteExpired = (plan: WalletSwapPlan, now: number) => now >= plan.expiresAt * 1000;

/** "Expires in 0:41" while the quote is live, "Expired" after, "Signed" once the wallet has used it. */
function validityText(plan: WalletSwapPlan, now: number, submitted: boolean) {
  if (submitted) return 'Signed';
  return quoteExpired(plan, now) ? 'Expired' : `Expires in ${countdownLabel(plan.expiresAt, now)}`;
}

const cancelled = (error: Error) => /reject|cancel/i.test(error.message);

/** The wallet's failure in the user's terms: what happened and what to do next. */
function walletErrorText(error: Error) {
  if (cancelled(error)) return 'Cancelled in Coinbase. Nothing was sent.';
  if (/unauthori[sz]ed/i.test(error.message)) return 'Your Coinbase session has ended. Sign out, connect again, then retry.';
  return error.message;
}

/** viem gives up after RECEIPT_TIMEOUT_MS; anything else is a failed read of Base, not a failed swap. */
function confirmErrorText(error: Error) {
  return /timed out/i.test(error.message)
    ? 'Not confirmed after two minutes. The swap may still land; check Basescan or check again.'
    : 'Could not read the transaction from Base. Check again in a moment.';
}

export function WalletSwapSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const address = useWallet(s => s.address);
  const now = useNow(1000);
  // The preview account has no wallet behind it: it shows the quote and says why the button is off.
  const preview = __DEV__ && address?.toLowerCase() === PREVIEW_ACCOUNT.toLowerCase();
  // Fresh on every open: a quote lives about 45 seconds.
  const plan = useQuery({ queryKey: ['wallet-swap-plan'], queryFn: () => api.walletSwapPlan(TEST_USD), enabled: visible, staleTime: 0, retry: false });
  const confirm = useMutation({
    mutationFn: async (hash: Hash) => {
      const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: RECEIPT_TIMEOUT_MS });
      // The wallet's ETH and USDC changed on-chain; Home and Profile must not keep showing pre-swap balances.
      if (receipt.status === 'success') {
        await Promise.all([qc.invalidateQueries({ queryKey: ['holdings'] }), qc.invalidateQueries({ queryKey: ['eth'] })]);
      }
      return receipt;
    },
  });
  const track = confirm.mutate;
  const sign = useMutation({
    mutationFn: ({ from, plan: quote }: SignInput) => {
      if (quote.account.toLowerCase() !== from.toLowerCase()) throw new Error('This quote is for a different wallet. Close the sheet and open it again.');
      return sendTransaction(from, quote.tx);
    },
    onSuccess: hash => track(hash),
  });
  const resetSign = sign.reset;
  const resetConfirm = confirm.reset;
  // A previous visit's result or error must not greet the next open.
  useEffect(() => { if (visible) { resetSign(); resetConfirm(); } }, [visible, resetSign, resetConfirm]);

  const hash = sign.data;
  const submitted = !!hash;
  // Once signed, the figures stay pinned to the quote the wallet actually used, even if a fresh one arrives.
  const shown = (submitted && sign.variables?.plan) || plan.data;
  const expired = !!plan.data && !submitted && quoteExpired(plan.data, now);
  const canSign = !!address && !!plan.data && !expired && !plan.isFetching;

  const footer = (
    <>
      {preview ? <PreviewAction /> : submitted ? null : (
        <Button title="Sign in Coinbase" loading={sign.isPending} disabled={!canSign}
          onPress={() => { if (address && plan.data) sign.mutate({ from: address, plan: plan.data }); }}
          accessibilityHint="Opens Coinbase to confirm a real transaction from your wallet on Base" />
      )}
      <Button title="Close" onPress={onClose} variant="ghost" />
    </>
  );
  return (
    <Sheet visible={visible} onClose={onClose} title="Swap $1 with your wallet" subtitle="Your Coinbase wallet signs and pays for this swap" footer={footer}>
      <Body style={styles.explain}>
        Mandate prepares a real $1 ETH → USDC swap on Base through LI.FI. Review it here, then your Coinbase wallet opens to confirm. The USDC lands
        in your wallet. This proves the route and the wallet round trip; the agent’s spender is not involved.
      </Body>
      {plan.isPending ? <SkeletonRows count={6} leading={false} /> : null}
      {plan.isError ? (
        <Banner tone="red" icon="wifi.exclamationmark" text={plan.error.message} action={{ label: 'Retry', onPress: () => plan.refetch() }} />
      ) : null}
      {shown ? <PlanDetails plan={shown} now={now} submitted={submitted} refreshing={plan.isFetching} onRefresh={() => plan.refetch()} /> : null}
      {sign.isPending ? <Banner tone="base" icon="hand.tap" live text="Confirm in Coinbase, then return to Mandate…" /> : null}
      {sign.error ? (
        <Banner tone={cancelled(sign.error) ? 'muted' : 'red'} icon={cancelled(sign.error) ? 'xmark.circle' : 'exclamationmark.triangle'} live
          text={walletErrorText(sign.error)} />
      ) : null}
      {hash && shown ? <Outcome plan={shown} hash={hash} confirm={confirm} /> : null}
    </Sheet>
  );
}

/** The terms the wallet will sign, with the quote's countdown; the gas note sits with them because it is part of the cost. */
function PlanDetails({ plan, now, submitted, refreshing, onRefresh }: {
  plan: WalletSwapPlan; now: number; submitted: boolean; refreshing: boolean; onRefresh: () => void;
}) {
  const expired = !submitted && quoteExpired(plan, now);
  return (
    <>
      <Card style={styles.details}>
        <Body accessibilityRole="header" style={styles.cardTitle}>What you will sign</Body>
        <DetailRow label="From" value={shortAddr(plan.account)} />
        <DetailRow label="Send" value={sendText(plan)} />
        <DetailRow label="To" value={`${shortAddr(plan.router)} · LI.FI`} />
        <DetailRow label="Receive" value={receiveText(plan)} />
        <DetailRow label="Network" value="Base" />
        <DetailRow label="Quote valid" value={validityText(plan, now, submitted)} tone={expired ? 'amber' : submitted ? 'green' : undefined} />
      </Card>
      {expired ? (
        <Banner tone="amber" icon="clock" live text={refreshing ? 'Getting a new quote…' : 'Quote expired. Refresh to get a new one.'}
          action={refreshing ? undefined : { label: 'Refresh', onPress: onRefresh }} />
      ) : null}
      <Banner tone="base" icon="info.circle"
        text="Your wallet pays the gas, well under a cent on Base." />
    </>
  );
}

/** After signing: waiting, confirmed, reverted, or unreadable. The Basescan link is there in every state. */
function Outcome({ plan, hash, confirm }: { plan: WalletSwapPlan; hash: Hash; confirm: ConfirmState }) {
  if (confirm.data?.status === 'success') return <SwapResult plan={plan} hash={hash} />;
  return (
    <View style={styles.stack}>
      {confirm.data
        ? <Banner tone="red" icon="exclamationmark.triangle" live text="The swap reverted on Base. No USDC received; gas was spent." />
        : confirm.error
          ? <Banner tone="amber" icon="clock" live text={confirmErrorText(confirm.error)}
              action={{ label: 'Check again', onPress: () => confirm.mutate(hash) }} />
          : <Banner tone="amber" icon="clock" live text="Submitted · waiting for confirmation on Base" />}
      <TransactionLink hash={hash} />
    </View>
  );
}

/** One VoiceOver element for the figures; the Basescan link stays separately focusable. */
function SwapResult({ plan, hash }: { plan: WalletSwapPlan; hash: Hash }) {
  const label = `Confirmed on Base. Sent ${eth(plan.ethAmount)} via ${routeText(plan)}. The USDC is in your wallet.`;
  return (
    <Card style={styles.details}>
      <View accessible accessibilityLabel={label} accessibilityLiveRegion="polite" style={styles.resultBody}>
        <Badge text="Confirmed on Base" tone="green" />
        <DetailRow label="Sent" value={eth(plan.ethAmount)} />
        <DetailRow label="Route" value={routeText(plan)} />
      </View>
      <TransactionLink hash={hash} />
    </Card>
  );
}

function TransactionLink({ hash }: { hash: Hash }) {
  return (
    <View style={styles.linkRow}>
      <Muted>Transaction</Muted>
      <Button variant="link" size="md" title="View on Basescan" onPress={() => openTransaction(hash)} />
    </View>
  );
}

/** The dev preview account has no wallet behind it, so the action explains itself instead of opening Coinbase. */
function PreviewAction() {
  return (
    <>
      <Button title="Sign in Coinbase" onPress={() => undefined} disabled />
      <Caption style={styles.footnote}>Connect a real wallet to sign.</Caption>
    </>
  );
}

const styles = StyleSheet.create({
  explain: { color: colors.muted },
  details: { paddingVertical: space.sm },
  cardTitle: { fontWeight: '600', paddingBottom: 4 },
  stack: { gap: space.md },
  resultBody: { gap: space.xs, paddingBottom: space.xs },
  // Mirrors DetailRow but centers vertically, since the 44pt link button is taller than a text value.
  linkRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: space.md },
  footnote: { textAlign: 'center', color: colors.muted },
});
