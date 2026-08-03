import Dexie, { type Table } from 'dexie';
import { entryFromBundle, type SavedTrip } from './offline';
import {
  makeSessionId,
  measurementQuality,
  newLogSession,
  type LogSession,
  type Measurement,
} from './measurements';
import type { OperatorId } from './operators';
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

export type SettingKey = 'operator' | 'lastTripId' | 'etaAlerts' | 'probeLogging';

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
  /** Заміри якості зв'язку (задача 08) — сировина для карт покриття у v2. */
  measurements!: Table<Measurement, number>;
  /** Картка поїздки: рейс, оператор, лічильники, «фото» прогнозованих зон. */
  logSessions!: Table<LogSession, string>;

  constructor() {
    super('traincov');
    this.version(1).stores({ bundles: 'tripId', settings: 'key' });
    this.version(2).stores({ bundles: 'tripId', settings: 'key', savedTrips: 'tripId' });
    this.version(3).stores({
      bundles: 'tripId',
      settings: 'key',
      savedTrips: 'tripId',
      measurements: '++id, sessionId, ts',
      logSessions: 'id, startedAt',
    });
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

/* ------------------------------- заміри (08) ------------------------------ */

/** Стеля ротації. ~10 c на замір → це приблизно 55 годин поїздок. */
export const MAX_MEASUREMENTS = 20_000;

/**
 * Пауза, після якої повернення на екран поїздки вважається новою сесією.
 *
 * Перехід на вкладку «Логер» знімає трекер (задача 04), тож без цього вікна
 * кожен погляд у логи різав би одну поїздку на кілька недосесій.
 */
export const SESSION_RESUME_MS = 15 * 60_000;

/**
 * Сесія для поточної поїздки: продовжуємо недавню по тому ж рейсу або відкриваємо нову.
 */
export async function openLogSession(
  bundle: RouteBundle,
  operator: OperatorId | null,
  simulated: boolean,
  now = Date.now(),
): Promise<LogSession> {
  const recent = await db.logSessions
    .where('startedAt')
    .above(now - 24 * 3_600_000)
    .filter((session) => session.tripId === bundle.tripId && session.simulated === simulated)
    .last();

  if (recent && now - (recent.endedAt ?? recent.startedAt) < SESSION_RESUME_MS) {
    // Оператор могли перемкнути між заходами — картка має відповідати останньому.
    const resumed: LogSession = { ...recent, operator, endedAt: null };
    await db.logSessions.put(resumed);
    return resumed;
  }

  // Колізія id можлива лише при двох стартах в одну мілісекунду — але тоді це
  // саме продовження, і мовчки злити сесії гірше, ніж зсунути мітку на 1 мс.
  let startedAt = now;
  while (await db.logSessions.get(makeSessionId(bundle.tripId, startedAt))) startedAt += 1;

  const session = newLogSession(bundle, operator, startedAt, simulated);
  await db.logSessions.put(session);
  return session;
}

export async function closeLogSession(sessionId: string, now = Date.now()): Promise<void> {
  const session = await db.logSessions.get(sessionId);
  if (!session) return;
  await db.logSessions.put({ ...session, endedAt: now });
}

/**
 * Сесії, які лишилися «активними»: iOS убив PWA посеред поїздки, і закрити їх
 * не встиг ніхто. Закриваємо часом останнього заміру — бейдж «активна» на
 * позавчорашній поїздці читається як баг.
 */
export async function closeStaleLogSessions(now = Date.now()): Promise<number> {
  const open = await db.logSessions.filter((session) => session.endedAt === null).toArray();
  let closed = 0;
  for (const session of open) {
    const last = await db.measurements.where('sessionId').equals(session.id).last();
    const endedAt = last?.ts ?? session.startedAt;
    if (now - endedAt < SESSION_RESUME_MS) continue;
    await db.logSessions.put({ ...session, endedAt });
    closed += 1;
  }
  return closed;
}

/**
 * Замір + лічильники сесії однією транзакцією: розбіжність між списком
 * («12 замірів») і стрічкою (60 тиків) виглядає як баг даних, а не як гонка.
 */
export async function appendMeasurement(measurement: Measurement): Promise<void> {
  await db.transaction('rw', db.measurements, db.logSessions, async () => {
    await db.measurements.add(measurement);
    const session = await db.logSessions.get(measurement.sessionId);
    if (!session) return;
    const quality = measurementQuality(measurement.probeOk, measurement.probeRttMs);
    await db.logSessions.put({
      ...session,
      count: session.count + 1,
      deadCount: session.deadCount + (quality === 'dead' ? 1 : 0),
      poorCount: session.poorCount + (quality === 'poor' ? 1 : 0),
    });
  });
}

/** Найновіші зверху — саме щойно завершена поїздка цікавить найбільше. */
export async function listLogSessions(): Promise<LogSession[]> {
  return (await db.logSessions.orderBy('startedAt').toArray()).reverse();
}

export async function listMeasurements(sessionId: string): Promise<Measurement[]> {
  const rows = await db.measurements.where('sessionId').equals(sessionId).toArray();
  return rows.sort((a, b) => a.ts - b.ts);
}

export async function deleteLogSession(sessionId: string): Promise<void> {
  await db.transaction('rw', db.measurements, db.logSessions, async () => {
    const ids = (await db.measurements
      .where('sessionId')
      .equals(sessionId)
      .primaryKeys()) as number[];
    await db.measurements.bulkDelete(ids);
    await db.logSessions.delete(sessionId);
  });
}

export async function clearMeasurements(): Promise<void> {
  await db.transaction('rw', db.measurements, db.logSessions, async () => {
    await db.measurements.clear();
    await db.logSessions.clear();
  });
}

/**
 * Ротація при старті: тримаємо останні `MAX_MEASUREMENTS` замірів.
 *
 * Ріжемо цілими сесіями, від найстаріших: напівз'їдена поїздка гірша за
 * відсутню — її стрічка показувала б діру там, де просто немає даних.
 * Найновішу сесію не чіпаємо ніколи, лише підрізаємо їй хвіст.
 */
export async function pruneMeasurements(): Promise<number> {
  const total = await db.measurements.count();
  if (total <= MAX_MEASUREMENTS) return 0;

  let excess = total - MAX_MEASUREMENTS;
  let removed = 0;

  const sessions = await db.logSessions.orderBy('startedAt').toArray();
  for (const session of sessions.slice(0, -1)) {
    if (excess <= 0) break;
    const ids = (await db.measurements
      .where('sessionId')
      .equals(session.id)
      .primaryKeys()) as number[];
    await db.measurements.bulkDelete(ids);
    await db.logSessions.delete(session.id);
    excess -= ids.length;
    removed += ids.length;
  }

  if (excess > 0) {
    const ids = (await db.measurements
      .orderBy('ts')
      .limit(excess)
      .primaryKeys()) as number[];
    await db.measurements.bulkDelete(ids);
    removed += ids.length;
  }

  // Рядки зникли — лічильники сесій треба перерахувати, інакше «% dead» бреше.
  const stale = await db.logSessions.toArray();
  for (const session of stale) {
    const rows = await db.measurements.where('sessionId').equals(session.id).toArray();
    if (rows.length === session.count) continue;
    await db.logSessions.put({
      ...session,
      count: rows.length,
      deadCount: rows.filter((r) => measurementQuality(r.probeOk, r.probeRttMs) === 'dead').length,
      poorCount: rows.filter((r) => measurementQuality(r.probeOk, r.probeRttMs) === 'poor').length,
    });
  }

  return removed;
}
