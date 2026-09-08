import React from 'react';
import { View, useWindowDimensions } from 'react-native';
import { AppDialogHost } from './app-dialog-host.web';
import { Smartphone, ArrowUpRight } from 'lucide-react';
import { colors } from '@/lib/theme';

export const PHONE_WIDTH = 430;
export const PHONE_HEIGHT = 932;
export function usePhoneFrame() {
  const { width, height } = useWindowDimensions();
  const surround = width > PHONE_WIDTH + 48;
  return {
    width: Math.min(width, PHONE_WIDTH),
    height: Math.min(height - (surround ? 48 : 0), PHONE_HEIGHT),
    borderRadius: surround ? 24 : 0,
  };
}
/** The web app retains its phone proportions on every screen. */
export function AppFrame({ children }: { children: React.ReactNode }) {
  const frame = usePhoneFrame();
  return <View style={{ flex: 1, backgroundColor: '#000000', alignItems: 'center', justifyContent: 'center' }}>
    <View testID="phone-app-frame" style={{ ...frame, overflow: 'hidden', backgroundColor: colors.bg }}>
      <View style={{ height: 36, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', backgroundColor: colors.card, borderBottomWidth: 1, borderBottomColor: colors.border }}>
        <a href="https://testflight.apple.com/join/xNpkKz9g" target="_blank" rel="noopener noreferrer" aria-label="Get the iPhone app on TestFlight"
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: colors.link, textDecoration: 'none', fontFamily: '-apple-system, BlinkMacSystemFont, Segoe UI, sans-serif', fontSize: 12, fontWeight: 500, minHeight: 32, padding: '0 12px' }}>
          <Smartphone size={14} aria-hidden /> Get the iPhone app on TestFlight <ArrowUpRight size={13} aria-hidden />
        </a>
      </View>
      {children}
      <AppDialogHost frame={frame} />
    </View>
  </View>;
}
