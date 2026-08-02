# Задача 08 — Логер якості зв'язку (probe) та експорт

## Мета
Під час поїздки автоматично міряти фактичну якість інтернету активним зондуванням і писати заміри з прив'язкою до км маршруту. Це сировина, з якої в v2 народяться справжні карти покриття по операторах. У MVP — тільки збір і експорт, без бекенду.

## Що працює після задачі
- У режимі поїздки кожні ~10 c пишеться замір (RTT або фейл) з GPS/км/оператором.
- Екран Log: лічильник замірів, міні-стрічка «якість по маршруту» за поточну поїздку, кнопка «Експорт JSON» (share sheet).

## Кроки

### 8.1 core/probe.ts
```ts
export interface ProbeResult { ok: boolean; rttMs: number | null; ts: number; }
export async function probe(timeoutMs = 4000): Promise<ProbeResult>
```
- Реалізація: `fetch(url, { method: 'GET', cache: 'no-store', signal: AbortSignal.timeout(timeoutMs) })`, RTT = `performance.now()` дельта.
- **Ендпоінт:** потрібен маленький, швидкий, CORS-дружній, без rate-limit. Варіанти за пріоритетом:
  1. Власний: `https://probe.example.com/ping` — додати route в уже наявний Cloudflare Worker, що повертає `204` + `Access-Control-Allow-Origin: *`. Нульова вартість, повний контроль, і в v2 цей же Worker прийматиме заміри. **Рекомендований шлях.**
  2. Fallback: `https://www.gstatic.com/generate_204` (без CORS читання не треба — достатньо, що fetch resolved; але `no-cors` opaque не дає відрізнити 204 від помилки редіректу captive portal — тому свій ендпоінт кращий).
- Класифікація: `ok && rtt < 1500` → good; `ok && rtt ≥ 1500` → poor; `!ok` → dead.
- Анти-патерн, якого уникнути: не міряти bandwidth (важкі завантаження) — жере трафік і батарею; RTT+loss достатньо для «є/нема інтернету».

### 8.2 Планувальник
- У useTrip: `setInterval` 10 c, тільки коли tracking. Перед пробою — перевірити `document.visibilityState === 'visible'` (у фоні таймери все одно тротляться).
- Джиттер ±2 c, щоб не синхронізуватися з чужими періодичностями.
- Кожен замір збагачується поточним станом: `{ts, lat, lng, acc, routeKm, tripId, operator, probeOk, probeRttMs, effectiveType: navigator.connection?.effectiveType ?? null, inZoneId}`.
- GPS відсутній (тунель) → писати замір без координат, але з dead-reckoning km і прапором `kmEstimated: true` — це найцінніші рядки (підтверджують діру).

### 8.3 Зберігання
- Dexie v2 міграція: таблиця `measurements: '++id, tripSessionId, ts'`.
- `tripSessionId = tripId + startTs` — одна поїздка = одна сесія.
- Ротація: тримати останні ~20 000 замірів (delete старіших при старті).

### 8.4 Екран Log
- Список сесій (дата, рейс, к-сть замірів, % dead).
- Для активної/обраної сесії — горизонтальна міні-стрічка: вісь км, кольорові тики good/poor/dead. Це вже перша «фактична карта покриття» твоєї поїздки, і вона миттєво покаже розбіжності з deadZones з пайплайна.
- Порівняння поверх: сірі смуги = прогнозовані зони; кольорові тики = факт. Розбіжність = кандидат у manual-zones.json.

### 8.5 Експорт
```ts
const blob = new Blob([JSON.stringify({schema: 1, session, measurements}, null, 0)], {type: 'application/json'});
await navigator.share({ files: [new File([blob], `traincov-${sessionId}.json`, {type: 'application/json'})] });
```
- Fallback без Web Share: `URL.createObjectURL` + `<a download>`.
- Схему JSON зафіксувати (`schema: 1`) — v2-бекенд прийматиме саме її.

### 8.6 Ручний цикл покращення даних (задокументувати в README)
1. Проїхав маршрут → експортував JSON.
2. Скрипт `scripts/analyze-session.ts` (простий): групує dead-заміри в кластери по км → друкує готові сніпети для `manual-zones.json`.
3. Вставив у manual-zones → `npm run pipeline` → зони оновилися для всіх.
Це «краудсорсинг з одного користувача» — повний цикл продукту працює вже в MVP, просто вручну.

## Обмеження
- Немає автозаливки на сервер (v2). Немає мержу чужих файлів.
- Probe жере трохи трафіку (~0.3 МБ/год) і батареї — тумблер «збирати заміри» в налаштуваннях, за замовчуванням on.

## Пастки
- AbortSignal.timeout — Safari ≥ 16; для старіших — ручний AbortController + setTimeout.
- Не писати заміри при `offRoute` (сміття в даних).
- HTTP-кеш: обов'язково `cache: 'no-store'` + cache-buster `?t=` — інакше SW/браузер відповість з кешу і RTT буде брехнею.

## Acceptance criteria
- [ ] За 10 хв симуляції в Log ~60 замірів з коректними км.
- [ ] В airplane mode заміри пишуться як dead (probe фейлиться швидко, UI не підвисає).
- [ ] Експортований JSON відкривається, схема стабільна, share sheet працює на iPhone.
- [ ] analyze-session.ts з реального файлу друкує кластери dead-зон.
