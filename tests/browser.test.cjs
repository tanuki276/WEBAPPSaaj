const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
function fixture(navigator) {
  const elements = new Map();
  const element = id => {
    if (!elements.has(id)) elements.set(id, { value: '', classList: { toggle() {} }, childNodes: [{}] });
    return elements.get(id);
  };
  const context = vm.createContext({ navigator, console, setTimeout, clearTimeout,
    document: { getElementById: element, querySelectorAll: () => [], addEventListener() {} },
    CookAccount: { ensure: async () => ({}), preferencesKey: () => 'prefs' },
    localStorage: { getItem: () => null }, addEventListener() {} });
  context.window = context;
  vm.runInContext(fs.readFileSync('app.js', 'utf8'), context);
  vm.runInContext("last='卵焼き'", context);
  return { run: code => vm.runInContext(code, context), element };
}
test('clipboard permission failure gives a recoverable message', async () => {
  const f = fixture({ clipboard: { writeText: async () => { throw new Error('denied'); } } });
  await f.run('copy()');
  assert.equal(f.element('formError').hidden, false);
  assert.match(f.element('formError').textContent, /コピーできませんでした/);
});
test('missing clipboard API does not reject', async () => {
  const f = fixture({}); await f.run('copy()');
  assert.match(f.element('formError').textContent, /本文を選択/);
});
test('cancelling native share does not copy or show an error', async () => {
  let copies = 0;
  const f = fixture({ share: async () => { throw { name: 'AbortError' }; },
    clipboard: { writeText: async () => copies++ } });
  await f.run('share()'); assert.equal(copies, 0);
  assert.notEqual(f.element('formError').hidden, false);
});
