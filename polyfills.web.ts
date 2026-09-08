import { Buffer } from 'buffer';
// Browsers supply WebCrypto. Never load the native randomness shim on web.
const browserGlobal = globalThis as unknown as { Buffer?: typeof Buffer };
if (!browserGlobal.Buffer) browserGlobal.Buffer = Buffer;
