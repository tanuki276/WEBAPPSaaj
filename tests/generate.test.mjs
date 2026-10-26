import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile('api/generate.js', 'utf8');
const { default: handler, UPSTREAM_TIMEOUT_MS, HIGH_ACCURACY_TIMEOUT_MS } =
  await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);

function response() {
  return {
    statusCode: 200,
    headers: {},
    setHeader(k, v) { this.headers[k] = v; },
    status(code) { this.statusCode = code; return this; },
    json(data) { this.data = data; return this; }
  };
}

const request = {
  method: 'POST',
  headers: { authorization: 'Bearer test-token' },
  body: { ingredients: '卵', constraints: '' }
};

test('normal and high-accuracy requests fit inside the Vercel function budget', async () => {
  assert.equal(UPSTREAM_TIMEOUT_MS, 120000);
  assert.equal(HIGH_ACCURACY_TIMEOUT_MS, 165000);
  const config = JSON.parse(await readFile('vercel.json', 'utf8'));
  const budget = config.functions['api/generate.js'].maxDuration * 1000;
  assert.ok(budget > UPSTREAM_TIMEOUT_MS);
  assert.ok(budget > HIGH_ACCURACY_TIMEOUT_MS);
});

test('normal generation forwards normal mode and authorization', async () => {
  const originalFetch = global.fetch;
  global.fetch = async (url, options) => {
    assert.equal(options.headers.Authorization, 'Bearer test-token');
    assert.equal(options.signal.aborted, false);
    const body = JSON.parse(options.body);
    assert.equal(body.mode, 'normal');
    return new Response(JSON.stringify({ recipe: '卵焼き', mode: 'normal' }));
  };
  try {
    const res = response();
    await handler(request, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.data.recipe, '卵焼き');
    assert.equal(res.data.mode, 'normal');
  } finally { global.fetch = originalFetch; }
});

test('high accuracy is forwarded explicitly', async () => {
  const originalFetch = global.fetch;
  global.fetch = async (url, options) => {
    const body = JSON.parse(options.body);
    assert.equal(body.mode, 'high');
    return new Response(JSON.stringify({ recipe: '高精度の卵焼き', mode: 'high' }));
  };
  try {
    const res = response();
    await handler({ ...request, body: { ...request.body, mode: 'high' } }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.data.mode, 'high');
  } finally { global.fetch = originalFetch; }
});

test('timeout is returned as a useful 504 response without exposing internal errors', async () => {
  const originals = [global.fetch, global.setTimeout, global.clearTimeout];
  let abort;
  global.setTimeout = callback => { abort = callback; return 1; };
  global.clearTimeout = () => {};
  global.fetch = async () => { abort(); throw new DOMException('internal endpoint details', 'AbortError'); };
  try {
    const res = response();
    await handler(request, res);
    assert.equal(res.statusCode, 504);
    assert.match(res.data.error, /時間がかかっています/);
  } finally { [global.fetch, global.setTimeout, global.clearTimeout] = originals; }
});

test('server forwards beginner requirements together with the original cooking restrictions', async () => {
  const originalFetch = global.fetch;
  global.fetch = async (url, options) => {
    const body = JSON.parse(options.body);
    assert.equal(body.ingredients, '卵');
    assert.equal(body.mode, 'normal');
    assert.ok(body.constraints.startsWith('しょうゆは使わない\n\n'));
    for (const requirement of ['2人分', '下準備', '火加減', '調味料は名前・量・入れるタイミング', '材料の使い忘れ', '加工状態が不明']) {
      assert.ok(body.constraints.includes(requirement), requirement);
    }
    return new Response(JSON.stringify({ recipe: '確認が必要です。' }));
  };
  try {
    const res = response();
    await handler({ ...request, body: { ingredients: '卵', constraints: 'しょうゆは使わない' } }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.data.recipe, '確認が必要です。');
  } finally { global.fetch = originalFetch; }
});

test('maximum user conditions are accepted before server requirements are added', async () => {
  const originalFetch = global.fetch;
  global.fetch = async (url, options) => {
    assert.ok(JSON.parse(options.body).constraints.length > 4000);
    return new Response(JSON.stringify({ recipe: 'レシピ' }));
  };
  try {
    const res = response();
    await handler({ ...request, body: { ingredients: '卵', constraints: 'あ'.repeat(4000) } }, res);
    assert.equal(res.statusCode, 200);
  } finally { global.fetch = originalFetch; }
});
