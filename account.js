/* Firebase's public API key identifies the project; authorization is enforced by Auth and Firestore Rules. */
window.CookAccount = (() => {
  const API_KEY = 'AIzaSyDGlT5oWGQIUmJQLhfINko1kHHEZlGFIhI';
  const ROOT = 'projects/liefantidia2/databases/default/documents';
  const BASE = `https://firestore.googleapis.com/v1/${ROOT}`;
  const $ = id => document.getElementById(id);
  const read = (key, fallback) => { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } };
  let session = read('cookai.auth', null), busy = false, pending, needsLogin = false;
  let storageTail = Promise.resolve();
  function serialized(operation) {
    const result = storageTail.then(operation);
    storageTail = result.catch(() => {});
    return result;
  }
  const cacheKey = uid => `cookai.history.${uid}`;
  const prefKey = uid => `cookai.preferences.${uid}`;
  const writeCache = (uid, items) => localStorage.setItem(cacheKey(uid), JSON.stringify(items));
  const history = () => session ? read(cacheKey(session.uid), []) : [];
  const preferencesKey = () => prefKey(session?.uid || 'offline');
  const guest = () => !session?.email;
  function changed() { window.dispatchEvent(new Event('cookai-account')); render(); }
  async function jsonFetch(url, options = {}, timeout = 20000) {
    const abort = new AbortController(), timer = setTimeout(() => abort.abort(), timeout);
    try {
      const response = await fetch(url, { ...options, signal: abort.signal });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error?.message || data.error?.status || 'NETWORK_ERROR');
      return data;
    } catch (error) {
      if (error.name === 'AbortError') throw new Error('NETWORK_TIMEOUT');
      throw error;
    } finally { clearTimeout(timer); }
  }
  const authRequest = (method, body) => jsonFetch(`https://identitytoolkit.googleapis.com/v1/accounts:${method}?key=${API_KEY}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
  });
  function credentials(data, previous = {}) {
    return { uid: data.localId || data.user_id || previous.uid, email: data.email ?? previous.email ?? '',
      idToken: data.idToken || data.id_token, refreshToken: data.refreshToken || data.refresh_token || previous.refreshToken,
      expiresAt: Date.now() + Number(data.expiresIn || data.expires_in || 3600) * 1000 };
  }
  function persist(next) {
    localStorage.setItem('cookai.auth', JSON.stringify(next));
    session = next;
    needsLogin = false;
  }
  async function refresh(current = session) {
    if (!current?.refreshToken) throw new Error('LOGIN_REQUIRED');
    const data = await jsonFetch(`https://securetoken.googleapis.com/v1/token?key=${API_KEY}`, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: current.refreshToken })
    });
    const next = credentials(data, current);
    if (current === session) persist(next);
    return next;
  }
  async function ensure(force = false) {
    if (pending) return pending;
    pending = (async () => {
      if (session) {
        if (force || session.expiresAt < Date.now() + 120000) {
          try { session = await refresh(); }
          catch (error) {
            if (/INVALID_REFRESH_TOKEN|TOKEN_EXPIRED|USER_DISABLED|USER_NOT_FOUND|INVALID_ID_TOKEN/.test(error.message)) {
              needsLogin = true; render();
            }
            throw error;
          }
        }
        if (!session.uid || session.email === undefined) {
          const data = await authRequest('lookup', { idToken: session.idToken });
          const user = data.users?.[0];
          if (!user) throw new Error('LOGIN_REQUIRED');
          persist({ ...session, uid: user.localId, email: user.email || '' });
        }
      } else persist(credentials(await authRequest('signUp', { returnSecureToken: true })));
      // Claim legacy unscoped browser data only once, for its original session.
      for (const [old, key] of [['cookai.history', cacheKey(session.uid)], ['cookai.preferences', prefKey(session.uid)]]) {
        const raw = localStorage.getItem(old);
        if (raw !== null) {
          if (localStorage.getItem(key) === null) localStorage.setItem(key, raw);
          localStorage.removeItem(old);
        }
      }
      return session;
    })();
    try { return await pending; } finally { pending = null; }
  }
  async function cloud(path, options = {}, current = session) {
    if (current.expiresAt < Date.now() + 120000) current = await refresh(current);
    return jsonFetch(`${BASE}${path}`, { ...options, headers: { 'Content-Type': 'application/json',
      Authorization: `Bearer ${current.idToken}`, ...options.headers } });
  }
  const path = uid => `/artifacts/liefantidia2/users/${encodeURIComponent(uid)}/history`;
  const documentId = item => item.cloudId || `web_${item.id}`;
  function fields(item) {
    return { recipeTitle: { stringValue: item.title || 'CookAi レシピ' },
      ingredientsWithUsage: { stringValue: item.ingredients || '' }, allConstraints: { stringValue: item.constraints || '' },
      recipeContent: { stringValue: item.recipe }, timestamp: { integerValue: String(item.createdAt) } };
  }
  async function upload(items, current) {
    for (let i = 0; i < items.length; i += 100) {
      await cloud(':commit', { method: 'POST', body: JSON.stringify({ writes: items.slice(i, i + 100).map(item => ({
        update: { name: `${ROOT}${path(current.uid)}/${encodeURIComponent(documentId(item))}`, fields: fields(item) }
      })) }) }, current);
    }
  }
  async function sync() {
    await ensure();
    const current = session;
    const local = history();
    const unsaved = local.filter(item => !item.cloudSaved);
    await upload(unsaved, current);
    // Record acknowledgements before reading; retries cannot resurrect previously synced, deleted recipes.
    writeCache(current.uid, local.map(item => ({ ...item, cloudSaved: true })));
    let token = '', all = [];
    do {
      const query = new URLSearchParams({ pageSize: '100' });
      if (token) query.set('pageToken', token);
      const data = await cloud(`${path(current.uid)}?${query}`, {}, current);
      all.push(...(data.documents || []).map(doc => {
        const f = doc.fields || {}, id = doc.name.split('/').pop();
        return { id, cloudId: id, cloudSaved: true, title: f.recipeTitle?.stringValue || 'CookAi レシピ',
          ingredients: f.ingredientsWithUsage?.stringValue || '', constraints: f.allConstraints?.stringValue || '',
          recipe: f.recipeContent?.stringValue || '', createdAt: Number(f.timestamp?.integerValue || Date.parse(f.timestamp?.timestampValue || '') || 0) };
      }));
      token = data.nextPageToken || '';
    } while (token);
    if (session.uid !== current.uid) return;
    // Include recipes generated while the read was in flight.
    const newer = history().filter(item => !item.cloudSaved && !unsaved.some(old => old.id === item.id));
    writeCache(current.uid, [...newer, ...all].sort((a, b) => b.createdAt - a.createdAt));
    changed();
  }
  async function save(item) {
    await ensure();
    const entry = { ...item, id: crypto.randomUUID(), cloudSaved: false };
    writeCache(session.uid, [entry, ...history()]);
    {
      await upload([entry], session);
      writeCache(session.uid, history().map(x => x.id === entry.id ? { ...x, cloudSaved: true } : x));
    }
  }
  async function clear() {
    await ensure();
    if (!guest()) {
      // Read the complete account history before deleting, including Android recipes.
      await sync();
      const items = history();
      for (let i = 0; i < items.length; i += 100) await cloud(':commit', { method: 'POST', body: JSON.stringify({
        writes: items.slice(i, i + 100).map(item => ({ delete: `${ROOT}${path(session.uid)}/${encodeURIComponent(documentId(item))}` }))
      }) });
    }
    writeCache(session.uid, []);
    changed();
  }
  async function register(email, password) {
    await ensure();
    if (!guest()) throw new Error('ALREADY_SIGNED_IN');
    const result = await authRequest('update', { idToken: session.idToken, email, password, returnSecureToken: true });
    persist(credentials(result, session));
    changed();
    await sync();
  }
  async function login(email, password) {
    if (!session?.uid) await ensure();
    if (!guest() && !needsLogin) throw new Error('ALREADY_SIGNED_IN');
    await sync();
    const source = session;
    const destination = credentials(await authRequest('signInWithPassword', { email, password, returnSecureToken: true }));
    // Keep the guest session/cache until every write to the destination has succeeded.
    if (source.email && destination.uid !== source.uid) throw new Error('LOGIN_SAME_ACCOUNT');
    const items = source.email ? history().filter(item => !item.cloudSaved)
      : history().map(item => ({ ...item, cloudId: `guest_${source.uid}_${documentId(item)}` }));
    await upload(items, destination);
    if (!localStorage.getItem(prefKey(destination.uid))) {
      const prefs = localStorage.getItem(prefKey(source.uid));
      if (prefs) localStorage.setItem(prefKey(destination.uid), prefs);
    }
    persist(destination);
    changed();
    await sync();
  }
  async function logout() {
    await ensure();
    await sync(); // Keep pending history accessible if a cloud write fails.
    // Obtain the new guest session before replacing the signed-in account.
    persist(credentials(await authRequest('signUp', { returnSecureToken: true })));
    changed();
  }
  function message(error) {
    const text = String(error?.message || '');
    if (/LOGIN_SAME_ACCOUNT/.test(text)) return '現在のアカウントと同じメールアドレスでログインし直してください。';
    if (/INVALID_REFRESH_TOKEN|TOKEN_EXPIRED|USER_DISABLED|USER_NOT_FOUND|INVALID_ID_TOKEN/.test(text)) return 'ログインの有効期限が切れました。同じメールアドレスでログインし直してください。';
    if (/EMAIL_EXISTS/.test(text)) return '登録済みのメールアドレスです。「ログイン」を選んでください。';
    if (/OPERATION_NOT_ALLOWED|PASSWORD_LOGIN_DISABLED/.test(text)) return 'メールログインが有効になっていません。管理者にお問い合わせください。';
    if (/INVALID_LOGIN_CREDENTIALS|INVALID_PASSWORD|EMAIL_NOT_FOUND/.test(text)) return 'メールアドレスまたはパスワードを確認してください。';
    if (/WEAK_PASSWORD/.test(text)) return '6文字以上のパスワードを入力してください。';
    if (/TOO_MANY_ATTEMPTS/.test(text)) return '少し時間をおいて再試行してください。';
    if (/PERMISSION_DENIED/.test(text)) return '履歴を同期できません。保存権限の設定を管理者にご確認ください。端末の履歴は残っています。';
    if (/INVALID_EMAIL/.test(text)) return 'メールアドレスを確認してください。';
    return '通信または認証処理を完了できませんでした。接続を確認して再試行してください。端末の履歴は残っています。';
  }
  function render() {
    if (!$('accountStatus')) return;
    $('accountStatus').textContent = session?.email ? `ログイン中：${session.email}` : 'ゲストで利用中';
    $('accountCredentials').hidden = !guest() && !needsLogin;
    $('logoutButton').hidden = guest();
    $('syncButton').hidden = guest();
    document.querySelectorAll('[data-account-action]').forEach(button => button.disabled = busy);
    $('generateButton').disabled = busy || !!window.cookaiGenerating;
    $('accountProgress').hidden = !busy;
    $('accountClose').disabled = busy;
  }
  async function action(name) {
    if (busy || window.cookaiGenerating) return;
    const email = $('accountEmail').value.trim(), password = $('accountPassword').value;
    if (['register', 'login', 'reset'].includes(name) && !$('accountEmail').reportValidity()) return;
    if (['register', 'login'].includes(name) && (!password || (name === 'register' && password.length < 6))) {
      $('accountMessage').textContent = 'パスワードを入力してください。新規登録では6文字以上が必要です。'; return;
    }
    busy = true; render(); $('accountMessage').textContent = '処理しています…';
    try {
      if (name === 'register') await serialized(() => register(email, password));
      if (name === 'login') await serialized(() => login(email, password));
      if (name === 'logout') await serialized(logout);
      if (name === 'sync') await serialized(sync);
      if (name === 'reset') await authRequest('sendOobCode', { requestType: 'PASSWORD_RESET', email });
      $('accountPassword').value = '';
      $('accountMessage').textContent = { register: '登録しました。ゲストの履歴を保存しました。', login: 'ログインしました。履歴を引き継ぎました。', logout: 'ログアウトしました。履歴はアカウントに保存されています。', sync: '履歴を同期しました。', reset: '登録されている場合、再設定メールが届きます。' }[name];
    } catch (error) { $('accountMessage').textContent = message(error); }
    finally { busy = false; render(); }
  }
  document.addEventListener('DOMContentLoaded', () => {
    $('accountToggle').onclick = () => { $('accountDialog').showModal(); render(); };
    $('accountClose').onclick = () => $('accountDialog').close();
    document.querySelectorAll('[data-account-action]').forEach(button => button.onclick = () => action(button.dataset.accountAction));
    $('accountDialog').addEventListener('cancel', event => { if (busy) event.preventDefault(); });
    ensure().then(() => { changed(); if (!guest()) return serialized(sync); }).catch(error => {
      $('accountMessage').textContent = message(error);
    });
  });
  return { ensure, refresh: () => ensure(true), history, preferencesKey, save: item => serialized(() => save(item)), clear: () => serialized(clear), sync: () => serialized(sync), guest, message,
    busy: () => busy };
})();
