# 災害AR救助システム - Phase 1

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

## 本番デプロイ

### サーバー（Railway）
1. `server/` をRailwayにデプロイ
2. 環境変数 `CLIENT_ORIGIN` にVercelのURLを設定

### クライアント（Vercel）
1. `client/` をVercelにデプロイ
2. 環境変数 `VITE_SERVER_URL` にRailwayのURLを設定

## Phase 1 完了条件チェック
- [x] 統合位置ボタン送信（GPS + Wi-Fi/モバイル網補完） → 管理者マップに青ピン
- [x] 世界座標ボタン送信 → 管理者マップに赤ピン＋向き表示
- [x] 複数スマホ同時送信
- [x] WebSocket自動再接続（Socket.io標準機能）
- [x] iOS Safari対応（requestPermission実装済み）
- [x] リアルタイムマップ更新（ポーリングなし）
