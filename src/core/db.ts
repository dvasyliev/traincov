import Dexie, { type Table } from 'dexie';
import type { RouteBundle } from './types';

/**
 * Бандли лежать в IndexedDB від задачі 03, хоча офлайн-режим — це задача 07:
 * так офлайн дістанеться майже безкоштовно, а вибір рейсу вже зараз працює
 * без мережі для раніше відкритих рейсів.
 */
export interface StoredBundle {
  tripId: string;
  savedAt: number;
  bundle: RouteBundle;
}

export type SettingKey = 'operator' | 'lastTripId';

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

export async function getStoredBundle(tripId: string): Promise<RouteBundle | undefined> {
  return (await db.bundles.get(tripId))?.bundle;
}

export async function storeBundle(bundle: RouteBundle): Promise<void> {
  await db.bundles.put({ tripId: bundle.tripId, savedAt: Date.now(), bundle });
}

export async function listStoredTripIds(): Promise<string[]> {
  return (await db.bundles.toCollection().primaryKeys()) as string[];
}

/** Кнопка «очистити збережені пакети» на екрані логера — потрібна для дебагу. */
export async function clearStoredBundles(): Promise<void> {
  await db.bundles.clear();
  await db.settings.delete('lastTripId');
}
