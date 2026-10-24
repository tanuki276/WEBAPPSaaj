# CookAi Web

CookAi Android版のWebエディションです。

- Firebase匿名認証（ブラウザ）
- Vercel Function `/api/generate`
- 既存Cloudflare Worker AIルーターへの中継
- レシピ履歴・調理設定はブラウザのlocalStorageへ保存

ブラウザはFirebase匿名認証でIDトークンを取得し、同一オリジンの `/api/generate` に送信します。Vercel FunctionがIDトークンを保持したままCookAi Cloudflare Workerへ転送します。LLMプロバイダの秘密鍵はWebアプリへ配布しません。

必要ならVercel環境変数 `COOKAI_WORKER_URL` でWorker URLを上書きできます。
