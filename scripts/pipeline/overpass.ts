/**
 * Мінімальний клієнт Overpass із файловим кешем.
 *
 * Overpass — безкоштовний спільний ресурс із жорсткими лімітами: повторний
 * прогін пайплайна не має слати жодного запиту (це вимога ТЗ), а перший —
 * має ходити повільно, з паузами й фолбеком на дзеркало.
 */
import { createHash } from 'node:crypto';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  CACHE_DIR,
  OVERPASS_BACKOFF_MS,
  OVERPASS_CACHE_SUBDIR,
  OVERPASS_CACHE_TTL_MS,
  OVERPASS_ENDPOINTS,
  OVERPASS_RETRIES,
  OVERPASS_SLEEP_MS,
} from './config.ts';

/** Елемент `out geom`: координати лежать прямо у way, окремий запит nodes не потрібен. */
export interface OverpassWay {
  type: 'way';
  id: number;
  geometry?: { lat: number; lon: number }[];
  tags?: Record<string, string>;
}

export interface OverpassResponse {
  elements: OverpassWay[];
}

/** Overpass-етикет: клієнт має представлятися. Анонімний fetch отримує 406. */
const USER_AGENT = 'traincov-pipeline/0.1 (offline GTFS route-bundle build)';

const log = (msg: string) => console.log(`[overpass] ${msg}`);
const warn = (msg: string) => console.warn(`[overpass] ⚠ ${msg}`);

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Скільки реальних (некешованих) запитів пішло за прогін — для фінального рядка логів. */
let networkCalls = 0;
export const overpassNetworkCalls = () => networkCalls;

let lastRequestAt = 0;

function cacheFile(query: string): string {
  const hash = createHash('sha1').update(query).digest('hex').slice(0, 16);
  return path.resolve(CACHE_DIR, OVERPASS_CACHE_SUBDIR, `${hash}.json`);
}

async function readCache(file: string): Promise<OverpassResponse | null> {
  try {
    const s = await stat(file);
    if (Date.now() - s.mtimeMs > OVERPASS_CACHE_TTL_MS) return null;
    return JSON.parse(await readFile(file, 'utf8')) as OverpassResponse;
  } catch {
    return null;
  }
}

async function post(endpoint: string, query: string): Promise<OverpassResponse> {
  const wait = OVERPASS_SLEEP_MS - (Date.now() - lastRequestAt);
  if (wait > 0) await sleep(wait);
  lastRequestAt = Date.now();
  networkCalls++;

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      // Без User-Agent overpass-api.de відповідає 406 Not Acceptable.
      'user-agent': USER_AGENT,
    },
    body: new URLSearchParams({ data: query }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
  const json = (await res.json()) as OverpassResponse;
  if (!Array.isArray(json.elements)) throw new Error('відповідь без elements');
  return json;
}

/**
 * Виконує Overpass QL із кешем. Кеш-ключ — сам текст запиту, тому зміна
 * запиту автоматично інвалідовує старі відповіді.
 *
 * `offline` — не ходити в мережу взагалі: промах кеша повертає `null`,
 * і пайплайн просто збирає бандл без OSM-зон.
 */
export async function overpassQuery(
  query: string,
  opts: { label: string; offline?: boolean },
): Promise<OverpassResponse | null> {
  const file = cacheFile(query);
  const cached = await readCache(file);
  if (cached) return cached;

  if (opts.offline) {
    warn(`${opts.label}: кеша немає, --no-osm → без OSM-зон`);
    return null;
  }

  let lastError: unknown = null;
  for (let attempt = 0; attempt < OVERPASS_RETRIES; attempt++) {
    const endpoint = OVERPASS_ENDPOINTS[attempt % OVERPASS_ENDPOINTS.length] as string;
    try {
      log(`${opts.label}: запит на ${new URL(endpoint).host}…`);
      const json = await post(endpoint, query);
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, JSON.stringify(json));
      log(`${opts.label}: ${json.elements.length} елементів → кеш`);
      return json;
    } catch (err) {
      lastError = err;
      // 429/504 лікуються тільки чеканням — далі йде інше дзеркало й довша пауза.
      const backoff = OVERPASS_BACKOFF_MS * 2 ** attempt;
      warn(
        `${opts.label}: ${(err as Error).message} ` +
          `(спроба ${attempt + 1}/${OVERPASS_RETRIES}, пауза ${backoff / 1000} c)`,
      );
      await sleep(backoff);
    }
  }

  warn(`${opts.label}: Overpass недоступний (${(lastError as Error)?.message}) → без OSM-зон`);
  return null;
}
