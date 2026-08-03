/**
 * Дубль стану активної поїздки в `sessionStorage`.
 *
 * Навіщо, якщо є трекер: iOS у standalone вбиває PWA при перемиканні задач, і
 * повернення виглядає як холодний старт. Dexie каже, який рейс був обраний, але
 * не каже, що поїздка ЙШЛА. Ось цей запис і каже — щоб замість мовчазного
 * «нічого не відбувається» показати «продовжити поїздку?».
 *
 * Другий споживач — банер оновлення апки: під час трекінгу його не показуємо.
 */

const KEY = 'traincov.trip';

export interface TripSession {
  tripId: string;
  /** ms epoch — коли натиснули «Почати поїздку». */
  startedAt: number;
}

let cached: TripSession | null = null;
let read = false;
const listeners = new Set<() => void>();

function parse(raw: string | null): TripSession | null {
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== 'object' || value === null) return null;
    const { tripId, startedAt } = value as Partial<TripSession>;
    if (typeof tripId !== 'string' || typeof startedAt !== 'number') return null;
    return { tripId, startedAt };
  } catch {
    return null;
  }
}

/** Синхронний геттер: `useSyncExternalStore` вимагає стабільного знімка. */
export function getTripSession(): TripSession | null {
  if (!read) {
    read = true;
    try {
      cached = parse(sessionStorage.getItem(KEY));
    } catch {
      // Приватний режим / вимкнене сховище — просто працюємо без відновлення.
      cached = null;
    }
  }
  return cached;
}

export function setTripSession(session: TripSession | null): void {
  const current = getTripSession();
  if (current?.tripId === session?.tripId && current?.startedAt === session?.startedAt) return;
  cached = session;
  try {
    if (session) sessionStorage.setItem(KEY, JSON.stringify(session));
    else sessionStorage.removeItem(KEY);
  } catch {
    // Стан у пам'яті все одно оновлений — відновлення після kill просто не буде.
  }
  for (const listener of listeners) listener();
}

export function subscribeTripSession(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
