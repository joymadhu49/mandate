// Actual credentials live in the local gateway, behind an HttpOnly cookie.
// This nonsecret generation marker protects newly verified sessions from late 401s.
let generation = 0;
const listeners = new Set<() => void>();
export const sessionToken = async (_backend: string) => `browser-session-${generation}`;
export const saveSession = async (_session: { token: string; account: string; expiresAt: number; backend: string }) => { generation++; };
export async function clearSession() {
  const response = await fetch('/api/auth/logout', { method: 'POST', headers: { 'content-type': 'application/json' } });
  if (!response.ok) throw new Error('Could not sign out. Please try again.');
  generation++;
}
export async function invalidateSession(_backend: string, rejectedToken?: string) {
  if (rejectedToken !== `browser-session-${generation}`) return;
  generation++;
  listeners.forEach(listener => listener());
}
export function onSessionInvalidated(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }
