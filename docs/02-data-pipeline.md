# Задача 02 — Пайплайн даних: GTFS → route bundles

## Мета
Node-скрипт, який з `polish_trains.zip` (mkuran.pl, зведений GTFS усіх польських залізничних перевізників) генерує маленькі статичні JSON-бандли по рейсах. Клієнт ніколи не парсить GTFS — тільки готові бандли.

## Що працює після задачі
- `npm run pipeline` створює `public/data/index.json` + `public/data/routes/{tripId}.json` для відібраних рейсів.
- Апка замість `demo-route.json` рендерить один реальний бандл (поки хардкод tripId у коді) — реальна геометрія колії, реальні станції.

## Контекст і джерело
- URL: `https://mkuran.pl/gtfs/polish_trains.zip` (ліцензійні умови — на mkuran.pl; у footer апки додати атрибуцію «Rozkłady: mkuran.pl / PKP PLK»).
- Потрібні файли всередині zip: `trips.txt`, `routes.txt`, `stops.txt`, `stop_times.txt`, `shapes.txt`, `calendar.txt`/`calendar_dates.txt`, `agency.txt`.
- Ключова перевага: `shapes.txt` дає готову геометрію колії, а `stop_times.txt` може містити `shape_dist_traveled` — готову лінійну референцію. **Перевірити наявність цього поля на реальному файлі**; якщо нема — рахувати самим (див. 2.4).

## Кроки

### 2.1 Каркас пайплайна
```
scripts/pipeline/
  index.ts          # оркестрація: download → parse → build → write
  download.ts       # кеш zip у .cache/, скачувати лише якщо старіший за 24h
  gtfs.ts           # стрімовий парсинг CSV
  build-bundle.ts   # збирання RouteBundle
  config.ts         # список рейсів для MVP
```
- Запуск: `tsx scripts/pipeline/index.ts` (додати `tsx` у devDependencies), npm-скрипт `"pipeline": "tsx scripts/pipeline/index.ts"`.
- **`stop_times.txt` — сотні МБ у розпакованому вигляді.** Парсити стрімом (`csv-parse` + `unzipper` streams), тримати в пам'яті лише рядки для потрібних `trip_id` (спершу зібрати set потрібних trip_id, потім один прохід по stop_times з фільтром).

### 2.2 Відбір рейсів (config.ts)
MVP не намагається покрити всю Польщу. Конфіг:
```ts
export const TARGET = [
  { from: 'Wrocław Główny', to: 'Warszawa Centralna' },
  { from: 'Wrocław Główny', to: 'Kraków Główny' },
  { from: 'Wrocław Główny', to: 'Poznań Główny' },
];
export const SERVICE_DATE = 'auto'; // найближчий день з активним calendar
```
Алгоритм відбору: знайти stop_id за назвами (у GTFS станція може мати кілька stop_id — матчити по `stop_name`, нормалізувавши регістр/діакритику) → знайти trips, де обидві станції в stop_times у правильному порядку → відфільтрувати по активному service (calendar + calendar_dates) → взяти до ~10 рейсів на напрямок.

### 2.3 Побудова RouteBundle
Формат — як у `00-PLAN.md` §6. Деталі:
- **shape**: зібрати точки `shapes.txt` по `shape_id` (сортувати за `shape_pt_sequence`), спростити Douglas-Peucker (`@turf/simplify`, tolerance ≈ 0.0001 ≈ 10 м). Ціль: бандл < 150 КБ.
- **lengthKm**: `turf.length(shape)`.
- **stops[].km**: якщо є `shape_dist_traveled` — використати (звірити одиниці: метри чи км — по відношенню до lengthKm). Якщо нема:
### 2.4 Обчислення км станцій (fallback)
```ts
import nearestPointOnLine from '@turf/nearest-point-on-line';
const snapped = nearestPointOnLine(shape, stopPoint, { units: 'kilometers' });
const km = snapped.properties.location; // км від початку лінії
```
Валідація: км мають монотонно зростати по порядку stop_sequence. Якщо ні (петлі, дублікати геометрії) — лог warn і викинути рейс із вибірки (у MVP не боротися з патологіями).

### 2.5 speedProfile
Для кожної пари сусідніх зупинок:
```
kmh = (kmB - kmA) / ((depOrArrB - depA) в годинах)
```
- Часи в GTFS можуть бути `25:10:00` (після півночі) — парсити як секунди від опівночі без Date.
- Якщо стоянка has arr==dep або часи відсутні — інтерполювати з сусідніх сегментів.
- Кламп: 20 ≤ kmh ≤ 220 (сміттєві дані → clamp + warn).

### 2.6 index.json
```jsonc
{
  "generatedAt": "2026-08-02T10:00:00Z",
  "trips": [
    { "tripId": "...", "name": "IC 1234 Wrocław Gł. → Warszawa Centr.", "carrier": "IC",
      "dep": "14:35", "arr": "18:12", "fromStop": "Wrocław Główny", "toStop": "Warszawa Centralna",
      "lengthKm": 354.2, "file": "routes/IC_1234.json", "sizeKb": 92 }
  ]
}
```
- `tripId` санітизувати для імені файлу (`[^a-zA-Z0-9_-]` → `_`).
- `deadZones: []` поки що порожній (задача 05 розширить пайплайн).

### 2.7 Інтеграція в апку
- `src/core/types.ts`: інтерфейси `RouteBundle`, `TripIndexEntry` — **єдине джерело типів**, пайплайн імпортує їх звідси ж (спільний код гарантує сумісність).
- `Trip.tsx`: `fetch('/data/routes/<hardcoded>.json')` → передати shape/stops у Map. Видалити demo-route.json.

## Обмеження
- Пайплайн запускається вручну/у CI, не в браузері.
- Один service date; вибір дати поїздки — поза MVP (розклади потягів далекого прямування майже не змінюються день у день; чесно вказати в UI «розклад на типовий день»).

## Пастки
- Дублікати станцій з різними stop_id (перон/станція) — брати parent_station якщо є.
- `shapes.txt` може бути відсутній для окремих trips (регіональні перевізники) — такі рейси відкидати з warn.
- Пам'ять: не робити `readFileSync` на stop_times.

## Acceptance criteria
- [ ] `npm run pipeline` за < 3 хв генерує index.json + ≥ 10 бандлів, кожен < 150 КБ.
- [ ] Для бандла Wrocław→Warszawa: lengthKm ≈ 350±30, км станцій монотонні, швидкості в межах 40–200 км/год.
- [ ] Апка рендерить реальну геометрію (візуально збігається з залізницею на карті, а не пряма між містами).
- [ ] Повторний запуск пайплайна ідемпотентний і використовує кеш zip.
