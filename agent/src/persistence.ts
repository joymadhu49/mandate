import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { z } from 'zod';
import { cloudRuntime, runtimeStore, scopedValue } from './runtime.js';

export function loadValidatedJson<T>(path: string, schema: z.ZodType<T>, fallback: T): T {
  const store = runtimeStore();
  const text = store ? store.read(path) : existsSync(path) ? readFileSync(path, 'utf8') : undefined;
  if (text === undefined) return structuredClone(fallback);
  try { return schema.parse(JSON.parse(text)); }
  catch { throw new Error('Persistent state is unreadable or invalid. Restore a verified backup before starting the agent.'); }
}

export function atomicWriteJson(path: string, value: unknown) {
  const store = runtimeStore();
  if (store) { store.write(path, JSON.stringify(value)); return; }
  const directory = dirname(path);
  mkdirSync(directory, { recursive: true });
  const temporary = `${path}.${randomUUID()}.tmp`;
  let fd: number | undefined;
  try {
    fd = openSync(temporary, 'wx', 0o600);
    writeFileSync(fd, JSON.stringify(value, null, 2));
    fsyncSync(fd); closeSync(fd); fd = undefined;
    renameSync(temporary, path);
    const dir = openSync(directory, 'r');
    try { fsyncSync(dir); } finally { closeSync(dir); }
  } finally {
    if (fd !== undefined) closeSync(fd);
    if (existsSync(temporary)) unlinkSync(temporary);
  }
}

/** Keep the existing synchronous journal contract with instance-scoped, durable storage. */
export function persistentObject<T extends object>(path: string, schema: z.ZodType<T>, fallback: T): T {
  if (!cloudRuntime) return loadValidatedJson(path, schema, fallback);
  const value = scopedValue(`document:${path}`, () => loadValidatedJson(path, schema, fallback));
  return new Proxy({} as T, {
    get: (_, key) => Reflect.get(value(), key),
    set: (_, key, next) => Reflect.set(value(), key, next),
    ownKeys: () => Reflect.ownKeys(value()),
    getOwnPropertyDescriptor: (_, key) => {
      const descriptor = Reflect.getOwnPropertyDescriptor(value(), key);
      return descriptor && { ...descriptor, configurable: true };
    },
  });
}
