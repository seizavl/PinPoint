import { Server, Socket } from 'socket.io';
import { LocationPayload, BroadcastPayload } from './types';

const userLocations = new Map<string, LocationPayload>();

export function initSocket(io: Server): void {
  io.on('connection', (socket: Socket) => {
    console.log(`[+] connected: ${socket.id}`);

    broadcastUserCount(io);

    // 接続直後に現時点のスナップショットを本人にだけ送る
    const snapshot: BroadcastPayload = {
      users: Object.fromEntries(userLocations),
    };
    socket.emit('locations_update', snapshot);

    socket.on('send_location', (payload: LocationPayload) => {
      if (!payload?.userId || !payload?.type) {
        console.warn('invalid payload received:', payload);
        return;
      }
      userLocations.set(payload.userId, payload);
      console.log(
        `[loc] ${payload.userId.slice(0, 8)} type=${payload.type} fix=${payload.diagnostics?.fixMode ?? 'unknown'} lat=${payload.lat} lng=${payload.lng}`,
      );

      const broadcast: BroadcastPayload = {
        users: Object.fromEntries(userLocations),
      };
      io.emit('locations_update', broadcast);
    });

    socket.on('disconnect', () => {
      console.log(`[-] disconnected: ${socket.id}`);
      broadcastUserCount(io);
    });
  });
}

function broadcastUserCount(io: Server): void {
  io.emit('user_count', { count: io.engine.clientsCount });
}
