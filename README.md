# TrainCov

PWA, що для обраного залізничного рейсу в Польщі показує, **де і коли зникне мобільний інтернет**.

План MVP — [docs/00-PLAN.md](docs/00-PLAN.md). Поточний стан: **задача 03** (вибір рейсу й оператора;
бандли зберігаються в IndexedDB, вибір переживає перезапуск).

## Запуск

```bash
npm install
npm run pipeline       # GTFS → public/data/ (потрібен один раз перед dev)
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

## Дані маршрутів

`npm run pipeline` качає зведений GTFS усіх польських залізничних перевізників
(`https://mkuran.pl/gtfs/polish_trains.zip`, ~32 МБ) у `.cache/`, ріже його на
маленькі бандли і кладе у `public/data/`:

```
public/data/
  index.json               список рейсів для UI
  routes/{tripId}.json     RouteBundle: shape, stops[].km, speedProfile, deadZones
```

- Zip кешується на 24 год; `npm run pipeline -- --force-download` перекачує примусово.
- Клієнт **ніколи** не парсить GTFS — тільки готові бандли (кожен < 30 КБ).
- Які напрямки збирати — [scripts/pipeline/config.ts](scripts/pipeline/config.ts) (`TARGET`).
- Типи бандла — [src/core/types.ts](src/core/types.ts), спільні для пайплайна й апки.
- `public/data/` (~650 КБ) комітиться в git: тоді `npm install && npm run dev` працює одразу,
  а деплой на Cloudflare Pages не потребує Node-кроку. Кеш `.cache/` — навпаки, в `.gitignore`.

## Структура

```
scripts/pipeline/  офлайн-пайплайн GTFS → бандли (Node + tsx, у браузері не працює)
  download.ts        кеш zip у .cache/ з TTL 24 год
  gtfs.ts            стрімовий CSV із zip (stop_times 40 МБ, shapes 76 МБ)
  build-bundle.ts    RouteBundle: simplify, км станцій, speedProfile, валідація
  config.ts          TARGET-напрямки, дата розкладу, клампи
  index.ts           оркестрація
src/
  app/          таби (без react-router) + AppState: reducer, контекст, гідратація з Dexie
  screens/      Home.tsx (вибір рейсу), Trip.tsx (карта), Log.tsx
  components/   Map.tsx — єдине місце роботи з MapLibre; TripCard, OperatorPicker, Toast
  core/         types.ts, db.ts (Dexie), operators.ts, format.ts, trip-search.ts —
                чиста логіка без React (linref/speed/eta/probe — задачі 04–08)
  data/         trip-index.ts (index.json + кеш), route-bundle.ts, http.ts
  hooks/        useOnlineStatus — чесний банер «офлайн» на Home
  styles/       global.css — тёмна тема, safe-area, 100dvh
```

### Стан і збереження

- IndexedDB (Dexie, база `traincov`): `bundles` — завантажені маршрути, `settings` — `operator`
  і `lastTripId`. Обраний рейс і оператор відновлюються при старті.
- Повторний вибір раніше відкритого рейсу працює без мережі (бандл береться з Dexie).
- Очистити збережені пакети — екран **Логер** → «Очистити всі».

## Нотатки

- Карта поки на растрових тайлах OSM. У задачі 07 → PMTiles; міняти треба лише
  `RASTER_OSM_STYLE` у [src/components/Map.tsx](src/components/Map.tsx).
- Service Worker / PWA свідомо **не** підключено до задачі 07 — у dev він лише заважає.
- Бандл покриває **весь рейс**, а не відрізок між станціями з `TARGET`: `TARGET` — це
  лише фільтр відбору, тож км 0 = перша станція рейсу.
- Розклад — на один service date (див. `serviceDate` в `index.json`). Вибір дати поїздки поза MVP.
