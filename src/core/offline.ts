/**
 * Правила офлайн-режиму — чисті функції, щоб їх можна було перевірити тестом,
 * а не «вимкни вайфай і подивись».
 *
 * Головне рішення: офлайн Home показує ЛИШЕ збережені рейси. Список із
 * index.json тоді нічого не вартий — жоден із тих пакетів зараз не завантажити.
 */
import type { RouteBundle, TripIndex, TripIndexEntry } from './types';

/** Метадані збереженого пакета (легка табличка в Dexie, без самого бандла). */
export interface SavedTrip {
  tripId: string;
  entry: TripIndexEntry;
  /** `generatedAt` з index.json на момент збереження; `null` — качали офлайн-невідомо-коли. */
  dataVersion: string | null;
  savedAt: number;
}

/** Ім'я файлу бандла — той самий алгоритм, що й у пайплайні (`scripts/pipeline/index.ts`). */
export function bundleFileName(tripId: string): string {
  return `routes/${tripId.replace(/[^a-zA-Z0-9_-]/g, '_')}.json`;
}

/**
 * Картка рейсу з самого бандла — коли рядка index.json під рукою немає
 * (пакет збережений старою версією апки або index.json недоступний).
 */
export function entryFromBundle(bundle: RouteBundle): TripIndexEntry {
  const first = bundle.stops[0];
  const last = bundle.stops[bundle.stops.length - 1];
  return {
    tripId: bundle.tripId,
    name: bundle.name,
    carrier: bundle.carrier,
    dep: first?.dep ?? '00:00:00',
    arr: last?.arr ?? '00:00:00',
    fromStop: first?.name ?? '—',
    toStop: last?.name ?? '—',
    lengthKm: bundle.lengthKm,
    stopCount: bundle.stops.length,
    zonesCount: bundle.deadZones.length,
    file: bundleFileName(bundle.tripId),
    sizeKb: 0,
  };
}

/**
 * Розклад у пайплайні перегенерували після того, як пакет зберегли.
 * Не автомагія: рішення перекачати лишається за користувачем (задача 07, 7.5).
 */
export function hasScheduleUpdate(saved: SavedTrip | undefined, index: TripIndex | null): boolean {
  if (!saved || !index) return false;
  if (saved.dataVersion === null) return false;
  return saved.dataVersion !== index.generatedAt;
}

export interface TripListInput {
  index: TripIndex | null;
  saved: SavedTrip[];
  online: boolean;
}

/**
 * Що показувати на Home.
 * Онлайн — увесь індекс. Офлайн — тільки збережене, причому свіжіший опис
 * беремо з індексу (він міг долетіти з SW-кеша), а якщо його немає — зі збереженого.
 */
export function homeTrips({ index, saved, online }: TripListInput): TripIndexEntry[] {
  if (online && index) return index.trips;

  const byId = new Map(index?.trips.map((trip) => [trip.tripId, trip]));
  return [...saved]
    .sort((a, b) => b.savedAt - a.savedAt)
    .map((item) => byId.get(item.tripId) ?? item.entry);
}
