# Decoder compatibility adapter

Expo Router 57 uses query-string 7, whose CommonJS import expects a function.
decode-uri-component 0.5.0 fixes GHSA-vcc3-ghjq-m6fr but exports that function
as an ESM default. This small adapter preserves the existing router API while
using the unmodified, exact-pinned patched package. The root override is scoped
to query-string; no Expo downgrade or vendored decoder implementation is used.

Remove the adapter when Expo Router adopts a compatible patched dependency.
The project requires Expo 57's Node >=22.13; older Node cannot require this ESM
package. Regression tests cover normal, malformed, and long query parameters.
