const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const vm = require('node:vm');
const source = readFileSync('app.js', 'utf8');
// Execute the actual constraint builder without starting Firebase or the page.
const builder = source.slice(source.indexOf('function buildConstraints()'), source.indexOf('function validate('));
function build(preferences, instructions = '') {
  const context = {
    e: Object.fromEntries(['type', 'diff', 'genre', 'time', 'diet'].map(key => [key, { value: '指定なし' }])),
    prefs: () => preferences,
    $: () => ({ value: instructions })
  };
  return vm.runInNewContext(`${builder}; buildConstraints()`, context);
}
test('unspecified seasonings allow basic seasoning with an explicit pantry assumption', () => {
  const result = build({});
  assert.match(result, /主材料は入力された食材の範囲/);
  assert.match(result, /常備していると仮定/);
  assert.match(result, /分量とともに材料に明記/);
});
test('listed seasonings and none do not receive the pantry fallback', () => {
  for (const seasonings of ['塩、食用油', 'なし']) {
    const result = build({ seasonings, allergies: '大豆', methods: '電子レンジ' }, '1人分');
    assert.ok(result.includes(`【使える調味料】${seasonings}。`));
    assert.doesNotMatch(result, /常備していると仮定/);
    assert.match(result, /大豆/);
    assert.match(result, /電子レンジ/);
    assert.match(result, /1人分/);
  }
});
