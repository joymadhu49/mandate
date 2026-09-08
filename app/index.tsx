import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Body, Button, Caption, Muted } from '@/components/ui';
import { Banner, CoinbaseLogo, Icon, type IconName } from '@/components/app-ui';
import { useWallet } from '@/lib/wallet';
import { colors } from '@/lib/theme';
import { PREVIEW_ACCOUNT } from '@/lib/preview';

export default function Welcome() {
  const insets = useSafeAreaInsets();
  const connecting = useWallet(s => s.connecting);
  const connect = useWallet(s => s.connect);
  const [error, setError] = useState('');
  // Dev-only: `EXPO_PUBLIC_UI_PREVIEW=1 npx expo start` opens the sample-data preview on launch (same as the link below).
  useEffect(() => { if (__DEV__ && process.env.EXPO_PUBLIC_UI_PREVIEW === '1') useWallet.setState({ address: PREVIEW_ACCOUNT }); }, []);

  const onConnect = async () => {
    setError('');
    try {
      await connect();
    } catch (e) {
      setError(/reject|cancel/i.test(String(e)) ? 'Connection cancelled. You can try again.' : 'Could not connect to Coinbase. Please try again.');
    }
  };

  return (
    <ScrollView showsVerticalScrollIndicator={false} style={styles.screen}
      contentContainerStyle={[styles.content, { paddingTop: insets.top + 32, paddingBottom: insets.bottom + 24 }]}>
      <Body accessibilityRole="header" style={styles.wordmark}>Mandate</Body>
      <View style={styles.intro}>
        <Text accessibilityRole="header" style={styles.headline}>Your wallet.{'\n'}Your rules.</Text>
        <Body style={styles.lede}>Give your AI agent a budget and a plan. Keep control of your tokenized stocks on Base.</Body>
        <View style={styles.steps}>
          <Step icon="lock.shield" text="A weekly USDC budget the agent can’t exceed, enforced on-chain" />
          <Step icon="checkmark.bubble" text="Every trade is a proposal you confirm, or run it automatically" />
          <Step icon="hand.raised" text="Revoke any time in the app or at account.base.app" />
        </View>
      </View>
      <View style={styles.actions}>
        <Muted style={styles.note}>Available to eligible users outside the U.S.</Muted>
        <Pressable accessibilityRole="button" accessibilityLabel="Connect with Coinbase" accessibilityState={{ disabled: connecting, busy: connecting }}
          disabled={connecting} onPress={onConnect} style={({ pressed }) => [styles.coinbase, (pressed || connecting) && styles.coinbasePressed]}>
          {connecting
            ? <ActivityIndicator color={colors.base} />
            : <><CoinbaseLogo size={30} /><Text style={styles.coinbaseText}>Connect with Coinbase</Text></>}
        </Pressable>
        {error ? <Banner tone="amber" icon="exclamationmark.triangle" text={error} live /> : null}
        <Caption style={styles.note}>Connect your Coinbase Base Account with a passkey.</Caption>
        {__DEV__ ? <Button title="Preview app" variant="link" onPress={() => useWallet.setState({ address: PREVIEW_ACCOUNT })} /> : null}
      </View>
    </ScrollView>
  );
}

/** One line per mechanism. The list is the "how it works", so it carries no heading of its own. */
function Step({ icon, text }: { icon: IconName; text: string }) {
  return (
    <View style={styles.step}>
      <View style={styles.stepIcon}><Icon name={icon} size={18} color={colors.link} /></View>
      <Body style={styles.stepText}>{text}</Body>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { backgroundColor: colors.bg },
  // Welcome keeps its own 24pt outer padding: it is the one screen without page chrome.
  content: { flexGrow: 1, padding: 24, gap: 36 },
  wordmark: { fontSize: 30, lineHeight: 38, fontWeight: '600', letterSpacing: -0.9 },
  intro: { flex: 1, justifyContent: 'center', gap: 22, paddingVertical: 28 },
  headline: { color: colors.text, fontSize: 46, lineHeight: 51, fontWeight: '700', letterSpacing: -1.8 },
  lede: { color: colors.muted, fontSize: 18, lineHeight: 27 },
  steps: { gap: 14, marginTop: 6 },
  step: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  stepIcon: { width: 32, height: 32, borderRadius: 16, backgroundColor: colors.baseSoft, alignItems: 'center', justifyContent: 'center' },
  stepText: { flex: 1, fontSize: 16, lineHeight: 22 },
  actions: { gap: 14 },
  note: { textAlign: 'center' },
  // Identity exception documented in DESIGN.md: the Coinbase button is white, not Coinbase blue.
  coinbase: { backgroundColor: colors.white, borderRadius: 18, minHeight: 60, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 12 },
  coinbasePressed: { opacity: 0.75 },
  coinbaseText: { color: colors.onLight, fontSize: 17, fontWeight: '600' },
});
