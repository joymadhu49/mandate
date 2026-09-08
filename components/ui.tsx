// Shared primitives. Every screen composes these; screen-local styles stay local.
import React, { useEffect, useRef } from 'react';
import {
  ActivityIndicator,
  Animated,
  Easing,
  Image,
  Pressable,
  Platform,
  StyleSheet,
  Text,
  TextProps,
  View,
  ViewProps,
  useWindowDimensions,
} from 'react-native';
import { colors, inset, radius, toneColor, toneSurface, type, type Tone } from '@/lib/theme';
import { LOGOS } from '@/lib/logos';

export function Logo({ symbol, size = 40 }: { symbol: string; size?: number }) {
  const src = LOGOS[symbol];
  const r = Math.round(size * 0.28);
  if (!src) {
    return (
      <View style={[styles.logoFallback, { width: size, height: size, borderRadius: r }]}>
        <Text style={{ color: colors.text, fontWeight: '700', fontSize: size * 0.3 }}>
          {symbol.replace(/c$/, '').slice(0, 4)}
        </Text>
      </View>
    );
  }
  return (
    <Image
      source={src}
      style={{ width: size, height: size, borderRadius: r, backgroundColor: colors.cardAlt }}
      resizeMode="cover"
    />
  );
}

/** Overlapping logo stack for a mandate's universe. */
export function LogoStack({ symbols, size = 24, max = 6 }: { symbols: string[]; size?: number; max?: number }) {
  const shown = symbols.slice(0, max);
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
      {shown.map((s, i) => (
        <View key={s} style={[styles.stackItem, { marginLeft: i === 0 ? 0 : -Math.round(size * 0.3), borderRadius: Math.round(size * 0.28) + 2 }]}>
          <Logo symbol={s} size={size} />
        </View>
      ))}
      {symbols.length > max ? <Muted style={{ marginLeft: 6 }}>+{symbols.length - max}</Muted> : null}
    </View>
  );
}

export function Screen({ style, ...p }: ViewProps) {
  return <View {...p} style={[styles.screen, style]} />;
}

export function Card({ style, ...p }: ViewProps) {
  return <View {...p} style={[styles.card, style]} />;
}

// Remount text on Dynamic Type changes: the current native renderer otherwise
// can retain the previous measured height while displaying the larger glyphs.
function scaled(Base: React.ComponentType<TextProps>) {
  return function Scaled(p: TextProps) {
    const { fontScale } = useWindowDimensions();
    return <Base key={fontScale} {...p} />;
  };
}
export const H1 = scaled((p) => <Text {...p} style={[styles.h1, p.style]} />);
export const Title = scaled((p) => <Text {...p} style={[styles.title, p.style]} />);
export const H2 = scaled((p) => <Text {...p} style={[styles.h2, p.style]} />);
export const Body = scaled((p) => <Text {...p} style={[styles.body, p.style]} />);
export const Muted = scaled((p) => <Text {...p} style={[styles.muted, p.style]} />);
export const Caption = scaled((p) => <Text {...p} style={[styles.caption, p.style]} />);
export const Mono = scaled((p) => <Text {...p} style={[styles.mono, p.style]} />);

/** Hero figure (portfolio value, budget, order amount). Never breaks mid-number at large Dynamic Type. */
export function Amount({ children, style, size = 40, ...p }: TextProps & { size?: number }) {
  const { fontScale } = useWindowDimensions();
  return (
    <Text key={fontScale} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6} maxFontSizeMultiplier={1.6} {...p}
      style={[styles.amount, { fontSize: size, lineHeight: Math.round(size * 1.15) }, style]}>
      {children}
    </Text>
  );
}

export function Button({
  title,
  onPress,
  loading,
  variant = 'primary',
  size = 'lg',
  leading,
  disabled,
  accessibilityHint,
}: {
  title: string;
  onPress: () => void;
  loading?: boolean;
  variant?: 'primary' | 'ghost' | 'danger' | 'link';
  size?: 'lg' | 'md';
  leading?: React.ReactNode;
  disabled?: boolean;
  accessibilityHint?: string;
}) {
  const { fontScale } = useWindowDimensions();
  const bg = variant === 'primary' ? colors.base : variant === 'danger' ? colors.dangerBg : variant === 'link' ? 'transparent' : colors.cardAlt;
  const fg = variant === 'danger' ? colors.red : variant === 'link' ? colors.link : colors.text;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: !!disabled || !!loading, busy: !!loading }}
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed }) => [
        styles.btn,
        size === 'md' && styles.btnMd,
        { backgroundColor: bg, opacity: disabled ? 0.45 : pressed ? 0.8 : 1 },
      ]}
    >
      {loading ? (
        <ActivityIndicator color={fg} />
      ) : (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          {leading}
          <Text key={fontScale} style={[styles.btnText, size === 'md' && { fontSize: 15 }, { color: fg, textAlign: 'center' }]}>{title}</Text>
        </View>
      )}
    </Pressable>
  );
}

export function Chip({
  label,
  active,
  onPress,
  disabled,
}: {
  label: string;
  active?: boolean;
  onPress?: () => void;
  disabled?: boolean;
}) {
  const { fontScale } = useWindowDimensions();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: !!active, disabled: !!disabled }}
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.chip,
        active && { backgroundColor: colors.baseSoft, borderColor: colors.base },
        pressed && { opacity: 0.8 },
        disabled && { opacity: 0.45 },
      ]}
    >
      <Text key={fontScale} style={[styles.chipText, active && { color: colors.text }]}>{label}</Text>
    </Pressable>
  );
}

export function Row({ style, ...p }: ViewProps) {
  return <View {...p} style={[styles.row, style]} />;
}

/** Tinted status badge. Sentence case; the tone carries meaning alongside the text. */
export function Badge({ text, tone = 'muted', dot }: { text: string; tone?: Tone; dot?: boolean }) {
  const { fontScale } = useWindowDimensions();
  const c = toneColor[tone];
  return (
    <View style={[styles.badge, { backgroundColor: toneSurface[tone] }]}>
      {dot ? <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: c }} /> : null}
      <Text key={fontScale} style={[styles.badgeText, { color: c }]}>{text}</Text>
    </View>
  );
}
/** @deprecated Use Badge. Kept so older screens compile during the rebuild. */
export const Pill = Badge;

export function Divider({ inset: left = 0 }: { inset?: number }) {
  return <View style={[styles.divider, { marginLeft: left }]} />;
}

/** Animated fill bar. `value` is 0..1. */
export function ProgressBar({ value, tone = 'base', height = 6 }: { value: number; tone?: Tone; height?: number }) {
  const anim = useRef(new Animated.Value(0)).current;
  const clamped = Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
  useEffect(() => {
    Animated.timing(anim, { toValue: clamped, duration: 600, easing: Easing.out(Easing.cubic), useNativeDriver: false }).start();
  }, [anim, clamped]);
  const width = anim.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] });
  return (
    <View accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: Math.round(clamped * 100) }}
      style={[styles.track, { height, borderRadius: height / 2 }]}>
      <Animated.View style={{ width, height, borderRadius: height / 2, backgroundColor: toneColor[tone] }} />
    </View>
  );
}

/** Pulsing placeholder for loading content. */
export function Skeleton({ width = '100%', height = 16, radius: r = 6, style }: {
  width?: number | `${number}%`; height?: number; radius?: number; style?: ViewProps['style'];
}) {
  const pulse = useRef(new Animated.Value(0.5)).current;
  useEffect(() => {
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(pulse, { toValue: 1, duration: 700, easing: Easing.inOut(Easing.quad), useNativeDriver: Platform.OS !== 'web' }),
      Animated.timing(pulse, { toValue: 0.5, duration: 700, easing: Easing.inOut(Easing.quad), useNativeDriver: Platform.OS !== 'web' }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [pulse]);
  return <Animated.View accessibilityElementsHidden style={[{ width, height, borderRadius: r, backgroundColor: colors.cardAlt, opacity: pulse }, style]} />;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg, paddingHorizontal: inset },
  card: {
    backgroundColor: colors.card,
    borderRadius: radius.md,
    padding: 16,
    borderWidth: 1,
    borderColor: colors.border,
  },
  h1: { color: colors.text, ...type.display },
  title: { color: colors.text, ...type.title },
  h2: { color: colors.text, ...type.section },
  body: { color: colors.text, ...type.body },
  muted: { color: colors.muted, ...type.label },
  caption: { color: colors.faint, ...type.caption },
  mono: { color: colors.text, fontVariant: ['tabular-nums'], fontSize: 15 },
  amount: { color: colors.text, fontVariant: ['tabular-nums'], fontWeight: '700', letterSpacing: -1 },
  btn: {
    minHeight: 52,
    paddingVertical: 12,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  btnMd: { minHeight: 44, paddingVertical: 8, paddingHorizontal: 16, borderRadius: radius.input },
  btnText: { fontSize: 16, fontWeight: '600' },
  chip: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
  },
  chipText: { color: colors.muted, fontSize: 14, fontWeight: '600' },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  badge: { flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: radius.pill, paddingHorizontal: 9, paddingVertical: 4, alignSelf: 'flex-start' },
  badgeText: { fontSize: 12, lineHeight: 16, fontWeight: '600' },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border },
  track: { width: '100%', backgroundColor: colors.border, overflow: 'hidden' },
  logoFallback: { backgroundColor: colors.cardAlt, alignItems: 'center', justifyContent: 'center' },
  stackItem: { borderWidth: 2, borderColor: colors.card },
});
