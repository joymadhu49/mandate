// Chrome shared by the Orders and History tabs: title block, preview notice, then the
// account gate around a list that scrolls on its own.
import React, { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { space } from '@/lib/theme';
import { Screen } from './ui';
import { PreviewBanner, TabHeader } from './app-ui';
import { AccountAccess } from './account-access';

type AccountFeedProps = { title: string; subtitle?: string; trailing?: React.ReactNode; children: React.ReactNode };

export function AccountFeed({ title, subtitle, trailing, children }: AccountFeedProps) {
  const insets = useSafeAreaInsets();
  return (
    <Screen style={{ paddingTop: insets.top + space.lg }}>
      <View style={styles.header}>
        <TabHeader title={title} subtitle={subtitle} trailing={trailing} />
        <PreviewBanner />
      </View>
      <AccountAccess>{children}</AccountAccess>
    </Screen>
  );
}

/** Spinner state for RefreshControl that follows the user's pull only, never a background poll. */
export function usePullToRefresh(refetch: () => Promise<unknown>) {
  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try { await refetch(); } finally { setRefreshing(false); }
  }, [refetch]);
  return { refreshing, onRefresh };
}

const styles = StyleSheet.create({ header: { gap: space.lg, marginBottom: space.xxl } });
