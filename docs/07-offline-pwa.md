# Задача 07 — Офлайн: PWA, PMTiles, Wake Lock

## Мета
Апка повністю працює без мережі — бо саме без мережі вона й потрібна. Плюс екран не гасне в режимі поїздки.

## Що працює після задачі
- Airplane mode: апка відкривається, обраний рейс, стрічка, карта, GPS, countdown — усе живе.
- «Додати на головний екран» (installable), екран не гасне під час поїздки.

## Кроки

### 7.1 vite-plugin-pwa
```ts
VitePWA({
  registerType: 'autoUpdate',
  workbox: {
    globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
    runtimeCaching: [
      { urlPattern: /\/data\/index\.json$/, handler: 'StaleWhileRevalidate' },
      { urlPattern: /\/data\/routes\/.+\.json$/, handler: 'CacheFirst',
        options: { cacheName: 'route-bundles', expiration: { maxEntries: 30 } } },
      { urlPattern: /\.pmtiles/, handler: 'CacheFirst' } // range-запити — див. 7.2!
    ]
  },
  manifest: {
    name: 'TrainCov', short_name: 'TrainCov',
    display: 'standalone', theme_color: '#0b1120', background_color: '#0b1120',
    icons: [/* 192, 512, maskable */]
  }
})
```
- Бандли й так у Dexie (задача 03) — SW-кеш тут «другий пояс», а Dexie — джерело істини для даних. UI читає бандли ТІЛЬКИ з Dexie; SW відповідає за app shell і тайли.
- Дев: `devOptions: { enabled: false }` — SW у dev вимкнений (інакше божевілля з кешем).

### 7.2 Офлайн-карта: PMTiles
Проблема: растрові OSM-тайли з інтернету офлайн не працюють, а кешувати «всю Польщу» через SW нереально.
Рішення — векторні тайли одним файлом:
1. Взяти екстракт Польщі з Protomaps builds або зібрати самому (`pmtiles extract` по bbox Польщі, zoom ≤ 12 — для потяга більше не треба). Оцінка розміру: сотні МБ на всю Польщу з z12 — **тому інакше**: пайплайн ріже **коридорні** pmtiles на маршрут (bbox shape + буфер 15 км, z 6–12) → файл на маршрут ~5–20 МБ, лінк у bundle (`mapFile`).
2. Клієнт: `pmtiles` npm-пакет + `maplibregl.addProtocol('pmtiles', ...)`, стиль — Protomaps basemap light/dark theme.
3. Завантаження: при `selectTrip` після бандла тягнути `mapFile` як Blob → зберігати в Dexie (`mapFiles` table) → віддавати в PMTiles через `new PMTiles(new FileSource(blob))`. Так карта офлайн незалежно від SW і range-запитів (range через SW — болото, обхід через Blob надійніший).
4. Прогрес-бар завантаження пакета на Home: «Маршрут ✓ · Карта 12/18 МБ».
- Якщо коридорні pmtiles виявляться складними у пайплайні — fallback у MVP: без базової карти офлайн, тільки лінія маршруту на темному фоні (стрічка — головний UI, карта другорядна). Записати рішення після спайку на 2 год.

### 7.3 Wake Lock
`src/core/wakelock.ts`:
```ts
let sentinel: WakeLockSentinel | null = null;
export async function keepAwake(on: boolean) { ... }
```
- Вмикати при старті поїздки, вимикати при стопі.
- `visibilitychange` → re-acquire (система знімає лок при згортанні).
- Safari ≥ 16.4 підтримує; якщо API нема → банер «Вимкни автоблокування екрана в налаштуваннях на час поїздки».

### 7.4 Індикатор готовності до офлайн
- На картці рейсу і в Trip-хедері бейдж: `📦 офлайн-готовий` якщо в Dexie є bundle + mapFile (або bundle, якщо fallback без карти).
- Home при `navigator.onLine === false`: показувати лише збережені рейси.

### 7.5 Оновлення даних
- `index.json` — StaleWhileRevalidate: якщо `generatedAt` новіший за збережений бандл → бейдж «є оновлення розкладу» з кнопкою перекачати (просто re-fetch bundle). Без автомагії.

## Обмеження
- Фонова робота при погашеному екрані — ні (веб-обмеження, чесно комунікуємо).
- iOS: PWA в standalone втрачає стан при kill — стан поїздки (`tracking`, tripId) дублювати в `sessionStorage`, відновлювати «продовжити поїздку?».

## Пастки
- SW + Vite dev — не вмикати.
- `autoUpdate` під час поїздки може перезавантажити апку → задеплоєний до поїздки — перевірити: `registerType: 'prompt'` безпечніший; показувати prompt тільки поза режимом tracking.
- Перевірити iOS quota IndexedDB (map blob 20 МБ — ок, але ловити `QuotaExceededError`).

## Acceptance criteria
- [ ] Airplane mode end-to-end: вибраний раніше рейс відкривається, симулятор/GPS працює, зони й countdown на місці, карта рендериться (або fallback-режим).
- [ ] Lighthouse: installable PWA, no console errors offline.
- [ ] Екран не гасне 10+ хв у режимі поїздки (iPhone + Android).
- [ ] Оновлення апки не відбувається під час активної поїздки.
