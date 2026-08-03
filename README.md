# TrainCov

PWA, що для обраного залізничного рейсу в Польщі показує, **де і коли зникне мобільний інтернет**.

План MVP — [docs/00-PLAN.md](docs/00-PLAN.md). Поточний стан: **задача 01** (каркас + карта з хардкод-маршрутом).

## Запуск

```bash
npm install
npm run dev            # http://localhost:5173  (і по LAN — host увімкнено)
npm run dev:https      # те саме, але HTTPS (self-signed) — для тестів на телефоні
npm run build          # tsc -b && vite build
npm run preview        # прод-збірка локально, :4173
npm run typecheck
npm run lint
```

## Тест на телефоні

`server.host` увімкнено, тому dev-сервер одразу слухає LAN — бери адресу з рядка `Network:`,
який Vite друкує при старті.

**HTTPS потрібен** для `navigator.geolocation` і Wake Lock API (задачі 04 і 07) — на iOS обидва
працюють лише в secure context. Обраний спосіб:

1. **Основний — `npm run dev:https`** (`@vitejs/plugin-basic-ssl`). Відкрити
   `https://<IP-мака>:5173`, у Safari прийняти самопідписаний сертифікат
   («Показати деталі» → «Відвідати цей сайт»).
2. **Запасний — тунель**, якщо Safari упреться в сертифікат або треба показати когось ззовні:
   ```bash
   cloudflared tunnel --url http://localhost:5173
   ```
   Тунель дає справжній HTTPS-домен, сертифікат приймати не треба.

## Структура

```
src/
  app/          роутинг (useState-таби, без react-router) + layout
  screens/      Home.tsx, Trip.tsx, Log.tsx
  components/   Map.tsx — єдине місце роботи з MapLibre
  core/         чиста логіка без React (linref/speed/eta/probe — задачі 04–08)
  data/         demo-route.json — тимчасовий хардкод, зникне в задачі 02
  styles/       global.css — тёмна тема, safe-area, 100dvh
```

## Нотатки

- Карта поки на растрових тайлах OSM. У задачі 07 → PMTiles; міняти треба лише
  `RASTER_OSM_STYLE` у [src/components/Map.tsx](src/components/Map.tsx).
- Service Worker / PWA свідомо **не** підключено до задачі 07 — у dev він лише заважає.
