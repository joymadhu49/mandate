import { AsyncLocalStorage } from 'node:async_hooks';

/** Each hosted ledger owns its storage and cache; never share account data across isolates/objects. */
export interface RuntimeStore {
  read(path: string): string | undefined;
  write(path: string, value: string): void;
  flush(): Promise<void>;
  cache: Map<string, unknown>;
}
const context = new AsyncLocalStorage<RuntimeStore>();
export const cloudRuntime = process.env.CLOUDFLARE_WORKER === '1';
export const withRuntime = <T>(store: RuntimeStore, work: () => T): T => context.run(store, work);
export function runtimeStore(): RuntimeStore | undefined {
  const store = context.getStore();
  if (cloudRuntime && !store) throw new Error('Durable storage context is required.');
  return store;
}
export async function flushPersistence() { await runtimeStore()?.flush(); }

export function scopedValue<T>(name: string, create: () => T): () => T {
  let local: T | undefined;
  return () => {
    const store = runtimeStore();
    if (!store) return local ??= create();
    if (!store.cache.has(name)) store.cache.set(name, create());
    return store.cache.get(name) as T;
  };
}
