# Deployment

This project has two deploy targets:

- `server/`: Express + Socket.IO API, deploy to Railway.
- `client/`: Vite + React app, deploy to Vercel.

## 1. Deploy the server to Railway

1. Create a new Railway project from this GitHub repository.
2. Set the Railway root directory to `server`.
3. Add this environment variable:

```text
CLIENT_ORIGIN=https://your-vercel-app.vercel.app
```

At the first deploy, you may not know the Vercel URL yet. You can temporarily set:

```text
CLIENT_ORIGIN=*
```

After the client is deployed, replace `*` with the actual Vercel URL.

Railway should use:

- Build command: `npm run build`
- Start command: `npm run start`
- Health check path: `/health`

These are also defined in [server/railway.json](server/railway.json).

## 2. Deploy the client to Vercel

1. Create a new Vercel project from this GitHub repository.
2. Set the Vercel root directory to `client`.
3. Add this environment variable:

```text
VITE_SERVER_URL=https://your-railway-server.up.railway.app
```

Vercel should use:

- Framework preset: Vite
- Build command: `npm run build`
- Output directory: `dist`

These are also defined in [client/vercel.json](client/vercel.json).

## 3. Update Railway CORS

After Vercel deploys, copy the Vercel production URL and update Railway:

```text
CLIENT_ORIGIN=https://your-vercel-app.vercel.app
```

Then redeploy the Railway service.

## 4. Verify

Open these URLs:

- Client screen: `https://your-vercel-app.vercel.app/`
- Admin map: `https://your-vercel-app.vercel.app/admin`
- Camera screen: `https://your-vercel-app.vercel.app/camera`
- Server health: `https://your-railway-server.up.railway.app/health`

The server health endpoint should return JSON with `status: "ok"`.
