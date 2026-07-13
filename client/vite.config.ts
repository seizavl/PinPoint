import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import basicSsl from '@vitejs/plugin-basic-ssl';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  // wrangler dev (Cloudflare Workers ローカル実行) の既定ポートに接続
  const PROXY_TARGET = env.VITE_PROXY_TARGET ?? 'http://localhost:8787';
  return {
    plugins: [
      react(),
      basicSsl(),
      VitePWA({
        registerType: 'autoUpdate',
        includeAssets: ['favicon.ico'],
        manifest: {
          name: 'PinPoint',
          short_name: 'PinPoint',
          description: '地震発生時の被災者位置共有システム',
          theme_color: '#1e40af',
          background_color: '#0f172a',
          display: 'standalone',
          orientation: 'portrait',
          icons: [
            { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
            { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
          ],
        },
      }),
    ],
    server: {
      host: true,
      https: true,
      proxy: {
        '/ws': {
          target: PROXY_TARGET,
          ws: true,
          changeOrigin: true,
        },
      },
    },
  };
});
