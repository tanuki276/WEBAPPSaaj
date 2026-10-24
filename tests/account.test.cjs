const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
function fixture({ failWrites = false } = {}) {
  const map = new Map();
  const original = { uid: 'guest', email: '', idToken: 'guest-token', refreshToken: 'refresh', expiresAt: Date.now() + 3600000 };
  map.set('cookai.auth', JSON.stringify(original));
  map.set('cookai.history', JSON.stringify([{ id: 'old', title: '卵焼き', recipe: '卵を焼く', ingredients: '卵', constraints: '', createdAt: 123 }]));
  const elements = new Map(), callbacks = {}, commits = [], cloudDocs = new Map();
  const buttons = ['register', 'login', 'logout', 'sync', 'reset'].map(name => ({ dataset: { accountAction: name } }));
  const element = id => {
    if (!elements.has(id)) elements.set(id, { value: '', hidden: false, textContent: '', reportValidity: () => true, addEventListener() {}, showModal() {}, close() {} });
    return elements.get(id);
  };
  const next = { localId: 'account', email: 'cook@example.com', idToken: 'account-token', refreshToken: 'r2', expiresIn: '3600' };
  const context = vm.createContext({ console, Date, JSON, Promise, Error, URLSearchParams, encodeURIComponent, AbortController,
    setTimeout, clearTimeout, crypto: { randomUUID: () => 'new-recipe' }, Event: class {},
    document: { getElementById: element, querySelectorAll: () => buttons, addEventListener: (name, fn) => callbacks[name] = fn },
    localStorage: { getItem: key => map.get(key) ?? null, setItem: (key, value) => map.set(key, value), removeItem: key => map.delete(key) },
    fetch: async (url, options) => {
      const body = options.body ? JSON.parse(options.body) : null;
      if (url.includes('accounts:update')) return { ok: true, json: async () => ({ ...next, localId: 'guest' }) };
      if (url.includes('signInWithPassword')) {
        if (body.password === 'wrong') return { ok: false, json: async () => ({ error: { message: 'INVALID_LOGIN_CREDENTIALS' } }) };
        return { ok: true, json: async () => next };
      }
      if (url.endsWith(':commit')) {
        if (failWrites) return { ok: false, json: async () => ({ error: { message: 'PERMISSION_DENIED' } }) };
        commits.push({ body, token: options.headers.Authorization });
        for (const write of body.writes) {
          if (write.update) cloudDocs.set(write.update.name, write.update);
          if (write.delete) cloudDocs.delete(write.delete);
        }
        return { ok: true, json: async () => ({}) };
      }
      if (url.includes('/history?')) return { ok: true, json: async () => ({ documents: [...cloudDocs.values()] }) };
      throw new Error(`Unexpected endpoint: ${url}`);
    }
  });
  context.window = context;
  context.dispatchEvent = () => {};
  vm.runInContext(fs.readFileSync('account.js', 'utf8'), context);
  callbacks.DOMContentLoaded();
  return { api: context.CookAccount, map, commits, element, buttons,
    action: async name => {
      element('accountEmail').value = 'cook@example.com'; element('accountPassword').value = 'TestPassword123';
      await buttons.find(button => button.dataset.accountAction === name).onclick();
    } };
}
test('registration links the existing guest UID and uploads legacy browser history', async () => {
  const f = fixture(); await f.api.ensure(); await f.action('register');
  assert.equal(JSON.parse(f.map.get('cookai.auth')).uid, 'guest');
  assert.equal(JSON.parse(f.map.get('cookai.auth')).email, 'cook@example.com');
  assert.equal(f.commits[0].token, 'Bearer account-token');
  assert.match(f.commits[0].body.writes[0].update.name, /users\/guest\/history\/web_old$/);
  assert.equal(f.api.history()[0].recipe, '卵を焼く');
  assert.equal(f.map.has('cookai.history'), false);
});
test('login merges guest recipes into the destination using stable IDs', async () => {
  const f = fixture(); await f.api.ensure(); await f.action('login');
  assert.equal(JSON.parse(f.map.get('cookai.auth')).uid, 'account');
  assert.match(f.commits[0].body.writes[0].update.name, /users\/account\/history\/guest_guest_web_old$/);
  assert.equal(f.api.history().length, 1);
  assert.equal(JSON.parse(f.map.get('cookai.history.guest')).length, 1);
});
test('failed transfer preserves the guest session and its history', async () => {
  const f = fixture({ failWrites: true }); await f.api.ensure(); await f.action('login');
  assert.equal(JSON.parse(f.map.get('cookai.auth')).uid, 'guest');
  assert.equal(f.api.history().length, 1);
  assert.match(f.element('accountMessage').textContent, /端末の履歴は残っています/);
});
test('a wrong password cannot replace the guest session or upload history', async () => {
  const f = fixture(); await f.api.ensure();
  f.element('accountEmail').value = 'cook@example.com'; f.element('accountPassword').value = 'wrong';
  await f.buttons.find(button => button.dataset.accountAction === 'login').onclick();
  assert.equal(JSON.parse(f.map.get('cookai.auth')).uid, 'guest');
  assert.equal(f.commits.length, 0);
  assert.equal(f.api.history().length, 1);
});
