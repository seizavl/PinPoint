import { useEffect, useRef, useState } from 'react';
import { LocationPayload, BroadcastPayload } from '../types';

// クライアント⇔サーバー間の WebSocket メッセージ形式 (worker/src/types.ts と同内容)
interface ServerToClientMessage {
  event: 'locations_update' | 'user_count';
  payload: BroadcastPayload | { count: number };
}

// 環境変数があればそのオリジンの /ws へ、なければ同一オリジン(Vite の proxy 経由)の /ws へ接続
const SERVER_URL = import.meta.env.VITE_SERVER_URL ?? '';

function resolveWsUrl(): string {
  if (SERVER_URL) {
    const origin = new URL(SERVER_URL);
    origin.protocol = origin.protocol === 'https:' ? 'wss:' : 'ws:';
    origin.pathname = '/ws';
    return origin.toString();
  }
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${window.location.host}/ws`;
}

const WS_URL = resolveWsUrl();
console.log('[socket] connecting to:', WS_URL);

// 再接続の指数バックオフ設定 (1s → 最大10s)
const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 10000;

export function useSocket() {
  const wsRef = useRef<WebSocket | null>(null);
  const [connected, setConnected] = useState(false);
  const [userCount, setUserCount] = useState(0);
  const [locations, setLocations] = useState<BroadcastPayload['users']>({});

  useEffect(() => {
    let stopped = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let reconnectDelay = RECONNECT_BASE_MS;

    function connect(): void {
      if (stopped) return;
      const ws = new WebSocket(WS_URL);
      wsRef.current = ws;

      ws.addEventListener('open', () => {
        setConnected(true);
        reconnectDelay = RECONNECT_BASE_MS; // 接続成功したらバックオフをリセット
      });

      ws.addEventListener('message', (event) => {
        try {
          const message: ServerToClientMessage = JSON.parse(event.data);
          if (message.event === 'user_count') {
            setUserCount((message.payload as { count: number }).count);
          } else if (message.event === 'locations_update') {
            setLocations((message.payload as BroadcastPayload).users);
          }
        } catch (e) {
          console.warn('[socket] failed to parse message:', e);
        }
      });

      ws.addEventListener('close', () => {
        setConnected(false);
        wsRef.current = null;
        if (stopped) return;
        reconnectTimer = setTimeout(connect, reconnectDelay);
        reconnectDelay = Math.min(reconnectDelay * 2, RECONNECT_MAX_MS);
      });

      ws.addEventListener('error', () => {
        ws.close();
      });
    }

    connect();

    return () => {
      stopped = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, []);

  function sendLocation(payload: LocationPayload): void {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ event: 'send_location', payload }));
  }

  return { connected, userCount, locations, sendLocation };
}
