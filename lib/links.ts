// External links open in an in-app Safari sheet (dark tint, Done button) instead of leaving the app.
import { Alert } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import { colors } from './theme';
import { transactionUrl } from './ui-presentation';

export async function openExternal(url: string) {
  try {
    await WebBrowser.openBrowserAsync(url, { toolbarColor: colors.bg, controlsColor: colors.link, dismissButtonStyle: 'done' });
  } catch {
    Alert.alert('Could not open link', 'Please try again.');
  }
}

/** Opens a Base transaction on Basescan; refuses anything that is not a transaction hash. */
export function openTransaction(hash: string) {
  const url = transactionUrl(hash);
  if (!url) { Alert.alert('Transaction unavailable', 'This transaction link is not valid.'); return; }
  void openExternal(url);
}

const FEED_URL = /^https:\/\/basescan\.org\/address\/0x[0-9a-fA-F]{40}$/;
/** Opens a Chainlink feed contract page; only the exact Basescan address pattern is allowed. */
export function openFeed(url: string) {
  if (FEED_URL.test(url)) void openExternal(url);
}
