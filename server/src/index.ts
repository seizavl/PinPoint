import 'dotenv/config';
import express from 'express';
import { createServer } from 'http';
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

httpServer.listen(Number(PORT), '0.0.0.0', () => {
  console.log(`Server listening on 0.0.0.0:${PORT}`);
  console.log(`Allowing CORS from: ${CLIENT_ORIGIN_RAW}`);
});
