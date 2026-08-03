import Dexie, { type Table } from 'dexie';
import type { RouteBundle } from './types';

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

  constructor() {
    super('traincov');
    this.version(1).stores({ bundles: 'tripId', settings: 'key' });
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
): Promise<void> {
  await db.bundles.put({
    tripId: bundle.tripId,
    savedAt: Date.now(),
    schemaVersion: BUNDLE_SCHEMA_VERSION,
    dataVersion,
    bundle,
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
  if (stale.length) await db.bundles.bulkDelete(stale);
  return stale.length;
}

export async function listStoredTripIds(): Promise<string[]> {
  return (await db.bundles.toCollection().primaryKeys()) as string[];
}

/** Кнопка «очистити збережені пакети» на екрані логера — потрібна для дебагу. */
export async function clearStoredBundles(): Promise<void> {
  await db.bundles.clear();
  await db.settings.delete('lastTripId');
}
