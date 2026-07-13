# PinPoint

災害時に被災者の位置をリアルタイム共有し、**ARカメラ越しに救助対象の方向・距離を可視化**する位置共有システム。

**本番環境:** https://pinpoint.seizavl.workers.dev

被災者はスマホで位置を送信し、救助者はARカメラまたは管理者マップから全員の位置を確認できます。GPSが届きにくい屋内でも、歩行者デッドレコニング(PDR)とカルマンフィルタで位置推定を継続します。

---

## 画面

| URL | 用途 | 説明 |
|-----|------|------|
| `/` | 被災者 | 位置情報の送信パネル（スマホで開く） |
| `/camera` | 救助者 | ARカメラ。相手の位置を赤い枠で表示 |
| `/admin` | 管理者 | 地図上に全員の位置をリアルタイム表示 |

> 位置情報・カメラ・方位センサーを使用するため、**HTTPS環境が必須**です（本番のworkers.devは常時HTTPS）。iOSでは初回にセンサー許可ダイアログが表示されます。

---

## アーキテクチャ

クライアント（静的アセット）とリアルタイムサーバー（WebSocket）を、**同一オリジンの単一 Cloudflare Worker** として配信します。

```
┌─────────────────────────────────────────┐
│  Cloudflare Worker  (pinpoint)          │
│                                         │
│  ├─ 静的配信   client/dist (SPA)         │
│  └─ /ws        Durable Object            │
│                (LocationRoom, WebSocket) │
└─────────────────────────────────────────┘
```

- **フロントエンド:** React + Vite + Tailwind CSS（PWA対応）
- **リアルタイム通信:** ネイティブ WebSocket（Durable Object の Hibernation API）
- **状態保持:** 位置データは Durable Object storage に保持し、24時間で自動失効
- 同一オリジン配信のため `VITE_SERVER_URL` などの環境変数設定は不要

---

## デプロイ

```bash
# 1. クライアントをビルド（client/dist を生成）
cd client && npm install && npm run build

# 2. Worker をデプロイ
cd ../worker && npm install && npx wrangler deploy
```

初回は `npx wrangler login` で Cloudflare 認証が必要です。デプロイ設定は [`worker/wrangler.jsonc`](worker/wrangler.jsonc) を参照してください。

---

## ローカル開発

```bash
# ターミナル1: Worker（http://localhost:8787）
cd worker && npm run dev

# ターミナル2: クライアント（https://localhost:5173）
cd client && npm run dev
```

クライアントの開発サーバーは Vite の `/ws` proxy 経由で Worker に接続します。実機のスマホから確認する場合は、Vite が表示する LAN の HTTPS URL を開いてください。

---

## 主な機能

- **統合位置送信** — GPS と Wi-Fi/モバイル網の測位候補を融合して送信
- **世界座標送信** — 位置に加えて端末の向き（方位・傾き）を送信
- **AR表示** — カメラ映像に相手の位置を赤枠で重畳。画面外の相手も画面端に矢印付きで常時表示
- **屋内位置推定** — GPSが劣化した環境では、加速度センサーによる歩数検出（PDR）とコンパス方位で位置を継続推定
- **高精度化** — 水平位置・高度をそれぞれカルマンフィルタで平滑化（測位精度 `accuracy`/`altitudeAccuracy` を観測ノイズとして利用）
- **リアルタイム同期** — WebSocket による即時反映（ポーリングなし）。切断時は指数バックオフで自動再接続

---

## ディレクトリ構成

| ディレクトリ | 内容 |
|--------------|------|
| `client/` | フロントエンド（React + Vite） |
| `worker/` | Cloudflare Worker（静的配信 + WebSocket サーバー）※本番はこちら |
| `server/` | Express + socket.io のレガシー実装（ローカル開発用。本番では使用しない） |

> `server/` は初期実装の名残で、Worker 版とはプロトコル互換性がありません。本番デプロイ先は `worker/` に統一されています。
