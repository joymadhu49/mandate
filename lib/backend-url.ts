// Explicit local-device development exception; all internet endpoints require TLS.
export function validateBackendURL(value: string) {
  const url = new URL(value);
  const parts = url.hostname.split('.').map(Number);
  const ipv4 = parts.length === 4 && parts.every(p => Number.isInteger(p) && p >= 0 && p <= 255);
  const local = url.hostname === 'localhost' || url.hostname === '[::1]' || (ipv4 && (
    parts[0] === 127 || parts[0] === 10 || (parts[0] === 192 && parts[1] === 168)
    || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31)
  ));
  if (url.username || url.password || url.search || url.hash || (url.protocol !== 'https:' && !(url.protocol === 'http:' && local))) {
    throw new Error('Use an HTTPS backend address. HTTP is supported only on your trusted local development network.');
  }
  return url;
}
