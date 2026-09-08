import '@/polyfills';
import { createBaseAccountSDK } from '@base-org/account';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { toHex } from 'viem';
import type { Address } from './stocks';
import { clearSession } from './session';

let sdk: ReturnType<typeof createBaseAccountSDK> | undefined;
function getProvider() {
  sdk ??= createBaseAccountSDK({ appName: 'Mandate', appChainIds: [8453] });
  return sdk.getProvider();
}
const KEY = 'mandate.web.account';
const valid = (value: unknown): value is Address => typeof value === 'string' && /^0x[0-9a-fA-F]{40}$/.test(value);
interface WalletState {
  address?: Address; connecting: boolean; hydrated: boolean;
  hydrate: () => Promise<void>; connect: () => Promise<Address>; disconnect: () => Promise<void>;
}
export const useWallet = create<WalletState>((set) => ({
  connecting: false, hydrated: false,
  hydrate: async () => {
    try { const address = await AsyncStorage.getItem(KEY); set({ address: valid(address) ? address : undefined }); }
    finally { set({ hydrated: true }); }
  },
  connect: async () => {
    set({ connecting: true });
    try {
      const result = await getProvider().request({ method: 'eth_requestAccounts' });
      const address = Array.isArray(result) ? result[0] : undefined;
      if (!valid(address)) throw new Error('Coinbase did not return a wallet address.');
      await AsyncStorage.setItem(KEY, address);
      set({ address });
      return address;
    } catch (error) { throw walletError(error); }
    finally { set({ connecting: false }); }
  },
  disconnect: async () => {
    await clearSession();
    await AsyncStorage.removeItem(KEY);
    set({ address: undefined });
    try { await getProvider().disconnect(); } catch { /* Local session already removed. */ }
    sdk = undefined;
  },
}));
function walletError(error: unknown) {
  const e = error as { code?: number; message?: string };
  return new Error(e?.code === 4001 ? 'Cancelled in Coinbase. Nothing was sent.' : e?.message ?? 'Could not connect to Coinbase. Please try again.');
}
async function requestSignature(method: string, params: unknown[]) {
  try {
    const result = await getProvider().request({ method, params });
    if (typeof result !== 'string' || !/^0x[0-9a-fA-F]+$/.test(result)) throw new Error('Coinbase did not return a valid signature.');
    return result as `0x${string}`;
  } catch (error) { throw walletError(error); }
}
export const signInMessage = (address: Address, message: string) => requestSignature('personal_sign', [toHex(message), address]);
export const signTypedData = (address: Address, data: object) => requestSignature('eth_signTypedData_v4', [address, JSON.stringify(data)]);
export interface WalletTransaction { to: Address; data: `0x${string}`; value: `0x${string}` }
export async function sendTransaction(address: Address, tx: WalletTransaction): Promise<`0x${string}`> {
  const provider = getProvider();
  const accounts = await provider.request({ method: 'eth_accounts' });
  if (!Array.isArray(accounts) || !accounts.some(account => typeof account === 'string' && account.toLowerCase() === address.toLowerCase())) {
    throw new Error('Reconnect your Coinbase wallet before continuing.');
  }
  await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: '0x2105' }] });
  const hash = await requestSignature('eth_sendTransaction', [{ from: address, ...tx, chainId: '0x2105' }]);
  if (!/^0x[0-9a-fA-F]{64}$/.test(hash)) throw new Error('Coinbase did not return a transaction hash.');
  return hash;
}
