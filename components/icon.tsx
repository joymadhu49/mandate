import React, { type ComponentProps } from 'react';
import { SymbolView } from 'expo-symbols';
import { colors } from '@/lib/theme';
export type IconName = ComponentProps<typeof SymbolView>['name'];
type IconWeight = ComponentProps<typeof SymbolView>['weight'];

export function Icon({ name, size = 22, color = colors.muted, weight }: { name: IconName; size?: number; color?: string; weight?: IconWeight }) {
  return <SymbolView name={name} size={size} tintColor={color} weight={weight} style={{ width: size, height: size }} />;
}
