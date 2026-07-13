// 認証まわりの共通ユーティリティ (WebCrypto のみを使用し、外部ライブラリに依存しない)

// セッション Cookie の有効期間 (30日)
export const SESSION_TTL_SEC = 60 * 60 * 24 * 30;
// 招待URLの有効期間 (7日)
export const INVITE_TTL_SEC = 60 * 60 * 24 * 7;

const textEncoder = new TextEncoder();

/**
 * タイミング攻撃を避けるための定数時間文字列比較。
 * 長さが異なる場合も同じだけ比較処理を行い、早期returnしない。
 */
export function timingSafeEqual(a: string, b: string): boolean {
  const aBytes = textEncoder.encode(a);
  const bBytes = textEncoder.encode(b);
  const len = Math.max(aBytes.length, bBytes.length);
  let diff = aBytes.length ^ bBytes.length;
  for (let i = 0; i < len; i++) {
    const av = i < aBytes.length ? aBytes[i] : 0;
    const bv = i < bBytes.length ? bBytes[i] : 0;
    diff |= av ^ bv;
  }
  return diff === 0;
}

function bufToBase64Url(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlToBuf(b64url: string): Uint8Array {
  const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (b64url.length % 4)) % 4);
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** ランダムトークンを生成し base64url で返す (招待URLやセッション用) */
export function randomToken(bytes = 32): string {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return bufToBase64Url(arr);
}

const PBKDF2_ITERATIONS = 100_000;
const PBKDF2_HASH_BYTES = 32;
const PBKDF2_SALT_BYTES = 16;

/** PBKDF2-SHA256 でパスワードをハッシュ化する。形式: pbkdf2$<iterations>$<saltB64>$<hashB64> */
export async function hashPassword(password: string): Promise<string> {
  const salt = new Uint8Array(PBKDF2_SALT_BYTES);
  crypto.getRandomValues(salt);
  const hash = await derivePbkdf2(password, salt, PBKDF2_ITERATIONS);
  return `pbkdf2$${PBKDF2_ITERATIONS}$${bufToBase64Url(salt)}$${bufToBase64Url(hash)}`;
}

/** 保存済みハッシュ文字列とパスワードを照合する */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  try {
    const parts = stored.split('$');
    if (parts.length !== 4 || parts[0] !== 'pbkdf2') return false;
    const iterations = Number(parts[1]);
    if (!Number.isFinite(iterations) || iterations <= 0) return false;
    const salt = base64UrlToBuf(parts[2]);
    const expectedHash = parts[3];
    const derived = await derivePbkdf2(password, salt, iterations);
    return timingSafeEqual(bufToBase64Url(derived), expectedHash);
  } catch {
    return false;
  }
}

async function derivePbkdf2(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const keyMaterial = await crypto.subtle.importKey('raw', textEncoder.encode(password), 'PBKDF2', false, [
    'deriveBits',
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    keyMaterial,
    PBKDF2_HASH_BYTES * 8,
  );
  return new Uint8Array(bits);
}

export interface SessionPayload {
  sub: string;
  role: 'admin' | 'user';
  exp: number; // ミリ秒
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', textEncoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
    'verify',
  ]);
}

/** セッションペイロードに HMAC-SHA256 署名を付与したトークンを発行する */
export async function signSession(payload: SessionPayload, secret: string): Promise<string> {
  const key = await hmacKey(secret);
  const body = bufToBase64Url(textEncoder.encode(JSON.stringify(payload)));
  const sig = await crypto.subtle.sign('HMAC', key, textEncoder.encode(body));
  return `${body}.${bufToBase64Url(sig)}`;
}

/** セッショントークンを検証し、有効なら sub/role を返す。無効・期限切れ・secret未設定は null */
export async function verifySession(
  token: string | null | undefined,
  secret: string | undefined,
): Promise<{ sub: string; role: 'admin' | 'user' } | null> {
  if (!secret || !token) return null;
  try {
    const dotIndex = token.indexOf('.');
    if (dotIndex < 0) return null;
    const body = token.slice(0, dotIndex);
    const sig = token.slice(dotIndex + 1);

    const key = await hmacKey(secret);
    const expectedSig = bufToBase64Url(await crypto.subtle.sign('HMAC', key, textEncoder.encode(body)));
    if (!timingSafeEqual(sig, expectedSig)) return null;

    const payload = JSON.parse(new TextDecoder().decode(base64UrlToBuf(body))) as SessionPayload;
    if (typeof payload.sub !== 'string' || (payload.role !== 'admin' && payload.role !== 'user')) return null;
    if (typeof payload.exp !== 'number' || payload.exp <= Date.now()) return null;

    return { sub: payload.sub, role: payload.role };
  } catch {
    return null;
  }
}

/** ログイン成功時に発行する Set-Cookie 値 */
export function sessionCookie(token: string, maxAgeSec: number): string {
  return `session=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${maxAgeSec}`;
}

/** ログアウト時に Cookie を破棄する Set-Cookie 値 */
export function clearCookie(): string {
  return `session=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`;
}

/** リクエストの Cookie ヘッダーから指定した名前の値を取り出す */
export function getCookie(request: Request, name: string): string | null {
  const header = request.headers.get('Cookie');
  if (!header) return null;
  const parts = header.split(';');
  for (const part of parts) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    const key = part.slice(0, eq).trim();
    if (key === name) return decodeURIComponent(part.slice(eq + 1).trim());
  }
  return null;
}
