import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { api } from '@/lib/api';
import { useWallet } from '@/lib/wallet';
import { Body, Button, Card, H2, Muted } from './ui';

export function EligibilityAccess({ children, blocking = false }: { children: React.ReactNode; blocking?: boolean }) {
  const address = useWallet(s => s.address);
  const router = useRouter();
  const status = useQuery({ queryKey: ['eligibility', address], queryFn: api.eligibility, retry: false, refetchInterval: 60_000, refetchOnWindowFocus: 'always' });
  if (status.data?.allowed && !status.isError) return <>{children}</>;
  return <>
    <Card style={{ gap: 12, margin: blocking ? 20 : 0 }}>
      <H2>{status.isPending ? 'Checking trading access' : 'Trading access paused'}</H2>
      <Body>{status.error?.message ?? status.data?.reason ?? 'Checking your eligibility before trading.'}</Body>
      {!status.isPending ? <Button title="Review eligibility" onPress={() => router.push('/eligibility')} /> : null}
      <Muted>You can still view your account, cancel orders and revoke permissions.</Muted>
    </Card>
    {!blocking ? children : null}
  </>;
}
