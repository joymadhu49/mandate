// Read-only AI information. Provider credentials and model selection are managed by the service.
import React from 'react';
import { View } from 'react-native';
import { useIsFocused } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Muted, Skeleton } from './ui';
import { Banner, SettingRow, appStyles } from './app-ui';

export function AIStatusPanel() {
  const focused = useIsFocused();
  const agent = useQuery({ queryKey: ['agent'], queryFn: api.agent, refetchInterval: focused ? 30_000 : false });
  const ai = agent.data?.ai;

  if (agent.isPending) return <Skeleton height={120} radius={16} />;
  if (!ai) {
    return <Banner tone="red" icon="exclamationmark.circle" text="AI status is unavailable. Please try again."
      action={{ label: 'Retry', onPress: () => agent.refetch() }} />;
  }

  return (
    <View style={appStyles.section}>
      {agent.isError ? <Banner tone="amber" icon="exclamationmark.triangle" text="Could not refresh AI status. Showing the last update."
        action={{ label: 'Retry', onPress: () => agent.refetch() }} /> : null}
      <View style={appStyles.group}>
        <SettingRow icon="sparkles" title="Status" detail={ai.configured ? 'Connected' : 'Not connected'} />
        <View style={appStyles.divider} />
        <SettingRow icon="cpu" title="Model" detail={ai.model || 'Not available'} />
      </View>
      <Muted>{ai.configured
        ? 'AI powers agent chat and strategy drafting. The model is managed by Mandate.'
        : 'AI is not connected. Please try again later.'}</Muted>
    </View>
  );
}
