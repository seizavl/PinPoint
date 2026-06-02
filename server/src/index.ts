import 'dotenv/config';
import express from 'express';
import { createServer } from 'http';
import os from 'os';
import { Server } from 'socket.io';
import cors from 'cors';
import { initSocket } from './socket';

const PORT = process.env.PORT ?? 3001;
const CLIENT_ORIGIN_RAW = process.env.CLIENT_ORIGIN ?? '*';
const ALLOWED_ORIGINS =
  CLIENT_ORIGIN_RAW === '*' ? true : CLIENT_ORIGIN_RAW.split(',').map((o) => o.trim());

const app = express();
app.use(cors({ origin: ALLOWED_ORIGINS }));
app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: Date.now() });
});

const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: ALLOWED_ORIGINS,
    methods: ['GET', 'POST'],
  },
});

initSocket(io);

type LanAddress = {
  name: string;
  address: string;
};

function getLanAddresses(): LanAddress[] {
  const interfaces = os.networkInterfaces();
  const addresses: LanAddress[] = [];

  for (const [name, entries] of Object.entries(interfaces)) {
    for (const entry of entries ?? []) {
      if (entry.family !== 'IPv4' || entry.internal) continue;
      addresses.push({ name, address: entry.address });
    }
  }

  return addresses;
}

function printStartupInfo(port: string | number): void {
  const lanAddresses = getLanAddresses();

  console.log(`Server listening on 0.0.0.0:${port}`);
  console.log(`Allowing CORS from: ${CLIENT_ORIGIN_RAW}`);
  console.log('');
  console.log('Android app connection URL candidates:');

  if (lanAddresses.length === 0) {
    console.log('  No LAN IPv4 address found. Check Wi-Fi / Ethernet connection.');
  } else {
    for (const { name, address } of lanAddresses) {
      console.log(`  http://${address}:${port}  (${name})`);
    }
  }

  console.log('');
  console.log('Use one of these URLs in the Android app.');
  console.log('The Android device and this PC must be on the same Wi-Fi / LAN.');
  console.log('For Android Emulator, use http://10.0.2.2:3001');
  console.log('');
}

httpServer.listen(Number(PORT), '0.0.0.0', () => {
  printStartupInfo(PORT);
});
