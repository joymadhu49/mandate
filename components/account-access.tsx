// Gate for wallet-scoped content. Verifies the connected wallet with a sign-in
// message (not a spending approval) before private data is requested.
import React from 'react';
import { EligibilityAccess } from './eligibility-access';
import { StyleSheet, View } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { signInMessage, useWallet } from '@/lib/wallet';
import { colors } from '@/lib/theme';
import { Body, Button, Card, H2, Muted } from './ui';
import { Icon } from './app-ui';

/** A 401 is the expected "not signed in yet" answer, not an outage worth a message. */
const isUnauthorized = (error: Error) => 'status' in error && error.status === 401;

export function AccountAccess({ children, showEligibility = true, trading = false }: { children: React.ReactNode; showEligibility?: boolean; trading?: boolean }) {
  const address = useWallet(s => s.address)!;
  const qc = useQueryClient();
  const session = useQuery({
    queryKey: ['session', address], queryFn: api.session, retry: false, staleTime: 30_000, refetchInterval: 60_000, refetchOnWindowFocus: 'always',
  });
  const verify = useMutation({
    mutationFn: () => api.verifyWallet(address, message => signInMessage(address, message)),
    onSuccess: () => qc.invalidateQueries(),
  });
  if (session.data?.account.toLowerCase() === address?.toLowerCase() && !session.isError) return showEligibility ? <EligibilityAccess blocking={trading}>{children}</EligibilityAccess> : <>{children}</>;
  return (
    <Card style={styles.card}>
      <View style={styles.head}>
        <Icon name="person.badge.key" size={22} color={colors.link} />
        <H2 accessibilityRole="header" accessibilityLiveRegion="polite" style={styles.title}>
          {session.isPending ? 'Connecting to your account…' : 'Verify your wallet'}
        </H2>
      </View>
      <Body style={styles.body}>
        Sign a short message with your Coinbase wallet to unlock mandates, chat, orders and history. This is a sign-in, not a spending approval.
      </Body>
      {!session.isPending ? <Button title="Verify wallet" onPress={() => verify.mutate()} loading={verify.isPending} /> : null}
      {verify.error ? <Muted accessibilityRole="alert" style={styles.error}>{verify.error.message}</Muted> : null}
      {session.isError && !isUnauthorized(session.error) ? <Muted accessibilityRole="alert" style={styles.error}>{session.error.message}</Muted> : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { gap: 14 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  title: { flex: 1 },
  body: { color: colors.muted },
  error: { color: colors.amber },
});
