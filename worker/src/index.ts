import { LocationRoom } from './room';

export { LocationRoom };

export interface Env {
  ASSETS: Fetcher;
  ROOM: DurableObjectNamespace;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/health') {
      return Response.json({ status: 'ok', timestamp: Date.now() });
    }

    if (url.pathname === '/ws') {
      const upgradeHeader = request.headers.get('Upgrade');
      if (!upgradeHeader || upgradeHeader.toLowerCase() !== 'websocket') {
        return new Response('Expected Upgrade: websocket', { status: 426 });
      }

      // 単一ルーム構成: 全員を同じ Durable Object インスタンスに集約する
      const roomId = env.ROOM.idFromName('global');
      const room = env.ROOM.get(roomId);
      return room.fetch(request);
    }

    // それ以外は静的アセット(client/dist)を返す
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
