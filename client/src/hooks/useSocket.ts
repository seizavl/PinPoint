import { useEffect, useRef, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import { LocationPayload, BroadcastPayload } from '../types';

// 環境変数があればそれを使用、なければ同一オリジン（Vite の proxy 経由）
const SERVER_URL = import.meta.env.VITE_SERVER_URL ?? '';
console.log('[socket] connecting to:', SERVER_URL || '(same origin / proxy)');

export function useSocket() {
  const socketRef = useRef<Socket | null>(null);
  const [connected, setConnected] = useState(false);
  const [userCount, setUserCount] = useState(0);
  const [locations, setLocations] = useState<BroadcastPayload['users']>({});

  useEffect(() => {
    const socket = io(SERVER_URL, {
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
    });
    socketRef.current = socket;

    socket.on('connect', () => setConnected(true));
    socket.on('disconnect', () => setConnected(false));
    socket.on('user_count', ({ count }: { count: number }) => setUserCount(count));
    socket.on('locations_update', (data: BroadcastPayload) => setLocations(data.users));

    return () => {
      socket.disconnect();
    };
  }, []);

  function sendLocation(payload: LocationPayload): void {
    socketRef.current?.emit('send_location', payload);
  }

  return { connected, userCount, locations, sendLocation };
}
