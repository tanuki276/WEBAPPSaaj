# CookAi Web

CookAi Android版のWebエディションです。

- Firebase匿名認証（ブラウザ）
- Vercel Function `/api/generate`
- 既存Cloudflare Worker AIルーターへの中継
- レシピ履歴・調理設定はブラウザのlocalStorageへ保存

ブラウザはFirebase匿名認証でIDトークンを取得し、同一オリジンの `/api/generate` に送信します。Vercel FunctionがIDトークンを保持したままCookAi Cloudflare Workerへ転送します。LLMプロバイダの秘密鍵はWebアプリへ配布しません。

必要ならVercel環境変数 `COOKAI_WORKER_URL` でWorker URLを上書きできます。

## Android版に合わせたUI
淡い背景・深緑のボタン・角丸カードで統一しました。スマホでは縦並び、PCでは入力とレシピを横並びに表示します。上部の設定ボタンから調理設定を開けます。追加指示、生成停止、履歴検索、コピー・共有に対応します。

Web版の履歴と調理設定はこのブラウザ内に保存されます。Android版のログイン・Firestore履歴との同期には対応していません。ブラウザデータの削除で履歴も消えます。

Vercelにこのリポジトリを接続してデプロイしてください。フレームワークはOther、ビルドコマンドは不要です。`/api/generate` はVercel Functionで動作します。Firebase匿名認証が既存プロジェクトで有効である必要があります。
