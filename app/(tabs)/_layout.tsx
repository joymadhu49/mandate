// Mandate's established dark system with native, persistent navigation.
// Home shows balances; Agent chats; Orders manages pending trades; History explains
// results; Settings owns local preferences and account configuration.
import React from 'react';
import { NativeTabs } from 'expo-router/unstable-native-tabs';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useWallet } from '@/lib/wallet';
import { colors } from '@/lib/theme';
import { isOpenOrder } from '@/components/order-ui';

/** Queued/executing order count for the Orders badge; polled only once the wallet session is verified. */
function useOpenOrderBadge() {
  const address = useWallet(s => s.address);
  // Same key and options as AccountAccess so the session is one shared query and a lapsed
  // session never triggers a 401 storm from here.
  const session = useQuery({
    queryKey: ['session', address], queryFn: api.session, retry: false, staleTime: 30_000, refetchInterval: 60_000, refetchOnWindowFocus: 'always',
  });
  const verified = !session.isError && !!session.data?.account && session.data.account.toLowerCase() === address?.toLowerCase();
  const orders = useQuery({ queryKey: ['orders', address], queryFn: api.orders, enabled: verified, refetchInterval: 15_000 });
  const open = verified ? (orders.data ?? []).filter(isOpenOrder).length : 0;
  return open ? String(open) : undefined;
}

export default function TabLayout() {
  const badge = useOpenOrderBadge();
  return (
    <NativeTabs tintColor={colors.link} backgroundColor={colors.card} badgeBackgroundColor={colors.base} labelStyle={{ fontSize: 11 }}>
      <NativeTabs.Trigger name="home" disableAutomaticContentInsets disableTransparentOnScrollEdge>
        <NativeTabs.Trigger.Icon sf={{ default: 'house', selected: 'house.fill' }} />
        <NativeTabs.Trigger.Label>Home</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="agent" disableAutomaticContentInsets disableTransparentOnScrollEdge>
        <NativeTabs.Trigger.Icon sf={{ default: 'bubble.left.and.bubble.right', selected: 'bubble.left.and.bubble.right.fill' }} />
        <NativeTabs.Trigger.Label>Agent</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="orders" disableAutomaticContentInsets disableTransparentOnScrollEdge>
        <NativeTabs.Trigger.Icon sf="arrow.left.arrow.right" />
        <NativeTabs.Trigger.Label>Orders</NativeTabs.Trigger.Label>
        {/* An empty, un-hidden badge renders as a dot, so hide it whenever nothing is open. */}
        <NativeTabs.Trigger.Badge hidden={!badge}>{badge}</NativeTabs.Trigger.Badge>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="history" disableAutomaticContentInsets disableTransparentOnScrollEdge>
        <NativeTabs.Trigger.Icon sf="clock.arrow.circlepath" />
        <NativeTabs.Trigger.Label>History</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="settings" disableAutomaticContentInsets disableTransparentOnScrollEdge>
        <NativeTabs.Trigger.Icon sf={{ default: 'gearshape', selected: 'gearshape.fill' }} />
        <NativeTabs.Trigger.Label>Settings</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
