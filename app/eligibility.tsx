import React, { useState } from 'react';
import { Pressable, TextInput, View } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useWallet } from '@/lib/wallet';
import { colors } from '@/lib/theme';
import { Page } from '@/components/app-ui';
import { Body, Button, Card, H2, Muted } from '@/components/ui';
import { AccountAccess } from '@/components/account-access';

export default function EligibilityScreen() {
  return <Page title="Trading eligibility"><AccountAccess showEligibility={false}><EligibilityForm /></AccountAccess></Page>;
}
function EligibilityForm() {
  const address = useWallet(s => s.address);
  const qc = useQueryClient();
  const status = useQuery({ queryKey: ['eligibility', address], queryFn: api.eligibility, retry: false, refetchOnWindowFocus: 'always' });
  const location = useQuery({ queryKey: ['eligibility-location', address], queryFn: api.location, retry: false, refetchOnWindowFocus: 'always' });
  const [residence, setResidence] = useState('');
  const [countryQuery, setCountryQuery] = useState('');
  const [sameCountry, setSameCountry] = useState(false);
  const [nonUsPerson, setNonUsPerson] = useState(false);
  const [eligibleJurisdiction, setEligibleJurisdiction] = useState(false);
  const [accurate, setAccurate] = useState(false);
  const country = location.data?.country;
  const countryName = (code: string) => { try { return new Intl.DisplayNames(['en'], { type: 'region' }).of(code) ?? code; } catch { return code; } };
  const declaredCountry = sameCountry ? country ?? '' : residence.trim().toUpperCase();
  const confirm = useMutation({
    mutationFn: () => api.declareEligibility({ version: status.data!.version, residenceCountry: declaredCountry, nonUsPerson, eligibleJurisdiction, accurate }),
    onSuccess: data => { qc.setQueryData(['eligibility', address], data); void qc.invalidateQueries({ queryKey: ['agent'] }); },
  });
  const withdraw = useMutation({ mutationFn: api.withdrawEligibility, onSuccess: data => qc.setQueryData(['eligibility', address], data) });
  return <>
    <Card style={{ gap: 12 }}>
      <H2>{status.data?.allowed ? 'Trading access confirmed' : 'Confirm before trading'}</H2>
      <Body>Tokenized stocks are available only to eligible users outside the United States. U.S. persons and residents of restricted jurisdictions cannot trade through Mandate.</Body>
      <Muted>We check your connection country and store your declaration with your wallet. This does not verify your identity or residency. Do not use a VPN or proxy to bypass restrictions.</Muted>
      <Muted>Automatic trading pauses unless you open Mandate for a location check at least once every 24 hours. Your declaration lasts 30 days. Pauses also stop automatic risk exits.</Muted>
    </Card>
    <Card style={{ gap: 14 }}>
      <H2>Your eligibility</H2>
      <Body>Connection location: {country ? countryName(country) : 'Unable to verify'}</Body>
      {location.data && !location.data.locationAllowed ? <Body style={{ color: colors.amber }}>Trading is unavailable from this connection. Account access, cancellation and revocation remain available.</Body> : null}
      {country && location.data?.locationAllowed ? <Check label={`I reside in ${countryName(country)}`} value={sameCountry} onChange={setSameCountry} /> : null}
      {!sameCountry ? <View style={{ gap: 6 }}>
        <Body>Country of residence</Body>
        <TextInput accessibilityLabel="Country of residence" placeholder="Search your country" placeholderTextColor={colors.muted} autoCapitalize="words" autoCorrect={false} value={countryQuery} onChangeText={text => { setCountryQuery(text); setResidence(''); }} style={{ color: colors.text, borderColor: colors.border, borderWidth: 1, borderRadius: 12, padding: 14, fontSize: 16 }} />
        {!residence && countryQuery.trim() ? location.data?.countries.filter(item => item.name.toLowerCase().includes(countryQuery.trim().toLowerCase()) || item.code.toLowerCase() === countryQuery.trim().toLowerCase()).slice(0, 8).map(item => <Pressable key={item.code} accessibilityRole="button" accessibilityLabel={item.name} onPress={() => { setResidence(item.code); setCountryQuery(item.name); }} style={{ paddingVertical: 12 }}><Body>{item.name}</Body></Pressable>) : null}
      </View> : null}
      <Check label="I am not a U.S. person and I am not located in the United States or its territories." value={nonUsPerson} onChange={setNonUsPerson} />
      <Check label="I am eligible to use Coinbase Tokenized Stocks in my country and am not subject to applicable jurisdiction restrictions." value={eligibleJurisdiction} onChange={setEligibleJurisdiction} />
      <Check label="This information is accurate. I will update it if my eligibility changes." value={accurate} onChange={setAccurate} />
      <Button title="Confirm eligibility" loading={confirm.isPending} disabled={!status.data || !location.data?.locationAllowed || declaredCountry.length !== 2 || !nonUsPerson || !eligibleJurisdiction || !accurate} onPress={() => confirm.mutate()} />
      {status.data ? <Muted accessibilityLiveRegion="polite">{status.data.reason}</Muted> : null}
      {status.error || location.error || confirm.error ? <Body accessibilityRole="alert" style={{ color: colors.amber }}>{(confirm.error ?? status.error ?? location.error)?.message}</Body> : null}
      <Button title="Refresh location check" variant="link" onPress={() => { void location.refetch(); void status.refetch(); }} />
      <Button title="Withdraw eligibility and pause trading" variant="link" loading={withdraw.isPending} onPress={() => withdraw.mutate()} />
      {withdraw.error ? <Body accessibilityRole="alert">{withdraw.error.message}</Body> : null}
    </Card>
  </>;
}
function Check({ label, value, onChange }: { label: string; value: boolean; onChange: (value: boolean) => void }) {
  return <Pressable accessibilityRole="checkbox" accessibilityLabel={label} accessibilityState={{ checked: value }} onPress={() => onChange(!value)} style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 12, paddingVertical: 8 }}>
    <View style={{ width: 24, height: 24, borderRadius: 6, borderWidth: 1, borderColor: value ? colors.link : colors.muted, backgroundColor: value ? colors.base : 'transparent', alignItems: 'center', justifyContent: 'center' }}><Body>{value ? '✓' : ''}</Body></View>
    <Body style={{ flex: 1 }}>{label}</Body>
  </Pressable>;
}
