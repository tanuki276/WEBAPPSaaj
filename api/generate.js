const DEFAULT_WORKER_URL = 'https://liefantidia2-ai-router.light06120602.workers.dev/generate-recipe';
export const UPSTREAM_TIMEOUT_MS = 120000;
export const HIGH_ACCURACY_TIMEOUT_MS = 165000;

// Kept on the server so older clients also receive the recipe-quality requirements.
export const RECIPE_REQUIREMENTS = `【レシピの品質条件】
料理初心者が再現できる日本語のレシピを作成してください。短くするために分量・下準備・味付けを省略しないでください。
・人数と調理時間（下準備を含む目安）を明記。人数・食材量が未指定なら2人分の提案量であることを明示し、指定があれば優先してください。
・「材料」に全食材、調味料、油、水を使用量と単位（g、ml、個、大さじ、小さじ等）付きで列挙。基本の味付けを「適量」「お好み」だけで済ませず、まず入れる量と追加調整を分けてください。
・「下準備」で洗う・皮をむく・切る等の必要な作業と切る大きさを具体的に説明してください。
・「作り方」は番号付きで、器具、油の量、材料を入れる順番、火加減、各加熱工程の時間の目安と見た目等の確認方法を記載。調味料は名前・量・入れるタイミングまで説明してください。
・「火が通るまで炒める」だけで終えず、時間は食材の量・厚さや器具で変わる目安とし、完成の確認方法も示してください。非加熱料理に不要な加熱工程を作らないでください。
・「コツ・注意点」で焦げそうなときの火加減など、初心者向けの失敗を防ぐ具体策を示してください。
・材料欄と手順を照合し、材料の使い忘れ・手順だけに出る食材や調味料・味付けの抜けを修正してから回答してください。
・アレルギー、食事制限、使用可能な調味料・器具を優先。条件を満たせないときは理由と必要な確認を説明し、無理な代替や条件違反のレシピを作らないでください。
・食用か不明な食材、野生採取品、昆虫などで食用の流通品か・加工状態が不明な場合は、確認事項を先に説明し、安全性や加熱条件を推測して調理手順を断定しないでください。`;

export default async function handler(request, response) {
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST');
    return response.status(405).json({ error: 'Method not allowed' });
  }
  const auth = String(request.headers.authorization || '');
  if (!auth.startsWith('Bearer ') || auth.length > 5000) {
    return response.status(401).json({ error: '認証が必要です。ページを再読み込みしてください。' });
  }
  const ingredients = typeof request.body?.ingredients === 'string' ? request.body.ingredients.trim() : '';
  const constraints = typeof request.body?.constraints === 'string' ? request.body.constraints.trim() : '';
  const mode = request.body?.mode === 'high' ? 'high' : 'normal';
  if (request.body?.mode !== undefined && !['normal', 'high'].includes(request.body.mode)) {
    return response.status(400).json({ error: '生成モードが正しくありません。' });
  }
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
  const timeoutMs = mode === 'high' ? HIGH_ACCURACY_TIMEOUT_MS : UPSTREAM_TIMEOUT_MS;
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const upstream = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: auth },
      body: JSON.stringify({ ingredients, constraints: [constraints, RECIPE_REQUIREMENTS].filter(Boolean).join('\n\n'), mode }),
      signal: controller.signal
    });
    const payload = await upstream.json().catch(() => ({}));
    if (!upstream.ok) {
      const status = [400, 401, 403, 413, 429, 503, 504].includes(upstream.status) ? upstream.status : 502;
      const retryAfter = upstream.headers.get('retry-after');
      if (retryAfter && /^\d{1,6}$/.test(retryAfter)) response.setHeader('Retry-After', retryAfter);
      return response.status(status).json({ error: String(payload.error || 'AIサーバーでエラーが発生しました。').slice(0, 220) });
    }
    const recipe = typeof payload.recipe === 'string' ? payload.recipe.trim() : '';
    if (!recipe) return response.status(502).json({ error: 'AIから有効なレシピが返りませんでした。' });
    return response.status(200).json({ recipe, mode: payload.mode || mode });
  } catch (error) {
    if (controller.signal.aborted) return response.status(504).json({ error: 'AIの応答に時間がかかっています。少し待ってから再試行してください。' });
    console.error('CookAi upstream request failed', { code: error?.code || error?.name || 'UNKNOWN' });
    return response.status(502).json({ error: 'AIサーバーへ接続できませんでした。' });
  } finally { clearTimeout(timer); }
}
