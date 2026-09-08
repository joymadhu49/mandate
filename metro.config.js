const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);
const walletTransport = require.resolve('@mobile-wallet-protocol/client/dist/components/communication/postRequestToWallet');
const repairedTransport = require.resolve('./lib/wallet-transport.cjs');

// MWP 1.0.0 turns native/decoding failures into rejection and never settles
// dismissed sessions. Override only that module; retain the SDK crypto/codec.
config.resolver.resolveRequest = (context, moduleName, platform) => {
  const resolved = context.resolveRequest(context, moduleName, platform);
  return resolved.type === 'sourceFile' && resolved.filePath === walletTransport
    ? { type: 'sourceFile', filePath: repairedTransport }
    : resolved;
};

// @mobile-wallet-protocol/client imports Node's `buffer`; map it to the npm polyfill.
config.resolver.extraNodeModules = {
  ...(config.resolver.extraNodeModules ?? {}),
  buffer: require.resolve('buffer/'),
};

module.exports = config;
