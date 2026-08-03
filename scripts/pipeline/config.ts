/** Конфіг офлайн-пайплайна GTFS → route bundles. */

export interface TargetPair {
  from: string;
  to: string;
}

export const GTFS_URL = 'https://mkuran.pl/gtfs/polish_trains.zip';

/** Кеш zip; TTL — щоб повторний запуск не качав 32 МБ. */
export const CACHE_DIR = '.cache';
export const CACHE_FILE = 'polish_trains.zip';
export const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

export const OUT_DIR = 'public/data';
export const ROUTES_SUBDIR = 'routes';

/**
 * MVP не покриває всю Польщу. Обидва напрямки вказані явно —
 * у GTFS це різні trip_id, і кожен має власну геометрію.
 */
export const TARGET: TargetPair[] = [
  { from: 'Wrocław Główny', to: 'Warszawa Centralna' },
  { from: 'Warszawa Centralna', to: 'Wrocław Główny' },
  { from: 'Wrocław Główny', to: 'Kraków Główny' },
  { from: 'Kraków Główny', to: 'Wrocław Główny' },
  { from: 'Wrocław Główny', to: 'Poznań Główny' },
  { from: 'Poznań Główny', to: 'Wrocław Główny' },
];

/** `'auto'` — найближча дата з активним service; або явний `'YYYYMMDD'`. */
export const SERVICE_DATE: 'auto' | string = 'auto';

/** Скільки рейсів брати на кожну пару (беруться найраніші за відправленням). */
export const MAX_TRIPS_PER_PAIR = 6;

/** Douglas–Peucker, градуси. 0.0001° ≈ 10 м. */
export const SIMPLIFY_TOLERANCE = 0.0001;

/** Кламп швидкості на перегоні — захист від сміттєвих часів у розкладі. */
export const MIN_KMH = 20;
export const MAX_KMH = 220;

/** Ціль з ТЗ; перевищення — не помилка, а warn. */
export const BUNDLE_SIZE_WARN_KB = 150;

/** GTFS route_type для важкої залізниці. Відсікає ZKA (автобусні заміни). */
export const RAIL_ROUTE_TYPE = '2';

export const ATTRIBUTION = 'Rozkłady: mkuran.pl / PKP PLK · Tunele: OpenStreetMap';

// ---- задача 05: мертві зони ----

/** Дзеркала Overpass: перше — основне, далі — фолбек при 429/504. */
export const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];

export const OVERPASS_CACHE_SUBDIR = 'overpass';
/** Тунелі в OSM не рухаються — тримаємо відповіді довго. */
export const OVERPASS_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
/** Пауза між реальними (некешованими) запитами: Overpass не любить чергу впритул. */
export const OVERPASS_SLEEP_MS = 2000;
export const OVERPASS_TIMEOUT_S = 120;
/**
 * 429/504 означають «сервер зайнятий», і лікуються тільки чеканням. Беквоф
 * експоненційний (4, 8, 16, 32, 64 c), бо на голому кеші пайплайн робить
 * десятки запитів поспіль і без цього швидко впирається в ліміти.
 */
export const OVERPASS_RETRIES = 5;
export const OVERPASS_BACKOFF_MS = 4000;

/** Буфер навколо bbox маршруту, градуси (з ТЗ). */
export const ZONE_BBOX_PADDING_DEG = 0.02;
/**
 * Розмір плитки запиту, градуси. bbox цілого маршруту Poznań→Wien — це 10°×9°,
 * і Overpass на ньому стабільно віддає 504. Тому маршрут ріжеться на плитки
 * фіксованої глобальної сітки: кожна швидка, а сусідні маршрути й зустрічні
 * напрямки перевикористовують ті самі плитки з кеша.
 */
export const ZONE_TILE_DEG = 2;

/** Вершина way вважається «на нашій колії», якщо ближче за це. */
export const ZONE_MATCH_TOLERANCE_M = 50;
/** Частка вершин, що має пройти по толерансу, щоб way визнали нашим. */
export const ZONE_MATCH_MIN_RATIO = 0.8;
/** Сегменти ближче за це — один тунель, нарізаний на кілька ways. */
export const ZONE_MERGE_GAP_KM = 0.2;
/** Дрібні виїмки не варті уваги; тунелі лишаємо будь-якої довжини. */
export const ZONE_MIN_CUTTING_KM = 0.15;
/** Обрізок OSM-зони, що лишився після врізання manual-зони, коротший за це — геть. */
export const ZONE_MIN_REMNANT_KM = 0.05;
