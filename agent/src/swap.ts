// Relay is preferred by default; SWAP_PROVIDER=lifi reverses the quote discovery order.
// Both providers validate their own response before returning an executable transaction.
import { config } from './config.js';
import * as lifi from './lifi.js';
import * as relay from './relay.js';
import { QuoteError } from './swap-errors.js';

export { NATIVE_TOKEN, type SwapQuote } from './lifi.js';
export const quoteSwap: typeof lifi.quoteSwap = async params => {
  const [primary, secondary] = config.swapProvider === 'lifi' ? [lifi, relay] : [relay, lifi];
  try { return await primary.quoteSwap(params); }
  catch (first) {
    // Only quote discovery retries. Invalid transactions, restrictions, and all execution errors stop.
    if (!(first instanceof QuoteError) || first.kind === 'blocked') throw first;
    try { return await secondary.quoteSwap(params); }
    catch (second) {
      // A missing route on one provider plus an outage on the other is not proof that no route exists.
      if (second instanceof QuoteError && second.kind === 'no_route' && first.kind !== 'no_route') throw first;
      throw second;
    }
  }
};
