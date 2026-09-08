import '@/polyfills';
import React, { useEffect, useRef } from 'react';
import { ActivityIndicator, AppState, Platform, View } from 'react-native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { focusManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useWallet } from '@/lib/wallet';
import { WebNavigationHeader } from '@/components/web-navigation-header';
import { AppFrame } from '@/components/app-frame';
import { colors } from '@/lib/theme';
import { usePreferences } from '@/lib/preferences';
import { onSessionInvalidated } from '@/lib/session';
import { expireSessionQueries } from '@/lib/session-queries';

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 15_000, retry: 1 } },
});

export default function RootLayout() {
  const hydrate = useWallet((s) => s.hydrate);
  const { address, hydrated } = useWallet();
  const previous = useRef(address);
  useEffect(() => {
    hydrate().catch(() => {});
    usePreferences.getState().hydrate();
  }, [hydrate]);
  useEffect(() => { if (previous.current && previous.current !== address) queryClient.clear(); previous.current = address; }, [address]);
  useEffect(() => onSessionInvalidated(() => expireSessionQueries(queryClient)), []);
  useEffect(() => {
    if (Platform.OS === 'web') return;
    focusManager.setFocused(AppState.currentState === 'active');
    const listener = AppState.addEventListener('change', state => focusManager.setFocused(state === 'active'));
    return () => listener.remove();
  }, []);
  if (!hydrated) return <AppFrame><View style={{ flex: 1, backgroundColor: colors.bg, justifyContent: 'center' }}><ActivityIndicator color={colors.link} /></View></AppFrame>;

  return (
    <QueryClientProvider client={queryClient}>
      <AppFrame>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          header: Platform.OS === 'web' ? props => <WebNavigationHeader {...props} /> : undefined,
          headerStyle: { backgroundColor: colors.bg },
          headerTintColor: colors.text,
          headerShadowVisible: false,
          contentStyle: { backgroundColor: colors.bg },
          headerBackButtonDisplayMode: 'minimal',
        }}
      >
        <Stack.Protected guard={!address}><Stack.Screen name="index" options={{ headerShown: false }} /></Stack.Protected>
        <Stack.Protected guard={!!address}>
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="new-mandate" options={{ title: 'New mandate', presentation: 'modal' }} />
          {/* Nested pages own their title in content (34pt); the native bar carries only the back chevron. */}
          <Stack.Screen name="mandate/[id]" options={{ title: 'Mandate', headerTitle: '' }} />
          <Stack.Screen name="profile" options={{ title: 'Profile & wallet', headerTitle: '' }} />
          <Stack.Screen name="ai-settings" options={{ title: 'AI settings', headerTitle: '' }} />
          <Stack.Screen name="order/[id]" options={{ title: 'Order', headerTitle: '' }} />
        </Stack.Protected>
      </Stack>
      </AppFrame>
    </QueryClientProvider>
  );
}
