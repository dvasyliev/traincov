import Dexie, { type Table } from 'dexie';
import { entryFromBundle, type SavedTrip } from './offline';
import type { RouteBundle, TripIndexEntry } from './types';

/**
 * Версія формату `RouteBundle`. Піднімати щоразу, коли пайплайн починає класти
 * в бандл нові поля: без цього збережена копія живе вічно й нові дані просто
 * не доїжджають до екрана (так задача 05 спершу показувала «зон не знайдено»
 * на рейсі, у якого зони вже були).
 */
export const BUNDLE_SCHEMA_VERSION = 2;

/**
 * Бандли лежать в IndexedDB від задачі 03, хоча офлайн-режим — це задача 07:
 * так офлайн дістанеться майже безкоштовно, а вибір рейсу вже зараз працює
 * без мережі для раніше відкритих рейсів.
 */
export interface StoredBundle {
  tripId: string;
  savedAt: number;
  /** Формат бандла на момент збереження. */
  schemaVersion: number;
  /** `generatedAt` з index.json — прогін пайплайна знецінює збережену копію. */
  dataVersion: string | null;
  bundle: RouteBundle;
}

export type SettingKey = 'operator' | 'lastTripId' | 'etaAlerts';

export interface Setting {
  key: SettingKey;
  value: unknown;
}

class TrainCovDB extends Dexie {
  bundles!: Table<StoredBundle, string>;
  settings!: Table<Setting, string>;
  /**
   * Легкі картки збережених рейсів. Окрема таблиця, бо офлайн-Home має
   * намалювати список, не піднімаючи в пам'ять десятки бандлів по сотні КБ.
   */
  savedTrips!: Table<SavedTrip, string>;

  constructor() {
    super('traincov');
    this.version(1).stores({ bundles: 'tripId', settings: 'key' });
    this.version(2).stores({ bundles: 'tripId', settings: 'key', savedTrips: 'tripId' });
  }
}

export const db = new TrainCovDB();

export async function getSetting(key: SettingKey): Promise<unknown> {
  return (await db.settings.get(key))?.value;
}

export async function setSetting(key: SettingKey, value: unknown): Promise<void> {
  await db.settings.put({ key, value });
}

/**
 * Збережений бандл, якщо він ще актуальний. Протухлий видаляється одразу —
 * дірка в кеші чесніша за старі дані, бо її видно й вона лікується перезавантаженням.
 *
 * `dataVersion` передається лише тоді, коли index.json уже в руках: офлайн, коли
 * звірити нема з чим, збережена копія лишається в силі — інакше в дорозі
 * застосунок втратив би єдиний доступний пакет.
 */
export async function getStoredBundle(
  tripId: string,
  dataVersion?: string | null,
): Promise<RouteBundle | undefined> {
  const entry = await db.bundles.get(tripId);
  if (!entry) return undefined;

  const stale =
    entry.schemaVersion !== BUNDLE_SCHEMA_VERSION ||
    (dataVersion != null && entry.dataVersion !== dataVersion);
  if (stale) {
    await db.bundles.delete(tripId).catch(() => {});
    return undefined;
  }
  return entry.bundle;
}

export async function storeBundle(
  bundle: RouteBundle,
  dataVersion: string | null,
  entry?: TripIndexEntry,
): Promise<void> {
  const savedAt = Date.now();
  await db.bundles.put({
    tripId: bundle.tripId,
    savedAt,
    schemaVersion: BUNDLE_SCHEMA_VERSION,
    dataVersion,
    bundle,
  });
  await db.savedTrips.put({
    tripId: bundle.tripId,
    entry: entry ?? entryFromBundle(bundle),
    dataVersion,
    savedAt,
  });
}

/**
 * Прибирає бандли старого формату при старті: інакше бейдж «збережено» обіцяє
 * офлайн-доступ до пакета, якого насправді вже немає.
 */
export async function pruneStoredBundles(): Promise<number> {
  const stale = await db.bundles
    .filter((entry) => entry.schemaVersion !== BUNDLE_SCHEMA_VERSION)
    .primaryKeys();
  if (stale.length) {
    await db.bundles.bulkDelete(stale);
    await db.savedTrips.bulkDelete(stale);
  }
  return stale.length;
}

/**
 * Картки збережених рейсів, найновіші зверху.
 *
 * Дорогою добудовує рядки для бандлів, збережених до появи цієї таблиці:
 * інакше після оновлення апки офлайн-список був би порожній рівно в тих,
 * хто вже підготувався до поїздки.
 */
export async function listSavedTrips(): Promise<SavedTrip[]> {
  const [rows, bundleIds] = await Promise.all([
    db.savedTrips.toArray(),
    db.bundles.toCollection().primaryKeys() as Promise<string[]>,
  ]);
  const ids = new Set(bundleIds);
  const known = new Set(rows.map((row) => row.tripId));

  for (const tripId of bundleIds) {
    if (known.has(tripId)) continue;
    const stored = await db.bundles.get(tripId);
    if (!stored) continue;
    const row: SavedTrip = {
      tripId,
      entry: entryFromBundle(stored.bundle),
      dataVersion: stored.dataVersion,
      savedAt: stored.savedAt,
    };
    rows.push(row);
    await db.savedTrips.put(row).catch(() => {});
  }

  // Рядок без бандла — обіцянка офлайну, якої нема чим виконати.
  return rows.filter((row) => ids.has(row.tripId)).sort((a, b) => b.savedAt - a.savedAt);
}

/** Кнопка «очистити збережені пакети» на екрані логера — потрібна для дебагу. */
export async function clearStoredBundles(): Promise<void> {
  await db.bundles.clear();
  await db.savedTrips.clear();
  await db.settings.delete('lastTripId');
}
