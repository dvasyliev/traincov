import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import basicSsl from '@vitejs/plugin-basic-ssl';
import { VitePWA } from 'vite-plugin-pwa';

// HTTPS у dev потрібен для geolocation і Wake Lock на телефоні (задачі 04 і 07).
// Вмикається через `npm run dev:https` (HTTPS=true).
const useHttps = process.env.HTTPS === 'true';

export default defineConfig({
  plugins: [
    react(),
    ...(useHttps ? [basicSsl()] : []),
    VitePWA({
      // Не 'autoUpdate': оновлення посеред поїздки перезавантажило б апку саме
      // тоді, коли вона потрібна. Замість цього — банер, і тільки поза трекінгом
      // (див. src/app/useAppUpdate.ts).
      registerType: 'prompt',
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        // maplibre-gl один важить більше за дефолтний ліміт у 2 МіБ, а без нього
        // офлайн-карти немає взагалі.
        maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
        // Бандли маршрутів — джерело істини в Dexie (задача 03), тут вони лише
        // «другий пояс»: SW тримає app shell і те, що вже качали.
        runtimeCaching: [
          {
            urlPattern: /\/data\/index\.json$/,
            handler: 'StaleWhileRevalidate',
            options: { cacheName: 'trip-index' },
          },
          {
            urlPattern: /\/data\/routes\/.+\.json$/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'route-bundles',
              expiration: { maxEntries: 30 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
        // Без цього стара версія SW доживає до наступного відкриття апки —
        // а «Оновити» в банері має спрацьовувати одразу.
        cleanupOutdatedCaches: true,
      },
      manifest: {
        name: 'TrainCov — мертві зони в дорозі',
        short_name: 'TrainCov',
        description: 'Де і коли зникне мобільний інтернет у потязі',
        lang: 'uk',
        start_url: '.',
        scope: '.',
        display: 'standalone',
        orientation: 'portrait',
        theme_color: '#0b1120',
        background_color: '#0b1120',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: 'icons/icon-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      // SW у dev вимкнений свідомо: кеш поверх HMR — це години дебагу привидів.
      devOptions: { enabled: false },
    }),
  ],
  server: {
    host: true,
    port: 5173,
  },
  preview: {
    host: true,
    port: 4173,
  },
});
