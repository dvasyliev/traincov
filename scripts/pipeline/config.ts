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

export const ATTRIBUTION = 'Rozkłady: mkuran.pl / PKP PLK';
