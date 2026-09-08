import '@/polyfills';
import { EIP1193Provider, Wallets } from '@mobile-wallet-protocol/client';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import type { Address } from './stocks';
import { CHAIN_ID } from './stocks';
import { clearSession } from './session';
import { toHex } from 'viem';

// Connects this native app to the user's Base Account (the passkey smart wallet that
// powers the Base App). The Mobile Wallet Protocol opens an auth session at
// keys.coinbase.com; the user approves with Face ID and is bounced back via mandate://.
export const provider = new EIP1193Provider({
  metadata: {
    name: 'Mandate',
    customScheme: 'mandate://',
    chainIds: [CHAIN_ID],
    logoUrl: 'https://mandate.app/icon.png',
  },
  wallet: Wallets.CoinbaseSmartWallet,
});

const KEY = 'mandate.account';

interface WalletState {
  address?: Address;
  connecting: boolean;
  hydrated: boolean;
  hydrate: () => Promise<void>;
  connect: () => Promise<Address>;
  disconnect: () => Promise<void>;
}

export const useWallet = create<WalletState>((set) => ({
  address: undefined,
  connecting: false,
  hydrated: false,
  hydrate: async () => {
    try {
      const saved = await AsyncStorage.getItem(KEY);
      set({ address: saved && /^0x[0-9a-fA-F]{40}$/.test(saved) ? saved as Address : undefined });
    } finally { set({ hydrated: true }); }
  },
  connect: async () => {
    set({ connecting: true });
    try {
      const accounts = (await provider.request({ method: 'eth_requestAccounts' })) as Address[];
      const address = accounts[0];
      await AsyncStorage.setItem(KEY, address);
      set({ address });
      return address;
    } finally {
      set({ connecting: false });
    }
  },
  disconnect: async () => {
    // Clear durable identity before returning to Welcome. A slow wallet disconnect
    // must not keep private screens visible.
    await AsyncStorage.removeItem(KEY);
    await clearSession();
    set({ address: undefined });
    void provider.disconnect().catch(() => {});
  },
}));

export async function signInMessage(address: Address, message: string): Promise<`0x${string}`> {
  try {
    return await provider.request({ method: 'personal_sign', params: [toHex(message), address] }) as `0x${string}`;
  } catch (error) { throw toWalletError(error); }
}

export async function signTypedData(address: Address, typedData: object): Promise<`0x${string}`> {
  await (await import('./api')).api.assertEligibility();
  try { return (await provider.request({
    method: 'eth_signTypedData_v4',
    params: [address, JSON.stringify(typedData)],
  })) as `0x${string}`;
  } catch (error) { throw toWalletError(error); }
}

export interface WalletTransaction { to: Address; data: `0x${string}`; value: `0x${string}` }

/** EIP-1193: the user dismissed or rejected the request in the wallet. */
const USER_REJECTED = 4001;

/**
 * Signs and broadcasts one transaction from the user's wallet and returns its hash.
 * Uses `eth_sendTransaction`: MWPClient 1.0.0 forwards it to the Coinbase wallet exactly like personal_sign
 * (dist/MWPClient.js → sendRequestToPopup), and the wallet answers with a transaction hash that Basescan and
 * waitForTransactionReceipt understand as-is. `wallet_sendCalls` is forwarded too, but it returns a calls-bundle id whose
 * status needs `wallet_getCallsStatus`, which MWPClient does not forward at all, so it would leave us unable to find the receipt.
 */
export async function sendTransaction(address: Address, tx: WalletTransaction): Promise<`0x${string}`> {
  await (await import('./api')).api.assertEligibility();
  let hash: unknown;
  try {
    hash = await provider.request({ method: 'eth_sendTransaction', params: [{ from: address, to: tx.to, data: tx.data, value: tx.value }] });
  } catch (e) {
    throw toWalletError(e);
  }
  if (typeof hash !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(hash)) throw new Error('Coinbase did not return a transaction hash.');
  return hash as `0x${string}`;
}

/** Wallet failures arrive as EIP-1193 error objects, not always Error instances. Callers match /reject|cancel/i on the message. */
function toWalletError(e: unknown): Error {
  const { code, message } = (typeof e === 'object' && e !== null ? e : {}) as { code?: unknown; message?: unknown };
  if (code === USER_REJECTED) return new Error('Cancelled in Coinbase. Nothing was sent.');
  if (e instanceof Error) return e;
  return new Error(typeof message === 'string' ? message : typeof e === 'string' ? e : 'Coinbase returned an unexpected error.');
}
