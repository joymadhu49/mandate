import 'react-native-get-random-values';
import { Buffer } from 'buffer';
import * as ExpoCrypto from 'expo-crypto';

const g = globalThis as unknown as {
  Buffer?: typeof Buffer;
  crypto?: { getRandomValues?: (a: Uint8Array) => Uint8Array; randomUUID?: () => string };
};

if (typeof g.Buffer === 'undefined') g.Buffer = Buffer;

// Hermes ships without WebCrypto. @mobile-wallet-protocol/client needs
// crypto.getRandomValues (react-native-get-random-values) and crypto.randomUUID (below).
if (!g.crypto) g.crypto = {};
if (typeof g.crypto.getRandomValues !== 'function') {
  g.crypto.getRandomValues = (arr: Uint8Array) => ExpoCrypto.getRandomValues(arr);
}
if (typeof g.crypto.randomUUID !== 'function') {
  g.crypto.randomUUID = () => ExpoCrypto.randomUUID();
}
