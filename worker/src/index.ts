import { LocationRoom } from './room';
import { AuthStore } from './authStore';
import {
  clearCookie,
  getCookie,
  SESSION_TTL_SEC,
  sessionCookie,
  signSession,
  timingSafeEqual,
  verifyPassword,
  verifySession,
} from './auth';
import { LOGIN_HTML } from './loginPage';
import { signupHtml } from './signupPage';

export { LocationRoom, AuthStore };

export interface Env {
  ASSETS: Fetcher;
  ROOM: DurableObjectNamespace;
  AUTH: DurableObjectNamespace;
  // adminアカウントをシードするための secret。未設定でも起動はでき、該当機能が失敗扱いになるだけ。
  AUTH_USERNAME?: string;
  AUTH_PASSWORD?: string;
  SESSION_SECRET?: string;
}

// 単一インスタンスの AuthStore DO を取得する
function authStore(env: Env): DurableObjectStub {
  const id = env.AUTH.idFromName('global');
  return env.AUTH.get(id);
}

// AuthStore への内部RPC呼び出しヘルパ (WorkerからのみJSONで呼ぶ、公開しない)
async function callAuth(env: Env, body: Record<string, unknown>): Promise<Response> {
  const stub = authStore(env);
  return stub.fetch('https://auth/rpc', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

// LocationRoom DO の単一インスタンスを取得する
function locationRoom(env: Env): DurableObjectStub {
  const id = env.ROOM.idFromName('global');
  return env.ROOM.get(id);
}

const NO_STORE_HEADERS = { 'Cache-Control': 'no-store' };

// 認証なしで配信するPWA関連ファイル。
// Service Worker のスクリプト取得はリダイレクトを許容しないため、
// これらを認証ゲートの内側に置くと SW が更新できず、古い(認証を知らない)SWが
// ログインページを乗っ取り続けて復旧不能になる。アプリ本体のJS/CSSは含めない。
const PUBLIC_ASSET_PATHS = new Set([
  '/sw.js',
  '/registerSW.js',
  '/manifest.webmanifest',
  '/favicon.ico',
  '/icon-192.png',
  '/icon-512.png',
]);

function isPublicAsset(path: string): boolean {
  return PUBLIC_ASSET_PATHS.has(path) || /^\/workbox-[\w.-]+\.js$/.test(path);
}

function htmlResponse(html: string, status = 200): Response {
  return new Response(html, {
    status,
    headers: { 'Content-Type': 'text/html; charset=utf-8', ...NO_STORE_HEADERS },
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    // ---- 公開エンドポイント (認証不要) ----

    if (path === '/health') {
      return Response.json({ status: 'ok', timestamp: Date.now() });
    }

    if (request.method === 'GET' && isPublicAsset(path)) {
      return env.ASSETS.fetch(request);
    }

    if (request.method === 'GET' && path === '/login') {
      return htmlResponse(LOGIN_HTML);
    }

    if (request.method === 'GET' && path === '/signup') {
      const invite = url.searchParams.get('invite') ?? '';
      return htmlResponse(signupHtml(invite));
    }

    if (request.method === 'POST' && path === '/api/login') {
      return handleLogin(request, env);
    }

    if (request.method === 'POST' && path === '/api/logout') {
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json', 'Set-Cookie': clearCookie() },
      });
    }

    if (request.method === 'GET' && path === '/api/me') {
      const session = await verifySession(getCookie(request, 'session'), env.SESSION_SECRET);
      if (!session) return Response.json({ ok: false }, { status: 401 });
      return Response.json({ ok: true, role: session.role });
    }

    if (request.method === 'POST' && path === '/api/signup') {
      return handleSignup(request, env);
    }

    // ---- ここから先はセッション必須 ----
    const session = await verifySession(getCookie(request, 'session'), env.SESSION_SECRET);

    if (!session) {
      if (path === '/ws') {
        return new Response('Unauthorized', { status: 401 });
      }
      if (path.startsWith('/api/')) {
        return Response.json({ ok: false, error: 'unauthorized' }, { status: 401 });
      }
      // 未認証ユーザーにはアプリのアセットを一切返さず、ログインページへリダイレクトする
      return new Response(null, { status: 302, headers: { Location: '/login', ...NO_STORE_HEADERS } });
    }

    // ---- admin専用エリア ----
    if (path === '/admin' || path.startsWith('/api/admin/')) {
      if (session.role !== 'admin') {
        if (path === '/admin') {
          return new Response(null, { status: 302, headers: { Location: '/map', ...NO_STORE_HEADERS } });
        }
        return Response.json({ ok: false, error: 'forbidden' }, { status: 403 });
      }

      if (path.startsWith('/api/admin/')) {
        return handleAdminApi(request, env, path);
      }

      // /admin (画面) は SPA 側の AdminConsole コンポーネントに描画を任せる
      return env.ASSETS.fetch(request);
    }

    // ---- WebSocket ----
    if (path === '/ws') {
      const upgradeHeader = request.headers.get('Upgrade');
      if (!upgradeHeader || upgradeHeader.toLowerCase() !== 'websocket') {
        return new Response('Expected Upgrade: websocket', { status: 426 });
      }
      return locationRoom(env).fetch(request);
    }

    // それ以外は静的アセット(client/dist)を返す
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;

async function handleLogin(request: Request, env: Env): Promise<Response> {
  if (!env.SESSION_SECRET) {
    return Response.json({ error: 'not_configured' }, { status: 500 });
  }

  let body: { username?: string; password?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ ok: false }, { status: 400 });
  }

  const username = body.username ?? '';
  const password = body.password ?? '';

  let role: 'admin' | 'user' | null = null;

  // まず secret でシードされた admin アカウントと照合する
  if (env.AUTH_USERNAME && env.AUTH_PASSWORD && timingSafeEqual(username, env.AUTH_USERNAME)) {
    if (timingSafeEqual(password, env.AUTH_PASSWORD)) {
      role = 'admin';
    }
  }

  // admin でなければ DO に保存されたユーザーと照合する
  if (!role) {
    const res = await callAuth(env, { action: 'getUser', username });
    const user = (await res.json()) as { username: string; passwordHash: string; role: 'user' } | null;
    if (user && (await verifyPassword(password, user.passwordHash))) {
      role = 'user';
    }
  }

  if (!role) {
    // タイミング攻撃対策として、失敗時も一定時間待ってからレスポンスを返す
    await new Promise((resolve) => setTimeout(resolve, 300));
    return Response.json({ ok: false }, { status: 401 });
  }

  const token = await signSession({ sub: username, role, exp: Date.now() + SESSION_TTL_SEC * 1000 }, env.SESSION_SECRET);
  return new Response(JSON.stringify({ ok: true, role }), {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'Set-Cookie': sessionCookie(token, SESSION_TTL_SEC) },
  });
}

async function handleSignup(request: Request, env: Env): Promise<Response> {
  if (!env.SESSION_SECRET) {
    return Response.json({ ok: false, error: 'not_configured' }, { status: 500 });
  }

  let body: { invite?: string; username?: string; password?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ ok: false, error: 'invalid_request' }, { status: 400 });
  }

  const invite = body.invite ?? '';
  const username = body.username ?? '';
  const password = body.password ?? '';

  const res = await callAuth(env, { action: 'consumeInviteAndCreateUser', token: invite, username, password });
  const result = (await res.json()) as { ok: boolean; error?: string };
  if (!result.ok) {
    return Response.json(result, { status: 400 });
  }

  const token = await signSession(
    { sub: username, role: 'user', exp: Date.now() + SESSION_TTL_SEC * 1000 },
    env.SESSION_SECRET,
  );
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'Set-Cookie': sessionCookie(token, SESSION_TTL_SEC) },
  });
}

async function handleAdminApi(request: Request, env: Env, path: string): Promise<Response> {
  if (request.method === 'POST' && path === '/api/admin/invite') {
    const res = await callAuth(env, { action: 'createInvite' });
    const invite = (await res.json()) as { token: string; expiresAt: number };
    const url = new URL(request.url);
    return Response.json({ url: `${url.origin}/signup?invite=${invite.token}`, token: invite.token, expiresAt: invite.expiresAt });
  }

  if (request.method === 'GET' && path === '/api/admin/users') {
    const res = await callAuth(env, { action: 'listUsers' });
    const data = await res.json();
    return Response.json(data);
  }

  if (request.method === 'POST' && path === '/api/admin/users/delete') {
    let body: { username?: string };
    try {
      body = await request.json();
    } catch {
      return Response.json({ ok: false, error: 'invalid_request' }, { status: 400 });
    }
    const username = body.username ?? '';
    if (env.AUTH_USERNAME && username === env.AUTH_USERNAME) {
      return Response.json({ ok: false, error: 'ownerアカウントは削除できません' }, { status: 400 });
    }
    const res = await callAuth(env, { action: 'deleteUser', username });
    const data = await res.json();
    return Response.json(data);
  }

  if (request.method === 'POST' && path === '/api/admin/clear-locations') {
    const room = locationRoom(env);
    await room.fetch('https://room/__clear');
    return Response.json({ ok: true });
  }

  return Response.json({ ok: false, error: 'not_found' }, { status: 404 });
}
