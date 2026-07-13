# PinPoint

災害時に被災者の位置をリアルタイム共有し、**ARカメラ越しに救助対象の方向・距離を可視化**する位置共有システム。

**本番環境:** https://pinpoint.seizavl.workers.dev

被災者はスマホで位置を送信し、救助者はARカメラまたはマップから全員の位置を確認できます。GPSが届きにくい屋内でも、歩行者デッドレコニング(PDR)とカルマンフィルタで位置推定を継続します。

**全画面がログイン必須**です。誰でもURLを開けば見られる状態を防ぐため、未認証のアクセスはログインページへリダイレクトされ、アプリ本体は一切配信されません。

---

## 画面

| URL | 用途 | 権限 | 説明 |
|-----|------|------|------|
| `/login` | 全員 | 公開 | ログイン画面（Worker埋め込み） |
| `/signup` | 招待者 | 招待制 | 招待URL経由のユーザー登録画面 |
| `/` | 被災者 | ログイン | 位置情報の送信パネル（スマホで開く） |
| `/camera` | 救助者 | ログイン | ARカメラ。相手の位置を赤い枠で表示 |
| `/map` | 救助者 | ログイン | 地図上に全員の位置をリアルタイム表示 |
| `/admin` | 管理者 | **admin** | 管理コンソール（マップ + ユーザー招待/管理 + 全位置情報の削除） |

> 位置情報・カメラ・方位センサーを使用するため、**HTTPS環境が必須**です（本番のworkers.devは常時HTTPS）。iOSでは初回にセンサー許可ダイアログが表示されます。

---

## 認証・アカウント

- **admin（オーナー）** アカウントは Worker の secret（`AUTH_USERNAME` / `AUTH_PASSWORD`）でシードされます。新規登録では作成できません。
- 一般ユーザーは **admin が発行した招待URLからのみ** 登録できます（招待は単一使用・7日で失効）。公開のサインアップはありません。
- セッションは HMAC 署名付きの HttpOnly / Secure Cookie（30日）。ユーザーのパスワードは PBKDF2-SHA256 でハッシュ化して保存します。
- ユーザーアカウントと招待は専用の Durable Object（`AuthStore`）に永続化されます。

### secret の設定（初回のみ）

```bash
cd worker
npx wrangler secret put AUTH_USERNAME    # adminのユーザー名
npx wrangler secret put AUTH_PASSWORD    # adminのパスワード
npx wrangler secret put SESSION_SECRET   # Cookie署名用のランダムな長い文字列
```

`SESSION_SECRET` は例えば次で生成できます:
`node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))" | npx wrangler secret put SESSION_SECRET`

---

## アーキテクチャ

クライアント（静的アセット）とリアルタイムサーバー（WebSocket）を、**同一オリジンの単一 Cloudflare Worker** として配信します。

```
┌─────────────────────────────────────────┐
│  Cloudflare Worker  (pinpoint)          │
│                                         │
│  ├─ 認証      セッション/ロール判定       │
│  ├─ 静的配信   client/dist (SPA)         │
│  ├─ /ws        LocationRoom DO (WebSocket)│
│  └─ AuthStore DO (ユーザー/招待)          │
└─────────────────────────────────────────┘
```

- **フロントエンド:** React + Vite + Tailwind CSS（PWA対応）
- **リアルタイム通信:** ネイティブ WebSocket（Durable Object の Hibernation API）
- **認証:** Worker 層でセッション Cookie を検証し、未認証はアセットを返さずリダイレクト。`AuthStore` Durable Object がユーザー/招待を管理
- **状態保持:** 位置データは `LocationRoom` Durable Object storage に保持し、24時間で自動失効
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
