const DEFAULT_WORKER_URL = 'https://liefantidia2-ai-router.light06120602.workers.dev/generate-recipe';
// Allow the router to try alternative providers (each provider can take 25 seconds).
// The Vercel function budget is 180s; the browser waits 135s.
export const UPSTREAM_TIMEOUT_MS = 120000;

export default async function handler(request, response) {
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST');
    return response.status(405).json({ error: 'Method not allowed' });
  }
  const auth = String(request.headers.authorization || '');
  if (!auth.startsWith('Bearer ') || !auth.slice(7).trim() || auth.length > 5000) {
    return response.status(401).json({ error: '認証が必要です。ページを再読み込みしてください。' });
  }
  const ingredients = typeof request.body?.ingredients === 'string' ? request.body.ingredients.trim() : '';
  const constraints = typeof request.body?.constraints === 'string' ? request.body.constraints.trim() : '';
  if (!ingredients) return response.status(400).json({ error: '食材が入力されていません。' });
  if (ingredients.length > 2000 || constraints.length > 4000) return response.status(413).json({ error: '入力が長すぎます。' });
  let endpoint;
  try {
    endpoint = new URL(process.env.COOKAI_WORKER_URL || DEFAULT_WORKER_URL);
    if (endpoint.protocol !== 'https:' || endpoint.pathname !== '/generate-recipe' || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) throw new Error('invalid');
  } catch {
    return response.status(503).json({ error: 'AI接続先が正しく設定されていません。' });
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  try {
    const upstream = await fetch(endpoint, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: auth },
      body: JSON.stringify({ ingredients, constraints }), signal: controller.signal
    });
    const payload = await upstream.json().catch(() => ({}));
    if (!upstream.ok) {
      const status = [400, 401, 413, 429, 503, 504].includes(upstream.status) ? upstream.status : 502;
      const retryAfter = upstream.headers.get('retry-after');
      if (retryAfter && /^\d{1,6}$/.test(retryAfter)) response.setHeader('Retry-After', retryAfter);
      return response.status(status).json({ error: String(payload?.error || 'AIサーバーでエラーが発生しました。').slice(0, 220) });
    }
    const recipe = typeof payload?.recipe === 'string' ? payload?.recipe.trim() : '';
    if (!recipe) return response.status(502).json({ error: 'AIから有効なレシピが返りませんでした。' });
    return response.status(200).json({ recipe });
  } catch (error) {
    if (controller.signal.aborted) return response.status(504).json({ error: 'AIの応答に時間がかかっています。少し待ってから再試行してください。' });
    console.error('CookAi upstream request failed', { code: error?.code || error?.name || 'UNKNOWN' });
    return response.status(502).json({ error: 'AIサーバーへ接続できませんでした。' });
  } finally { clearTimeout(timer); }
}
