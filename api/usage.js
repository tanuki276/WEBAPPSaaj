const DEFAULT_WORKER_URL = 'https://liefantidia2-ai-router.light06120602.workers.dev/generate-recipe';

export default async function handler(request, response) {
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  if (request.method !== 'GET') {
    response.setHeader('Allow', 'GET');
    return response.status(405).json({ error: 'Method not allowed' });
  }
  const auth = String(request.headers.authorization || '');
  if (!auth.startsWith('Bearer ') || auth.length > 5000) {
    return response.status(401).json({ error: '認証が必要です。ページを再読み込みしてください。' });
  }

  let endpoint;
  try {
    endpoint = new URL(process.env.COOKAI_WORKER_URL || DEFAULT_WORKER_URL);
    if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) throw new Error('invalid');
    endpoint.pathname = '/usage';
  } catch {
    return response.status(503).json({ error: '利用状況を取得できません。' });
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const upstream = await fetch(endpoint, {
      method: 'GET',
      headers: { Accept: 'application/json', Authorization: auth },
      signal: controller.signal
    });
    const payload = await upstream.json().catch(() => ({}));
    if (!upstream.ok) {
      const status = [400, 401, 403, 429, 503].includes(upstream.status) ? upstream.status : 502;
      return response.status(status).json({ error: String(payload.error || '利用状況を取得できません。').slice(0, 220) });
    }
    return response.status(200).json(payload);
  } catch (error) {
    if (controller.signal.aborted) return response.status(504).json({ error: '利用状況の取得がタイムアウトしました。' });
    console.error('CookAi usage request failed', { code: error?.code || error?.name || 'UNKNOWN' });
    return response.status(502).json({ error: '利用状況を取得できません。' });
  } finally {
    clearTimeout(timer);
  }
}
