import React from 'react';
import { View } from 'react-native';
import { usePhoneFrame } from './app-frame.web';
import { colors } from '@/lib/theme';
export function WebSheetFrame({ children }: { children: React.ReactNode }) {
  const frame = usePhoneFrame();
  return <View style={{ flex: 1, backgroundColor: '#000000', justifyContent: 'center', alignItems: 'center' }}>
    <View style={{ ...frame, overflow: 'hidden', backgroundColor: colors.bg }}>{children}</View>
  </View>;
}
