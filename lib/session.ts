import * as SecureStore from 'expo-secure-store';
import { createSessionStore } from './session-state';

const KEY = 'mandate.backend-session';
const store = createSessionStore({
  read: async () => {
    try { return await SecureStore.getItemAsync(KEY); }
    catch { throw new Error('Secure wallet storage is unavailable. Unlock your iPhone and try again.'); }
  },
  write: async value => {
    try { await SecureStore.setItemAsync(KEY, value, { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY }); }
    catch { throw new Error('Could not securely save your wallet session. Unlock your iPhone and try again.'); }
  },
  remove: () => SecureStore.deleteItemAsync(KEY),
});
export const sessionToken = store.token;
export const saveSession = store.save;
export const clearSession = store.clear;
export const invalidateSession = store.invalidate;
export const onSessionInvalidated = store.subscribe;
