// query-string 7 expects a CommonJS callable, while the patched decoder is ESM.
// Metro (and Expo's Node >=22.13 tooling) expose that callable as `default`.
module.exports = require('patched-decoder').default;
