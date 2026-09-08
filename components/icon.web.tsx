import React from 'react';
import { Sparkles, Fuel, Cpu, Eye, Signature, Home, MessagesSquare, ArrowLeftRight, History, Settings, ShieldCheck, Shield, ShieldX, LockKeyhole, Hand, MousePointerClick, UserRound, KeyRound, ChevronLeft, ChevronRight, ChevronDown, ArrowUp, ArrowUpLeft, ArrowUpRight, CircleCheck, CircleX, CircleHelp, CircleAlert, TriangleAlert, Info, EyeOff, Circle, X, WifiOff, TrendingUp, FilePlus, FileSearch, PauseCircle, DollarSign, Zap, LogOut, RefreshCw, Clock, ArrowDownCircle, ArrowUpCircle, MessageSquare, BadgeCheck, type LucideIcon } from 'lucide-react';
import { colors } from '@/lib/theme';
export type { IconName } from './icon';
import type { IconName } from './icon';
const icons: Record<string, LucideIcon> = {
  sparkles: Sparkles, fuelpump: Fuel, cpu: Cpu, eye: Eye, signature: Signature, bolt: Zap,
  house: Home, 'house.fill': Home, 'bubble.left.and.bubble.right': MessagesSquare,
  'bubble.left.and.bubble.right.fill': MessagesSquare, 'bubble.left.and.text.bubble.right': MessagesSquare,
  'arrow.left.arrow.right': ArrowLeftRight, 'clock.arrow.circlepath': History, gearshape: Settings, 'gearshape.fill': Settings,
  'checkmark.shield': ShieldCheck, 'lock.shield': LockKeyhole, 'shield.lefthalf.filled': Shield,
  'xmark.shield': ShieldX, 'checkmark.bubble': MessageSquare, 'hand.raised': Hand, 'hand.tap': MousePointerClick,
  'person.crop.circle': UserRound, 'person.badge.key': KeyRound, 'chevron.left': ChevronLeft, 'chevron.right': ChevronRight, 'chevron.down': ChevronDown,
  'arrow.up': ArrowUp, 'arrow.up.left': ArrowUpLeft, 'arrow.up.right': ArrowUpRight,
  'arrow.down.circle': ArrowDownCircle, 'arrow.up.circle': ArrowUpCircle,
  'checkmark.circle': CircleCheck, 'checkmark.circle.fill': CircleCheck, 'checkmark.seal': BadgeCheck,
  'xmark.circle': CircleX, 'xmark.circle.fill': CircleX, 'questionmark.circle': CircleHelp,
  'exclamationmark.circle': CircleAlert, 'exclamationmark.triangle': TriangleAlert, 'info.circle': Info,
  'eye.slash': EyeOff, circle: Circle, xmark: X, 'wifi.exclamationmark': WifiOff,
  'chart.line.uptrend.xyaxis': TrendingUp, 'doc.badge.plus': FilePlus, 'doc.text.magnifyingglass': FileSearch,
  'pause.circle': PauseCircle, 'dollarsign.circle': DollarSign, 'bolt.fill': Zap,
  'rectangle.portrait.and.arrow.right': LogOut, 'arrow.clockwise': RefreshCw, 'arrow.triangle.2.circlepath': RefreshCw,
  clock: Clock, 'clock.fill': Clock,
};
export function Icon({ name, size = 22, color = colors.muted, weight }: { name: IconName; size?: number; color?: string; weight?: string }) {
  const key = typeof name === 'string' ? name : name.web ?? name.ios ?? '';
  const Glyph = icons[key] ?? Circle;
  return <Glyph size={size} color={color} strokeWidth={weight === 'semibold' ? 2.2 : 1.8} aria-hidden style={{ flexShrink: 0 }} />;
}
