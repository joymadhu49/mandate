// One place to choose the swap provider. Relay is the default; SWAP_PROVIDER=lifi reverts to LI.FI
// without a code change, which matters because this sits directly on the live-funds path.
import { config } from './config.js';
import * as lifi from './lifi.js';
import * as relay from './relay.js';

export { NATIVE_TOKEN, type SwapQuote } from './lifi.js';
export const quoteSwap: typeof lifi.quoteSwap = params =>
  (config.swapProvider === 'lifi' ? lifi.quoteSwap : relay.quoteSwap)(params);
