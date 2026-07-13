import { hashPassword, INVITE_TTL_SEC, randomToken } from './auth';

// AuthStore は単一インスタンス(idFromName('global'))で運用し、
// ユーザーアカウントと招待トークンを ctx.storage (SQLite) に永続化する。
// このDOはWorkerからの内部RPC専用で、外部には一切公開しない。

interface StoredUser {
  username: string;
  passwordHash: string;
  role: 'user';
  createdAt: number;
}

interface StoredInvite {
  createdAt: number;
  expiresAt: number;
  used: boolean;
}

type RpcResult =
  | { ok: true; [key: string]: unknown }
  | { ok: false; error: string };

const USERNAME_RE = /^[a-zA-Z0-9_-]{3,32}$/;
const MIN_PASSWORD_LEN = 8;

function validateUsername(username: string): string | null {
  if (!USERNAME_RE.test(username)) {
    return 'ユーザー名は3〜32文字の英数字・アンダースコア・ハイフンのみ使用できます';
  }
  return null;
}

function validatePassword(password: string): string | null {
  if (typeof password !== 'string' || password.length < MIN_PASSWORD_LEN) {
    return 'パスワードは8文字以上で入力してください';
  }
  return null;
}

export class AuthStore {
  private ctx: DurableObjectState;

  constructor(ctx: DurableObjectState) {
    this.ctx = ctx;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname !== '/rpc' || request.method !== 'POST') {
      return new Response('Not Found', { status: 404 });
    }

    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return Response.json({ ok: false, error: 'invalid_json' } satisfies RpcResult, { status: 400 });
    }

    const action = body.action;
    try {
      switch (action) {
        case 'createInvite':
          return Response.json(await this.createInvite());
        case 'listUsers':
          return Response.json(await this.listUsers());
        case 'deleteUser':
          return Response.json(await this.deleteUser(String(body.username ?? '')));
        case 'consumeInviteAndCreateUser':
          return Response.json(
            await this.consumeInviteAndCreateUser(
              String(body.token ?? ''),
              String(body.username ?? ''),
              String(body.password ?? ''),
            ),
          );
        case 'getUser':
          return Response.json(await this.getUser(String(body.username ?? '')));
        default:
          return Response.json({ ok: false, error: 'unknown_action' } satisfies RpcResult, { status: 400 });
      }
    } catch (e) {
      console.error('[authStore] rpc error:', e);
      return Response.json({ ok: false, error: 'internal_error' } satisfies RpcResult, { status: 500 });
    }
  }

  private async createInvite(): Promise<{ token: string; expiresAt: number }> {
    const token = randomToken();
    const now = Date.now();
    const invite: StoredInvite = { createdAt: now, expiresAt: now + INVITE_TTL_SEC * 1000, used: false };
    await this.ctx.storage.put(`invite:${token}`, invite);
    return { token, expiresAt: invite.expiresAt };
  }

  private async listUsers(): Promise<{ users: Array<{ username: string; role: string; createdAt: number }> }> {
    const stored = await this.ctx.storage.list<StoredUser>({ prefix: 'user:' });
    const users = Array.from(stored.values()).map((u) => ({
      username: u.username,
      role: u.role,
      createdAt: u.createdAt,
    }));
    return { users };
  }

  private async deleteUser(username: string): Promise<RpcResult> {
    if (!username) return { ok: false, error: 'username_required' };
    await this.ctx.storage.delete(`user:${username}`);
    return { ok: true };
  }

  private async getUser(username: string): Promise<StoredUser | null> {
    if (!username) return null;
    const user = await this.ctx.storage.get<StoredUser>(`user:${username}`);
    return user ?? null;
  }

  /**
   * 招待の検証・消込とユーザー作成を1つのメソッド内で完結させる。
   * Durable Object の入力ゲートにより ctx.storage を跨ぐ処理は自動的に直列化されるため、
   * 「招待の存在チェック」と「ユーザー保存」を別RPCに分割せずここでまとめて行うことで、
   * 同一招待トークンが並行リクエストで二重消費されることを防ぐ。
   */
  private async consumeInviteAndCreateUser(token: string, username: string, password: string): Promise<RpcResult> {
    if (!token) return { ok: false, error: '招待トークンが指定されていません' };

    const usernameError = validateUsername(username);
    if (usernameError) return { ok: false, error: usernameError };

    const passwordError = validatePassword(password);
    if (passwordError) return { ok: false, error: passwordError };

    const invite = await this.ctx.storage.get<StoredInvite>(`invite:${token}`);
    if (!invite) return { ok: false, error: '招待リンクが無効です' };
    if (invite.used) return { ok: false, error: 'この招待リンクは既に使用されています' };
    if (invite.expiresAt <= Date.now()) return { ok: false, error: '招待リンクの有効期限が切れています' };

    const existing = await this.ctx.storage.get<StoredUser>(`user:${username}`);
    if (existing) return { ok: false, error: 'このユーザー名は既に使用されています' };

    const passwordHash = await hashPassword(password);
    const user: StoredUser = { username, passwordHash, role: 'user', createdAt: Date.now() };

    // 招待の消込とユーザー作成をまとめて書き込む(このメソッド内でawaitを挟まないため他リクエストと競合しない)
    await this.ctx.storage.put({
      [`user:${username}`]: user,
      [`invite:${token}`]: { ...invite, used: true } satisfies StoredInvite,
    });

    return { ok: true };
  }
}
