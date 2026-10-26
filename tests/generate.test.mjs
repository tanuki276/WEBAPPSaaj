import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const source = await readFile('api/generate.js', 'utf8');
const { default: handler, UPSTREAM_TIMEOUT_MS } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
function response() { return { statusCode: 200, headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(code) { this.statusCode = code; return this; }, json(data) { this.data = data; return this; } }; }
const request = { method: 'POST', headers: { authorization: 'Bearer test-token' }, body: { ingredients: '卵', constraints: '' } };
test('router gets more than 30 seconds while the Vercel budget exceeds the request timeout', async () => {
  assert.equal(UPSTREAM_TIMEOUT_MS, 120000);
  const config = JSON.parse(await readFile('vercel.json', 'utf8'));
  assert.ok(config.functions['api/generate.js'].maxDuration * 1000 > UPSTREAM_TIMEOUT_MS);
  const originalFetch = global.fetch;
  global.fetch = async (url, options) => {
    assert.equal(options.headers.Authorization, 'Bearer test-token');
    assert.equal(options.signal.aborted, false);
    return new Response(JSON.stringify({ recipe: '卵焼き' }));
  };
  try { const res = response(); await handler(request, res); assert.equal(res.statusCode, 200); assert.equal(res.data.recipe, '卵焼き'); }
  finally { global.fetch = originalFetch; }
});
test('timeout is returned as a useful 504 response without exposing internal errors', async () => {
  const originals = [global.fetch, global.setTimeout, global.clearTimeout];
  let abort;
  global.setTimeout = callback => { abort = callback; return 1; };
  global.clearTimeout = () => {};
  global.fetch = async (url, options) => { abort(); throw new DOMException('internal endpoint details', 'AbortError'); };
  try { const res = response(); await handler(request, res); assert.equal(res.statusCode, 504); assert.match(res.data.error, /時間がかかっています/); }
  finally { [global.fetch, global.setTimeout, global.clearTimeout] = originals; }
});

test('empty bearer tokens are rejected without contacting the router', async () => {
  const original = global.fetch;
  global.fetch = () => { throw new Error('must not fetch'); };
  try {
    for (const authorization of ['Bearer ', 'Bearer    ']) {
      const res = response();
      await handler({ ...request, headers: { authorization } }, res);
      assert.equal(res.statusCode, 401);
    }
  } finally { global.fetch = original; }
});
test('null router errors preserve rate limits and retry information', async () => {
  const original = global.fetch;
  global.fetch = async () => new Response('null', { status: 429, headers: { 'Retry-After': '15' } });
  try {
    const res = response(); await handler(request, res);
    assert.equal(res.statusCode, 429);
    assert.equal(res.headers['Retry-After'], '15');
  } finally { global.fetch = original; }
});
