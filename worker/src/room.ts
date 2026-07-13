import { ClientToServerMessage, LocationPayload, ServerToClientMessage } from './types';

// 古い位置情報を掃除する閾値(24時間)
const STALE_THRESHOLD_MS = 24 * 60 * 60 * 1000;

interface Env {
  ROOM: DurableObjectNamespace;
}

/**
 * 全ユーザーの位置情報を保持し、WebSocket でブロードキャストする単一ルーム。
 * Cloudflare の WebSocket Hibernation API を使い、非アクティブ時は DO をスリープさせてコストを抑える。
 * 位置データは ctx.storage (SQLite) に永続化するため、ハイバネーションからの復帰後も失われない。
 */
export class LocationRoom {
  private ctx: DurableObjectState;
  // storage からの読み込みを都度待たなくて済むようメモリにもキャッシュする
  private cache: Map<string, LocationPayload> | null = null;

  constructor(ctx: DurableObjectState, _env: Env) {
    this.ctx = ctx;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    // 全位置情報削除の内部エンドポイント。Worker の /api/admin/clear-locations
    // (admin認証済み) からのみ呼ばれ、公開ルーティングからは到達しない。
    if (url.pathname === '/__clear') {
      await this.clearAllLocations();
      return Response.json({ ok: true });
    }

    const upgradeHeader = request.headers.get('Upgrade');
    if (!upgradeHeader || upgradeHeader.toLowerCase() !== 'websocket') {
      return new Response('Expected Upgrade: websocket', { status: 426 });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair) as [WebSocket, WebSocket];

    // Hibernation API: acceptWebSocket で接続を受け付けると、
    // 以降のメッセージは webSocketMessage/webSocketClose ハンドラに配送される
    this.ctx.acceptWebSocket(server);

    const users = await this.loadLocations();
    this.send(server, { event: 'locations_update', payload: { users: Object.fromEntries(users) } });
    this.broadcastUserCount();

    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (typeof message !== 'string') return;

    let parsed: ClientToServerMessage;
    try {
      parsed = JSON.parse(message);
    } catch {
      console.warn('[room] invalid JSON message');
      return;
    }

    if (parsed.event !== 'send_location') return;

    const payload = parsed.payload;
    if (!payload?.userId || !payload?.type) {
      console.warn('[room] invalid payload received:', payload);
      return;
    }

    const locations = await this.loadLocations();
    locations.set(payload.userId, payload);
    const removedIds = this.removeStaleLocations(locations);
    await this.persistLocations(locations);
    // storage側からも古いキーを削除しないとハイバネーション復帰時に復活してしまう
    if (removedIds.length > 0) {
      await this.ctx.storage.delete(removedIds.map((id) => `loc:${id}`));
    }

    console.log(
      `[loc] ${payload.userId.slice(0, 8)} type=${payload.type} fix=${payload.diagnostics?.fixMode ?? 'unknown'} lat=${payload.lat} lng=${payload.lng}`,
    );

    const broadcast: ServerToClientMessage = {
      event: 'locations_update',
      payload: { users: Object.fromEntries(locations) },
    };
    this.broadcastAll(broadcast);
  }

  async webSocketClose(_ws: WebSocket): Promise<void> {
    this.broadcastUserCount();
  }

  async webSocketError(_ws: WebSocket, _error: unknown): Promise<void> {
    this.broadcastUserCount();
  }

  private async clearAllLocations(): Promise<void> {
    const stored = await this.ctx.storage.list<LocationPayload>({ prefix: 'loc:' });
    const keys = Array.from(stored.keys());
    if (keys.length > 0) {
      await this.ctx.storage.delete(keys);
    }
    this.cache = new Map();
    this.broadcastAll({ event: 'locations_update', payload: { users: {} } });
  }

  private removeStaleLocations(locations: Map<string, LocationPayload>): string[] {
    const now = Date.now();
    const removed: string[] = [];
    for (const [userId, loc] of locations) {
      if (now - loc.timestamp > STALE_THRESHOLD_MS) {
        locations.delete(userId);
        removed.push(userId);
      }
    }
    return removed;
  }

  private async loadLocations(): Promise<Map<string, LocationPayload>> {
    if (this.cache) return this.cache;
    const stored = await this.ctx.storage.list<LocationPayload>({ prefix: 'loc:' });
    const locations = new Map<string, LocationPayload>();
    for (const [key, value] of stored) {
      locations.set(key.slice('loc:'.length), value);
    }
    this.cache = locations;
    return locations;
  }

  private async persistLocations(locations: Map<string, LocationPayload>): Promise<void> {
    this.cache = locations;
    const entries: Record<string, LocationPayload> = {};
    for (const [userId, loc] of locations) {
      entries[`loc:${userId}`] = loc;
    }
    await this.ctx.storage.put(entries);
  }

  private broadcastUserCount(): void {
    const count = this.ctx.getWebSockets().length;
    this.broadcastAll({ event: 'user_count', payload: { count } });
  }

  private broadcastAll(message: ServerToClientMessage): void {
    const data = JSON.stringify(message);
    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.send(data);
      } catch (e) {
        console.warn('[room] failed to send to a socket:', e);
      }
    }
  }

  private send(ws: WebSocket, message: ServerToClientMessage): void {
    ws.send(JSON.stringify(message));
  }
}
