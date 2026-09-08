import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import type { NativeStackHeaderProps } from 'expo-router';
import { Icon } from './icon';
import { colors } from '@/lib/theme';

/** Balanced side slots keep the title centered independently of the back action. */
export function WebNavigationHeader({ navigation, options, route, back }: NativeStackHeaderProps) {
  const router = useRouter();
  const title = typeof options.headerTitle === 'string' ? options.headerTitle : options.title ?? route.name;
  const leading = options.headerLeft?.({ tintColor: colors.link, canGoBack: !!back });
  return <View style={styles.header}>
    <View style={styles.side}>
      {leading ?? <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={() => navigation.canGoBack() ? navigation.goBack() : router.replace('/home')} style={styles.back}>
        <Icon name="chevron.left" color={colors.link} size={23} />
      </Pressable>}
    </View>
    <Text accessibilityRole={title ? "header" : undefined} numberOfLines={1} style={styles.title}>{title}</Text>
    <View style={styles.side} />
  </View>;
}
const styles = StyleSheet.create({
  header: { height: 64, paddingHorizontal: 20, flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.bg, borderBottomWidth: 1, borderBottomColor: colors.border },
  side: { width: 64, minHeight: 44, justifyContent: 'center', flexShrink: 0 },
  title: { flex: 1, color: colors.text, fontSize: 17, lineHeight: 22, fontWeight: '600', textAlign: 'center' },
  back: { width: 44, height: 44, justifyContent: 'center', alignItems: 'flex-start' },
});
