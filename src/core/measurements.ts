/**
 * Схема замірів якості зв'язку та все, що з ними роблять без React і без DOM.
 *
 * Це сировина для v2: з неї народяться справжні карти покриття по операторах.
 * Тому формат зафіксовано (`LOG_SCHEMA`) і саме він їде в експортований JSON —
 * майбутній бекенд прийматиме рівно його.
 *
 * Модуль чистий навмисно: probe (мережа), Dexie (сховище) і share (DOM) лежать
 * окремо, а тут — типи й функції, які можна перевірити тестом.
 */
import type { DeadZone, DeadZoneSeverity, RouteBundle } from './types';
import type { OperatorId } from './operators';

/** Версія формату експорту. Міняти лише при несумісній зміні полів. */
export const LOG_SCHEMA = 1;

export type ProbeQuality = 'good' | 'poor' | 'dead';

/** RTT від цього і вище — «є, але майже не працює». */
export const POOR_RTT_MS = 1500;

export const QUALITY_COLOR: Record<ProbeQuality, string> = {
  good: '#22c55e',
  poor: '#f59e0b',
  dead: '#ef4444',
};

export const QUALITY_LABEL: Record<ProbeQuality, string> = {
  good: 'є зв’язок',
  poor: 'слабкий',
  dead: 'немає',
};

/** Порядок «гірше — більше»: у бакеті стрічки виграє найгірший замір. */
const QUALITY_RANK: Record<ProbeQuality, number> = { good: 0, poor: 1, dead: 2 };

export function measurementQuality(probeOk: boolean, probeRttMs: number | null): ProbeQuality {
  if (!probeOk) return 'dead';
  return probeRttMs !== null && probeRttMs >= POOR_RTT_MS ? 'poor' : 'good';
}

/**
 * Один замір. `tripId` і `operator` дублюються в кожному рядку свідомо:
 * рядок має лишатися самоописовим, навіть якщо картку сесії загублено.
 */
export interface Measurement {
  /** Автоінкремент Dexie; у щойно зібраному замірі його ще немає. */
  id?: number;
  sessionId: string;
  ts: number;
  /** Сирі координати фікса (не спроєктовані на колію); `null` — GPS немає. */
  lat: number | null;
  lng: number | null;
  /** Точність фікса, м. */
  acc: number | null;
  routeKm: number | null;
  /**
   * Км не з GPS, а з dead reckoning (тунель). Такі рядки — найцінніші:
   * саме вони підтверджують діру, бо там і зв'язку, і супутників немає.
   */
  kmEstimated: boolean;
  tripId: string;
  operator: OperatorId | null;
  probeOk: boolean;
  probeRttMs: number | null;
  /** `navigator.connection.effectiveType` — тільки Chrome/Android. */
  effectiveType: string | null;
  /** Прогнозована зона, у якій зроблено замір; `null` — поза зонами. */
  inZoneId: string | null;
}

/** Прогнозована зона, «сфотографована» на старті поїздки. */
export interface LogSessionZone {
  id: string;
  fromKm: number;
  toKm: number;
  severity: DeadZoneSeverity;
}

/**
 * Одна поїздка = одна сесія. Зони копіюються в сесію навмисно: перегенерація
 * пайплайна не має заднім числом переписувати те, з чим порівнювали факт.
 */
export interface LogSession {
  /** `tripId#startedAt`. */
  id: string;
  tripId: string;
  tripName: string;
  carrier: string;
  operator: OperatorId | null;
  startedAt: number;
  /** `null` — поїздка ще триває (або апку вбили посеред неї). */
  endedAt: number | null;
  lengthKm: number;
  zones: LogSessionZone[];
  /** Поїздка з `?sim=1` — такі дані в manual-zones.json тягнути не можна. */
  simulated: boolean;
  count: number;
  deadCount: number;
  poorCount: number;
}

export function makeSessionId(tripId: string, startedAt: number): string {
  return `${tripId}#${startedAt}`;
}

export function toSessionZone(zone: DeadZone): LogSessionZone {
  return { id: zone.id, fromKm: zone.fromKm, toKm: zone.toKm, severity: zone.severity };
}

export function newLogSession(
  bundle: RouteBundle,
  operator: OperatorId | null,
  startedAt: number,
  simulated: boolean,
): LogSession {
  return {
    id: makeSessionId(bundle.tripId, startedAt),
    tripId: bundle.tripId,
    tripName: bundle.name,
    carrier: bundle.carrier,
    operator,
    startedAt,
    endedAt: null,
    lengthKm: bundle.lengthKm,
    zones: bundle.deadZones.map(toSessionZone),
    simulated,
    count: 0,
    deadCount: 0,
    poorCount: 0,
  };
}

/** Прогнозована зона, у якій зараз їдемо. Без гістерезису: тут потрібен факт, а не стабільна картинка. */
export function zoneIdAt(zones: LogSessionZone[], km: number | null): string | null {
  if (km === null) return null;
  for (const zone of zones) {
    if (km >= zone.fromKm && km <= zone.toKm) return zone.id;
  }
  return null;
}

/** Контекст поїздки — незмінний на всю сесію. */
export interface MeasurementContext {
  sessionId: string;
  tripId: string;
  operator: OperatorId | null;
  zones: LogSessionZone[];
}

/** Те, що дає трекер + probe на момент заміру. */
export interface MeasurementSample {
  ts: number;
  lat: number | null;
  lng: number | null;
  acc: number | null;
  km: number | null;
  kmEstimated: boolean;
  probeOk: boolean;
  probeRttMs: number | null;
  effectiveType: string | null;
}

export function buildMeasurement(ctx: MeasurementContext, sample: MeasurementSample): Measurement {
  return {
    sessionId: ctx.sessionId,
    ts: sample.ts,
    lat: sample.lat,
    lng: sample.lng,
    acc: sample.acc,
    routeKm: sample.km === null ? null : Number(sample.km.toFixed(3)),
    kmEstimated: sample.kmEstimated,
    tripId: ctx.tripId,
    operator: ctx.operator,
    probeOk: sample.probeOk,
    probeRttMs: sample.probeRttMs,
    effectiveType: sample.effectiveType,
    inZoneId: zoneIdAt(ctx.zones, sample.km),
  };
}

/** Частка мертвих замірів, 0…1. */
export function deadShare(session: Pick<LogSession, 'count' | 'deadCount'>): number {
  return session.count > 0 ? session.deadCount / session.count : 0;
}

/** Медіана RTT по вдалих замірах — одна чесна цифра замість середнього, яке ламає один викид. */
export function medianRtt(measurements: Measurement[]): number | null {
  const values = measurements
    .filter((m) => m.probeOk && m.probeRttMs !== null)
    .map((m) => m.probeRttMs as number)
    .sort((a, b) => a - b);
  if (!values.length) return null;
  const mid = values.length >> 1;
  return values.length % 2 ? values[mid] : Math.round((values[mid - 1] + values[mid]) / 2);
}

/* ------------------------------ міні-стрічка ------------------------------ */

export interface QualityBucket {
  index: number;
  fromKm: number;
  toKm: number;
  /** Найгірша якість у бакеті: одна поодинока діра важливіша за десять «добре». */
  quality: ProbeQuality;
  count: number;
}

/** Скільки бакетів по осі км за замовчуванням: більше просто не видно на телефоні. */
export const QUALITY_BUCKETS = 200;

/**
 * Заміри → бакети по км. Малювати 20 000 тиків не можна, а зменшувати вибірку
 * прорідженням — брехня: саме поодинокі мертві заміри й цікаві. Тому бакет
 * фіксованої ширини, а всередині перемагає найгірше.
 */
export function qualityBuckets(
  measurements: Measurement[],
  lengthKm: number,
  buckets = QUALITY_BUCKETS,
): QualityBucket[] {
  if (lengthKm <= 0 || buckets <= 0) return [];
  const width = lengthKm / buckets;
  const result = new Map<number, QualityBucket>();

  for (const m of measurements) {
    if (m.routeKm === null || !Number.isFinite(m.routeKm)) continue;
    const index = Math.min(buckets - 1, Math.max(0, Math.floor(m.routeKm / width)));
    const quality = measurementQuality(m.probeOk, m.probeRttMs);
    const bucket = result.get(index);
    if (!bucket) {
      result.set(index, {
        index,
        fromKm: index * width,
        toKm: (index + 1) * width,
        quality,
        count: 1,
      });
      continue;
    }
    bucket.count += 1;
    if (QUALITY_RANK[quality] > QUALITY_RANK[bucket.quality]) bucket.quality = quality;
  }

  return [...result.values()].sort((a, b) => a.index - b.index);
}

/* --------------------------------- експорт -------------------------------- */

export interface SessionExport {
  schema: number;
  /** Коли зроблено експорт, ms epoch. */
  exportedAt: number;
  session: LogSession;
  measurements: Measurement[];
}

/**
 * Тіло файлу. `id` рядків не їде: це ключ локальної IndexedDB, у чужій базі
 * він нічого не значить і лише спокушає вважати його стабільним.
 */
export function sessionExport(
  session: LogSession,
  measurements: Measurement[],
  exportedAt: number,
): SessionExport {
  return {
    schema: LOG_SCHEMA,
    exportedAt,
    session,
    measurements: measurements.map(({ id: _id, ...row }) => row),
  };
}

/** `traincov-2026-08-03-1435-PLK_IC_2026_102437507.json` */
export function exportFileName(session: LogSession): string {
  const d = new Date(session.startedAt);
  const pad = (n: number) => String(n).padStart(2, '0');
  const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
  const safeTrip = session.tripId.replace(/[^a-zA-Z0-9_-]/g, '_');
  return `traincov-${stamp}-${safeTrip}.json`;
}
