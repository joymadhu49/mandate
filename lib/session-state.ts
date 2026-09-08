export type Session = { token: string; account: string; expiresAt: number; backend: string };
type Storage = { read: () => Promise<string | null>; write: (value: string) => Promise<void>; remove: () => Promise<void> };

function parseSession(raw: string | null): Session | undefined {
  if (!raw) return;
  try {
    const s = JSON.parse(raw);
    if (s && /^0x[0-9a-fA-F]{40}$/.test(s.account) && /^[0-9a-f]{64}$/.test(s.token)
      && typeof s.backend === 'string' && Number.isFinite(s.expiresAt)) return s;
  } catch { /* Corrupt local credentials are never used. */ }
}

// Serialize keychain changes so a late 401 cannot erase a newly verified session.
export function createSessionStore(storage: Storage, now = Date.now) {
  let pending: Promise<unknown> = Promise.resolve();
  const listeners = new Set<() => void>();
  const serial = <T>(work: () => Promise<T>): Promise<T> => {
    const result = pending.then(work, work);
    pending = result.catch(() => {});
    return result;
  };
  return {
    token: (backend: string) => serial(async () => {
      const s = parseSession(await storage.read());
      return s?.backend === backend && s.expiresAt > now() ? s.token : undefined;
    }),
    save: (session: Session) => serial(async () => {
      if (!parseSession(JSON.stringify(session)) || session.expiresAt <= now()) throw new Error('Invalid wallet session. Verify your wallet again.');
      await storage.write(JSON.stringify(session));
    }),
    clear: () => serial(() => storage.remove()),
    invalidate: (backend: string, rejectedToken?: string) => serial(async () => {
      const s = parseSession(await storage.read());
      if (s && (s.backend !== backend || (s.expiresAt > now() && s.token !== rejectedToken))) return false;
      // Notify even if keychain deletion fails: stale private screens must close.
      try { await storage.remove(); }
      finally { listeners.forEach(listener => listener()); }
      return true;
    }),
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
  };
}
