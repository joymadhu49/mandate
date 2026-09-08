import React from 'react';
import { Tabs } from 'expo-router';
import { View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { Icon, type IconName } from '@/components/app-ui';
import { colors } from '@/lib/theme';
import { api } from '@/lib/api';
import { useWallet } from '@/lib/wallet';
import { isOpenOrder } from '@/components/order-ui';

const sections: { name: string; title: string; icon: IconName }[] = [
  { name: 'home', title: 'Home', icon: 'house' },
  { name: 'agent', title: 'Agent', icon: 'bubble.left.and.bubble.right' },
  { name: 'orders', title: 'Orders', icon: 'arrow.left.arrow.right' },
  { name: 'history', title: 'History', icon: 'clock.arrow.circlepath' },
  { name: 'settings', title: 'Settings', icon: 'gearshape' },
];
export default function WebTabs() {
  const address = useWallet(s => s.address);
  const session = useQuery({ queryKey: ['session', address], queryFn: api.session, retry: false, staleTime: 30_000, refetchInterval: 60_000, refetchOnWindowFocus: 'always' });
  const verified = !session.isError && session.data?.account.toLowerCase() === address?.toLowerCase();
  const orders = useQuery({ queryKey: ['orders', address], queryFn: api.orders, enabled: verified, refetchInterval: 15_000 });
  const badge = verified ? orders.data?.filter(isOpenOrder).length : 0;
  return <View style={{ flex: 1, backgroundColor: colors.bg }}>
    <Tabs screenOptions={{
      headerShown: false, tabBarPosition: 'bottom', tabBarVariant: 'uikit',
      tabBarActiveTintColor: colors.link, tabBarInactiveTintColor: colors.muted,
      tabBarStyle: { backgroundColor: colors.card, borderColor: colors.border, height: 76, paddingTop: 8, paddingBottom: 12 },
      tabBarLabelPosition: 'below-icon',
      tabBarLabelStyle: { fontSize: 11, fontWeight: '500' },
      sceneStyle: { backgroundColor: colors.bg },
    }}>
      {sections.map(section => <Tabs.Screen key={section.name} name={section.name} options={{ title: section.title, tabBarBadge: section.name === 'orders' && badge ? badge : undefined, tabBarIcon: ({ color }) => <Icon name={section.icon} size={22} color={String(color)} /> }} />)}
    </Tabs>
  </View>;
}
