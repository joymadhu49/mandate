import { z } from 'zod';
import { atomicWriteJson, loadValidatedJson } from './persistence.js';
import { cloudRuntime, scopedValue } from './runtime.js';

/** Sessions and one-use challenges survive object eviction. Only hashed session tokens are stored. */
export function persistentMap<T>(path: string, schema: z.ZodType<T, z.ZodTypeDef, any>): Map<string, T> {
  if (!cloudRuntime) return new Map();
  const current = scopedValue(`map:${path}`, () => new Map(Object.entries(loadValidatedJson(path, z.record(schema), {}))));
  const persist = () => atomicWriteJson(path, Object.fromEntries(current()));
  return new Proxy(new Map<string, T>(), {
    get: (_, property) => {
      const map = current();
      if (property === 'set') return (key: string, value: T) => { map.set(key, value); persist(); return map; };
      if (property === 'delete') return (key: string) => { const result = map.delete(key); if (result) persist(); return result; };
      if (property === 'clear') return () => { map.clear(); persist(); };
      const value = Reflect.get(map, property, map);
      return typeof value === 'function' ? value.bind(map) : value;
    },
  });
}
