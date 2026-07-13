# PinPoint - 災害AR救助システム

本番: https://pinpoint.seizavl.workers.dev

## 起動方法

### サーバー
```bash
cd server
npm run dev
```
→ http://localhost:3001 で起動

### クライアント
```bash
cd client
npm run dev
```
→ http://localhost:5173 で起動

### 画面
| URL | 説明 |
|-----|------|
| http://localhost:5173/ | 被災者用（スマホで開く）|
| http://localhost:5173/admin | 管理者マップ |

## 本番デプロイ（Cloudflare Workers）

クライアント(静的アセット)とWebSocketサーバー(Durable Objects)を同一オリジンの
1つのWorkerとして配信するため、`VITE_SERVER_URL` などの環境変数設定は不要。

```bash
cd client && npm run build      # client/dist を生成
cd ../worker && npm install && npx wrangler deploy
```

- `worker/wrangler.jsonc` の `assets.directory` が `../client/dist` を指しており、
  Workerが静的ファイルの配信とWebSocket(`/ws`)の両方を担う。
- `/admin` や `/camera` などのSPAルーティングは `not_found_handling: "single-page-application"` で対応。
- ローカルでWorkerを試す場合は `cd worker && npm run dev` (http://localhost:8787)。
  クライアントの `npm run dev` はViteの `/ws` proxy経由でこれに接続する。

### server/ について
`server/`（Express + socket.io）はローカル開発用のレガシー実装として残しているが、
本番のデプロイ先は Cloudflare Workers (`worker/`) に統一した。

## Phase 1 完了条件チェック
- [x] 統合位置ボタン送信（GPS + Wi-Fi/モバイル網補完） → 管理者マップに青ピン
- [x] 世界座標ボタン送信 → 管理者マップに赤ピン＋向き表示
- [x] 複数スマホ同時送信
- [x] WebSocket自動再接続（Socket.io標準機能）
- [x] iOS Safari対応（requestPermission実装済み）
- [x] リアルタイムマップ更新（ポーリングなし）
