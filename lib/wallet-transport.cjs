// Narrow transport replacement for MWP 1.0.0, selected by metro.config.js.
// Keep the SDK's encoding, encryption, account session and signing unchanged.
const WebBrowser = require('expo-web-browser');
const { AppState } = require('react-native');
const { encodeRequestURLParams, decodeResponseURLParams } = require('@mobile-wallet-protocol/client/dist/components/communication/utils/encoding');

function failure(code, message) {
  return Object.assign(new Error(message), { code });
}

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
// A Coinbase sheet that just closed is still animating away while the app regains focus. A session started
// in that window fails to start natively, which surfaced as "could not open" between chained approvals.
const SETTLE_MS = 500;
const RETRY_MS = [300, 600, 900];
let lastClosedAt = 0;

function whenForeground() {
  if (AppState.currentState === 'active') return Promise.resolve();
  return new Promise(resolve => {
    const done = () => { clearTimeout(timer); subscription.remove(); resolve(); };
    const timer = setTimeout(done, 4000);
    const subscription = AppState.addEventListener('change', state => { if (state === 'active') done(); });
  });
}

async function openSession(url, appCustomScheme) {
  for (let attempt = 0; ; attempt++) {
    await whenForeground();
    const settle = SETTLE_MS - (Date.now() - lastClosedAt);
    if (settle > 0) await wait(settle);
    try {
      return await WebBrowser.openAuthSessionAsync(url, appCustomScheme, { preferEphemeralSession: false });
    } catch (error) {
      if (attempt >= RETRY_MS.length) throw error;
      await wait(RETRY_MS[attempt]);
    }
  }
}

let active = false;
exports.postRequestToWallet = async function postRequestToWallet(request, appCustomScheme, wallet) {
  if (active) throw failure(-32002, 'A Coinbase request is already open. Finish it before continuing.');
  if (wallet.type !== 'web') throw failure(4200, 'This wallet connection is not supported.');
  active = true;
  try {
    const requestUrl = new URL(wallet.scheme);
    requestUrl.search = encodeRequestURLParams(request);
    let result;
    try {
      result = await openSession(requestUrl.toString(), appCustomScheme);
    } catch {
      // Never leak URLs, encrypted payloads or native exception text to the UI.
      throw failure(-32000, 'Coinbase could not open. Return to Mandate and try again.');
    } finally {
      lastClosedAt = Date.now();
    }
    if (result.type === 'cancel' || result.type === 'dismiss') {
      throw failure(4001, 'Coinbase closed before completing this request. Continue when you are ready.');
    }
    if (result.type !== 'success') {
      throw failure(-32000, 'Coinbase could not complete this request. Please try again.');
    }
    try {
      const callback = new URL(result.url);
      const expected = new URL(appCustomScheme);
      if (callback.protocol !== expected.protocol || callback.host !== expected.host || callback.pathname !== expected.pathname) {
        throw new Error('Unexpected callback');
      }
      const response = decodeResponseURLParams(callback.searchParams);
      if (response.requestId !== request.id || !response.content) throw new Error('Unexpected response');
      return response;
    } catch {
      throw failure(-32000, 'Coinbase returned an incomplete or unexpected response. Please try again.');
    }
  } finally {
    // openAuthSessionAsync owns dismissal. Calling dismissBrowser here targets a
    // different native API and can interfere with the next approval.
    active = false;
  }
};
