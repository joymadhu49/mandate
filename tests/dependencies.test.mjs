import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const routerRequire = createRequire(require.resolve('expo-router/package.json'));
const query = routerRequire('query-string');

test('patched router decoder retains query-string CommonJS contract', () => {
  assert.deepEqual({ ...query.parse('stock=AAPLc&name=hello%20world&tag=a&tag=b') }, { name: 'hello world', stock: 'AAPLc', tag: ['a', 'b'] });
  assert.equal(query.stringify({ symbol: 'AAPLc', amount: 12 }), 'amount=12&symbol=AAPLc');
  assert.equal(query.parse('name=%E0%A4%A&ok=%F0%9F%98%80').ok, '😀');
});
test('long malformed URI input decodes without exponential recursion', { timeout: 2000 }, () => {
  // Never feed the adversarial case to an unpatched install.
  const queryRequire = createRequire(routerRequire.resolve('query-string'));
  assert.match(queryRequire.resolve('decode-uri-component'), /decode-uri-component-compat/);
  const value = '%FF'.repeat(5000);
  assert.equal(query.parse(`value=${value}`).value, value);
});
test('patched Xcode UUID dependency still generates valid project IDs', () => {
  const xcode = require('xcode');
  // UUID generation needs only the object index, not a generated native project.
  const project = xcode.project('test.pbxproj');
  project.hash = { project: { objects: { PBXFileReference: {} } } };
  const ids = new Set();
  for (let i = 0; i < 100; i++) {
    const id = project.generateUuid();
    assert.match(id, /^[A-F0-9]{24}$/);
    assert.ok(!ids.has(id));
    ids.add(id);
    project.hash.project.objects.PBXFileReference[id] = { isa: 'PBXFileReference' };
  }
});
