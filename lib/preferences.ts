import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';

type Profile = { displayName: string; walletLabel: string };
type Preferences = {
  hideBalances: boolean;
  autoRefresh: boolean;
  profiles: Record<string, Profile>;
  /** Last mandate chosen in the Agent tab, per wallet (lower-cased address). */
  lastMandate: Record<string, string>;
  /** Backend address chosen in Settings. Absent means the address baked into this build. */
  backendUrl?: string;
};
const defaults: Preferences = { hideBalances: false, autoRefresh: true, profiles: {}, lastMandate: {} };
const KEY = 'mandate.preferences';
// One read per launch, shared: API requests await it so a cold start never talks to the wrong backend.
let hydration: Promise<void> | undefined;
export const usePreferences = create<Preferences & {
  hydrate: () => Promise<void>; update: (values: Partial<Preferences>) => Promise<void>;
  saveProfile: (account: string, profile: Profile) => Promise<void>;
  setLastMandate: (account: string, mandateId: string | undefined) => Promise<void>;
}>((set, get) => ({
  ...defaults,
  hydrate: () => hydration ??= (async () => {
    try {
      const raw = await AsyncStorage.getItem(KEY);
      if (raw) {
        const p = JSON.parse(raw);
        const backendUrl = typeof p.backendUrl === 'string' && p.backendUrl.trim() ? p.backendUrl.trim() : undefined;
        set({
          hideBalances: p.hideBalances === true, autoRefresh: p.autoRefresh !== false, profiles: p.profiles ?? {}, lastMandate: p.lastMandate ?? {}, backendUrl,
        });
      }
    } catch { /* Keep defaults when local preferences are unavailable. */ }
  })(),
  update: async (values) => {
    const current = get();
    const next: Preferences = {
      hideBalances: current.hideBalances, autoRefresh: current.autoRefresh, profiles: current.profiles, lastMandate: current.lastMandate,
      backendUrl: current.backendUrl, ...values,
    };
    await AsyncStorage.setItem(KEY, JSON.stringify(next)); set(next);
  },
  saveProfile: async (account, profile) => get().update({ profiles: { ...get().profiles, [account.toLowerCase()]: profile } }),
  setLastMandate: async (account, mandateId) => {
    const lastMandate = { ...get().lastMandate };
    if (mandateId) lastMandate[account.toLowerCase()] = mandateId; else delete lastMandate[account.toLowerCase()];
    // Best effort: a failed write must not break the chat.
    await get().update({ lastMandate }).catch(() => set({ lastMandate }));
  },
}));
