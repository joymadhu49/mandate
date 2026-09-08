import { Alert } from './browser-dialogs';
import { transactionUrl } from './ui-presentation';
export async function openExternal(value: string) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password) throw new Error();
    window.open(url.href, '_blank', 'noopener,noreferrer');
  } catch { Alert.alert('Could not open link', 'This link is not available.'); }
}
export function openTransaction(hash: string) {
  const url = transactionUrl(hash);
  if (url) void openExternal(url);
  else Alert.alert('Transaction unavailable', 'This transaction link is not valid.');
}
export function openFeed(url: string) {
  if (/^https:\/\/basescan\.org\/address\/0x[0-9a-fA-F]{40}$/.test(url)) void openExternal(url);
}
