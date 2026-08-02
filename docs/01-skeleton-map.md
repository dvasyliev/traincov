# Задача 01 — Скелет проєкту + карта з маршрутом

## Мета
Робочий каркас PWA: Vite + React + TS, MapLibre-карта на весь екран, на ній хардкод-маршрут Wrocław Główny → Warszawa Centralna. Це фундамент, на який лягають усі наступні задачі.

## Що працює після задачі
- `npm run dev` відкриває застосунок; на телефоні через локальну мережу теж.
- Видно карту Польщі з лінією маршруту і маркерами двох станцій.
- Базовий роутинг: `/` (Home-заглушка), `/trip` (карта).

## Кроки

### 1.1 Ініціалізація
```bash
npm create vite@latest traincov -- --template react-ts
cd traincov
npm i maplibre-gl @turf/turf dexie
npm i -D @types/geojson
```
- `tsconfig`: `strict: true`.
- ESLint/Prettier — за замовчуванням Vite, без кастому (не витрачати час).
- Структура:
```
src/
  app/            # роутинг, layout
  screens/        # Home.tsx, Trip.tsx, Log.tsx (поки заглушки)
  core/           # чиста логіка без React (порожньо, буде далі)
  components/     # Map.tsx
  data/           # demo-route.json (тимчасовий хардкод)
  styles/
```

### 1.2 Роутинг
- Без react-router — вистачить власного стану `screen: 'home' | 'trip' | 'log'` у контексті або просто `useState` в `App.tsx` + нижній таб-бар з трьох кнопок. Менше залежностей, менше проблем із SW-кешем пізніше. (Якщо звичніше — `react-router-dom` теж ок, але це не потрібно для MVP.)

### 1.3 Хардкод-маршрут
- Створити `src/data/demo-route.json`: GeoJSON `Feature<LineString>` з ~30–50 точками вздовж лінії Wrocław→Warszawa (можна грубо накидати по містах: Wrocław, Oleśnica, Ostrów Wlkp., Łódź, Warszawa — точність зараз неважлива, у задачі 02 замінимо реальною геометрією).
- Тип:
```ts
export interface DemoRoute {
  name: string;
  shape: GeoJSON.Feature<GeoJSON.LineString>;
  stops: { name: string; lng: number; lat: number }[];
}
```

### 1.4 Компонент Map
- `components/Map.tsx`: обгортка над MapLibre.
  - Ініціалізація в `useEffect`, інстанс у `useRef`, обов'язковий `map.remove()` у cleanup.
  - Стиль: поки що безкоштовний растровий OSM
    ```ts
    style: {
      version: 8,
      sources: { osm: { type: 'raster', tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'], tileSize: 256, attribution: '© OpenStreetMap' } },
      layers: [{ id: 'osm', type: 'raster', source: 'osm' }]
    }
    ```
    (У задачі 07 замінимо на PMTiles; тому вся робота з картою — тільки через цей компонент, щоб заміна була в одному місці.)
  - Пропси: `route?: GeoJSON.Feature<LineString>`, `stops?: ...`. Після `map.on('load')` додати `addSource('route')` + `addLayer` (line, `line-width: 4`, колір `#e11d48`), маркери станцій — `maplibregl.Marker`.
  - `map.fitBounds(bbox(route), { padding: 40 })` через `@turf/bbox`.

### 1.5 Мобільний viewport
- `index.html`: `<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, user-scalable=no">`.
- CSS: `height: 100dvh` (не `vh` — інакше стрибки з адрес-баром Safari), `overscroll-behavior: none`, safe-area insets для таб-бару.
- Тёмна тема одразу: фон `#0b1120`, це майбутній стиль усього UI.

### 1.6 Тест на телефоні
- `npm run dev -- --host`, відкрити з iPhone по IP.
- **Пастка:** geolocation і Wake Lock далі вимагатимуть HTTPS. Одразу налаштувати `vite-plugin-basic-ssl` АБО тунель (`cloudflared tunnel --url http://localhost:5173`) — записати обраний спосіб у README, він потрібен у задачах 04 і 07.

## Обмеження задачі
- Жодних реальних даних, GPS, зон — тільки каркас.
- Не чіпати PWA/SW (задача 07): у dev SW лише заважає.

## Acceptance criteria
- [ ] Апка відкривається на десктопі та iPhone (через HTTPS/тунель).
- [ ] Лінія маршруту і станції видно, карта автоматично вміщує маршрут.
- [ ] Перемикання трьох екранів працює, Trip показує карту.
- [ ] `npm run build && npm run preview` — прод-збірка без помилок.
