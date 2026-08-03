/**
 * Прогноз часу: коли потяг буде в кожній точці попереду і, головне,
 * коли він в'їде в наступну мертву зону та коли з неї вийде.
 *
 * Чистий модуль без React і без DOM: усе, що потрібно, приходить в `EtaInput`.
 * Три режими, від найточнішого до найчеснішого:
 *   `gps`     — є км і жива швидкість: перші кілометри блендимо GPS із розкладом;
 *   `profile` — км є, швидкості немає (тунель): інтегруємо чистий `speedProfile`;
 *   `plan`    — км немає взагалі (GPS вимкнено): беремо планові часи з розкладу.
 */
import type { DeadZone, GtfsTime, RouteBundle, RouteStop } from './types';
import type { SpeedConfidence } from './speed';

/**
 * Горизонт бленду GPS→розклад. Миттєва швидкість добре прогнозує близьке
 * (потяг не встигне ні розігнатись, ні стати), розклад — далеке.
 */
export const BLEND_HORIZON_KM = 3;
/** Гістерезис на межах зон: без нього статус миготить від GPS-шуму. */
export const ZONE_HYSTERESIS_KM = 0.2;
/** Профіль без даних: чесний середняк кращий за ділення на нуль. */
export const DEFAULT_KMH = 80;
/** Повільніше цього «швидкість» — це вже майже зупинка, і прогноз пішов би в нескінченність. */
const MIN_GPS_KMH = 5;
/** На стільки шматків ріжемо зону бленду, щоб крива швидкості була гладкою. */
const BLEND_STEPS = 6;
/** Похибка порівняння км — 1 мм. */
const EPS_KM = 1e-6;
/** Станція ближче цього до поточного км — це та, на якій ми стоїмо. */
const STOP_SNAP_KM = 0.3;
const MS_PER_HOUR = 3_600_000;
const MS_PER_DAY = 86_400_000;

export type EtaSource = 'gps' | 'profile' | 'plan';
export type EtaPointKind = 'stop' | 'zone-in' | 'zone-out';

export interface EtaPoint {
  km: number;
  /** Прогнозований час прибуття, ms epoch. */
  eta: number;
  kind: EtaPointKind;
  /** `stop.id` або `zone.id` — щоб UI зіставив мітку з рядком стрічки. */
  refId: string;
  /** Плановий час із розкладу, ms epoch; `null`, якщо розклад не читається. */
  plan: number | null;
}

export interface EtaZone {
  zone: DeadZone;
  /** Коли в'їдемо. */
  etaIn: number;
  /** Коли вийдемо (сигнал повернеться). */
  etaOut: number;
}

export interface EtaResult {
  source: EtaSource;
  /** Км, від якого рахували (у режимі `plan` — розкладна позиція). */
  km: number;
  /** `now`, на який зроблено розрахунок: секундний тік просто віднімає його. */
  computedAt: number;
  /** ETA для кожної станції і кожної межі зони попереду, за зростанням км. */
  timeline: EtaPoint[];
  nextZone: EtaZone | null;
  /** Зона, у якій їдемо зараз, і прогноз виходу з неї. */
  inZone: { zone: DeadZone; etaOut: number } | null;
}

export interface EtaInput {
  /** Поточна позиція, км уздовж маршруту. */
  km: number;
  now: number;
  /** Згладжена швидкість із `speed.ts`. */
  speedKmh: number | null;
  confidence: SpeedConfidence;
  stopped: boolean;
  /** Відколи стоїмо, ms epoch — щоб планова стоянка спливала в реальному часі. */
  stoppedSince?: number | null;
  /** Зона, у якій нас вважали на попередньому кроці, — вхід для гістерезису. */
  prevZoneId?: string | null;
  bundle: RouteBundle;
}

/** `06:38:00` → секунди від опівночі; години ≥ 24 допустимі (рейс через північ). */
export function gtfsSeconds(time: GtfsTime | null): number | null {
  if (!time) return null;
  const [h, m, s] = time.split(':').map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  return h * 3600 + m * 60 + (Number.isFinite(s) ? s : 0);
}

/** Планова стоянка на станції, мс. */
export function plannedDwellMs(stop: RouteStop): number {
  const arr = gtfsSeconds(stop.arr);
  const dep = gtfsSeconds(stop.dep);
  if (arr === null || dep === null || dep <= arr) return 0;
  return (dep - arr) * 1000;
}

const clamp = (value: number, lo: number, hi: number) => Math.min(Math.max(value, lo), hi);

/* ------------------------------- розклад ---------------------------------- */

export interface SchedulePlan {
  /** Локальна північ дня, на який ліг рейс, ms epoch. */
  anchor: number;
  /** Плановий час прибуття/відправлення кожної зупинки, ms epoch. */
  stops: { arr: number | null; dep: number | null }[];
  /** Плановий час прибуття на станцію (для першої — відправлення). */
  arrivalAt(index: number): number | null;
  /** Плановий час у довільній точці маршруту — лінійно всередині перегону. */
  timeAtKm(km: number): number | null;
  /** Де потяг має бути за розкладом у момент `at`. */
  kmAt(at: number): number;
}

function localMidnight(serviceDate: string, dayShift: number): number | null {
  const parsed = /^(\d{4})-(\d{2})-(\d{2})$/.exec(serviceDate);
  if (!parsed) return null;
  // Через конструктор Date, а не додаванням доби в мілісекундах: інакше
  // перехід на літній час зсунув би весь розклад на годину.
  return new Date(Number(parsed[1]), Number(parsed[2]) - 1, Number(parsed[3]) + dayShift).getTime();
}

/**
 * Прив'язка планових часів до абсолютної шкали.
 *
 * Бандли згенеровані на одну дату розкладу, а їхати можна будь-коли, тож рейс
 * ставимо на найближчий календарний день, у якому він ще не завершився.
 */
export function createSchedulePlan(bundle: RouteBundle, now: number): SchedulePlan | null {
  if (bundle.stops.length < 2) return null;
  const base = localMidnight(bundle.serviceDate, 0);
  if (base === null) return null;

  const first = bundle.stops[0];
  const last = bundle.stops[bundle.stops.length - 1];
  const firstSec = gtfsSeconds(first.dep ?? first.arr);
  const lastSec = gtfsSeconds(last.arr ?? last.dep);
  if (firstSec === null || lastSec === null) return null;

  // День, у якому рейс уже відправився; якщо він на ньому й закінчився —
  // беремо наступний. Так вимкнений GPS дає розклад найближчого рейсу вперед,
  // а не порожню стрічку вже завершеної поїздки.
  let shift = Math.floor((now - (base + firstSec * 1000)) / MS_PER_DAY);
  let anchor = base;
  for (let attempt = 0; attempt < 3; attempt++) {
    anchor = (shift === 0 ? base : localMidnight(bundle.serviceDate, shift)) ?? base;
    if (anchor + lastSec * 1000 >= now) break;
    shift += 1;
  }

  const stops = bundle.stops.map((stop) => {
    const arr = gtfsSeconds(stop.arr);
    const dep = gtfsSeconds(stop.dep);
    return {
      arr: arr === null ? null : anchor + arr * 1000,
      dep: dep === null ? null : anchor + dep * 1000,
    };
  });

  const lastIndex = stops.length - 1;
  const arrivalAt = (i: number) => stops[i]?.arr ?? stops[i]?.dep ?? null;
  const departureAt = (i: number) => stops[i]?.dep ?? stops[i]?.arr ?? null;

  const timeAtKm = (km: number): number | null => {
    if (km <= bundle.stops[0].km + EPS_KM) return departureAt(0);
    if (km >= bundle.stops[lastIndex].km - EPS_KM) return arrivalAt(lastIndex);
    for (let i = 0; i < lastIndex; i++) {
      const a = bundle.stops[i];
      const b = bundle.stops[i + 1];
      if (km < a.km - EPS_KM || km > b.km + EPS_KM) continue;
      const t0 = departureAt(i);
      const t1 = arrivalAt(i + 1);
      if (t0 === null) return t1;
      if (t1 === null || t1 <= t0) return t0;
      const span = b.km - a.km;
      return span > EPS_KM ? t0 + ((t1 - t0) * (km - a.km)) / span : t0;
    }
    return arrivalAt(lastIndex);
  };

  const kmAt = (at: number): number => {
    const start = departureAt(0);
    const finish = arrivalAt(lastIndex);
    if (start === null || at <= start) return bundle.stops[0].km;
    if (finish !== null && at >= finish) return bundle.stops[lastIndex].km;
    for (let i = 0; i < lastIndex; i++) {
      const t0 = departureAt(i);
      const t1 = arrivalAt(i + 1);
      if (t0 === null || t1 === null) continue;
      // Ще не відправились із i-ї — стоїмо саме на ній.
      if (at < t0) return bundle.stops[i].km;
      if (at > t1) continue;
      const span = t1 - t0;
      const a = bundle.stops[i];
      const b = bundle.stops[i + 1];
      return span > 0 ? a.km + ((b.km - a.km) * (at - t0)) / span : b.km;
    }
    return bundle.stops[lastIndex].km;
  };

  return { anchor, stops, arrivalAt, timeAtKm, kmAt };
}

/* ------------------------------- швидкість -------------------------------- */

/** Швидкість перегону з розкладу. Немає покривного сегмента → найближчий, немає жодного → 80. */
export function profileKmh(bundle: RouteBundle, atKm: number): number {
  const profile = bundle.speedProfile;
  if (!profile.length) return DEFAULT_KMH;

  let best = profile[0];
  let bestGap = Infinity;
  for (const segment of profile) {
    if (atKm >= segment.fromKm - EPS_KM && atKm < segment.toKm + EPS_KM) {
      best = segment;
      bestGap = 0;
      break;
    }
    const gap = atKm < segment.fromKm ? segment.fromKm - atKm : atKm - segment.toKm;
    if (gap < bestGap) {
      best = segment;
      bestGap = gap;
    }
  }
  return Number.isFinite(best.kmh) && best.kmh > 0 ? best.kmh : DEFAULT_KMH;
}

/**
 * Бленд миттєвої швидкості з профільною. Вага GPS лінійно спадає 1→0
 * на перших `BLEND_HORIZON_KM` — далі прогноз повністю за розкладом.
 */
export function blendSpeedKmh(aheadKm: number, gpsKmh: number, profile: number): number {
  if (aheadKm >= BLEND_HORIZON_KM) return profile;
  const w = 1 - Math.max(0, aheadKm) / BLEND_HORIZON_KM;
  return w * gpsKmh + (1 - w) * profile;
}

/* ------------------------------ інтегрування ------------------------------ */

interface EtaNode {
  key: number;
  km: number;
  stops: RouteStop[];
  zoneIn: DeadZone[];
  zoneOut: DeadZone[];
}

const nodeKey = (km: number) => Math.round(km * 1e6);

/**
 * Точки інтересу попереду: станції, межі зон, межі сегментів `speedProfile`
 * (щоб усередині кожного відрізка швидкість була стала) і підрозбиття зони
 * бленду. Кінець маршруту — завжди.
 */
function buildNodes(bundle: RouteBundle, fromKm: number, blending: boolean): EtaNode[] {
  const nodes = new Map<number, EtaNode>();

  const at = (km: number): EtaNode | null => {
    const clamped = clamp(km, 0, bundle.lengthKm);
    if (clamped <= fromKm + EPS_KM) return null;
    const key = nodeKey(clamped);
    let node = nodes.get(key);
    if (!node) {
      node = { key, km: clamped, stops: [], zoneIn: [], zoneOut: [] };
      nodes.set(key, node);
    }
    return node;
  };

  for (const stop of bundle.stops) at(stop.km)?.stops.push(stop);
  for (const zone of bundle.deadZones) {
    at(zone.fromKm)?.zoneIn.push(zone);
    at(zone.toKm)?.zoneOut.push(zone);
  }
  for (const segment of bundle.speedProfile) {
    at(segment.fromKm);
    at(segment.toKm);
  }
  if (blending) {
    for (let i = 1; i <= BLEND_STEPS; i++) at(fromKm + (BLEND_HORIZON_KM * i) / BLEND_STEPS);
  }
  at(bundle.lengthKm);

  return [...nodes.values()].sort((a, b) => a.km - b.km);
}

/** Планова стоянка, яку ще треба відстояти тут і зараз. */
function remainingDwellMs(input: EtaInput, km: number): number {
  if (!input.stopped) return 0;
  const stop = input.bundle.stops.find((s) => Math.abs(s.km - km) <= STOP_SNAP_KM);
  if (!stop) return 0;
  const dwell = plannedDwellMs(stop);
  if (dwell <= 0) return 0;
  // Стоїмо довше плану — час далі тече в реальному часі, а не додається вдруге.
  const waited = input.stoppedSince == null ? 0 : Math.max(0, input.now - input.stoppedSince);
  return Math.max(0, dwell - waited);
}

/** Зона, у якій зараз перебуваємо. Вихід із неї вимагає зайвих 200 м — інакше статус миготить. */
function zoneAt(zones: DeadZone[], km: number, prevZoneId: string | null | undefined): DeadZone | null {
  for (const zone of zones) {
    const pad = prevZoneId === zone.id ? ZONE_HYSTERESIS_KM : 0;
    if (km >= zone.fromKm - pad && km <= zone.toKm + pad) return zone;
  }
  return null;
}

/**
 * Основний розрахунок: інтегрування часу по сегментах від поточного км до кінця маршруту.
 */
export function computeEta(input: EtaInput): EtaResult {
  const { bundle, now } = input;
  const km = clamp(input.km, 0, bundle.lengthKm);
  const plan = createSchedulePlan(bundle, now);

  const gpsKmh =
    input.confidence !== 'none' &&
    input.speedKmh !== null &&
    Number.isFinite(input.speedKmh) &&
    input.speedKmh >= MIN_GPS_KMH &&
    !input.stopped
      ? input.speedKmh
      : null;

  const nodes = buildNodes(bundle, km, gpsKmh !== null);
  const eta = new Map<number, number>();

  let t = now + remainingDwellMs(input, km);
  let cursor = km;

  for (const node of nodes) {
    const segKm = node.km - cursor;
    if (segKm > EPS_KM) {
      const mid = cursor + segKm / 2;
      const profile = profileKmh(bundle, mid);
      const kmh = gpsKmh === null ? profile : blendSpeedKmh(mid - km, gpsKmh, profile);
      t += (segKm / Math.max(kmh, 1)) * MS_PER_HOUR;
      cursor = node.km;
    }
    // ETA станції — це прибуття: стоянку додаємо вже після того, як мітку записано.
    eta.set(node.key, t);
    for (const stop of node.stops) t += plannedDwellMs(stop);
  }

  const timeline: EtaPoint[] = [];
  for (const node of nodes) {
    const at = eta.get(node.key) as number;
    for (const stop of node.stops) {
      timeline.push({
        km: node.km,
        eta: at,
        kind: 'stop',
        refId: stop.id,
        plan: plan?.timeAtKm(stop.km) ?? null,
      });
    }
    for (const zone of node.zoneIn) {
      timeline.push({ km: node.km, eta: at, kind: 'zone-in', refId: zone.id, plan: plan?.timeAtKm(zone.fromKm) ?? null });
    }
    for (const zone of node.zoneOut) {
      timeline.push({ km: node.km, eta: at, kind: 'zone-out', refId: zone.id, plan: plan?.timeAtKm(zone.toKm) ?? null });
    }
  }

  const current = zoneAt(bundle.deadZones, km, input.prevZoneId);
  const upcoming = bundle.deadZones.find((zone) => zone.fromKm > km + EPS_KM) ?? null;
  const etaAtKm = (target: number, fallback: number) =>
    eta.get(nodeKey(clamp(target, 0, bundle.lengthKm))) ?? fallback;

  return {
    source: gpsKmh === null ? 'profile' : 'gps',
    km,
    computedAt: now,
    timeline,
    nextZone: upcoming
      ? {
          zone: upcoming,
          etaIn: etaAtKm(upcoming.fromKm, now),
          etaOut: etaAtKm(upcoming.toKm, etaAtKm(upcoming.fromKm, now)),
        }
      : null,
    inZone: current ? { zone: current, etaOut: etaAtKm(current.toKm, now) } : null,
  };
}

/**
 * Розклад-only: GPS немає взагалі, тому позиція і всі мітки беруться з планових часів.
 * Це чесний мінімум — те саме, що видно в паперовому розкладі, але з мертвими зонами.
 */
export function computeScheduleEta(
  bundle: RouteBundle,
  now: number,
  prevZoneId?: string | null,
): EtaResult | null {
  const plan = createSchedulePlan(bundle, now);
  if (!plan) return null;

  const km = plan.kmAt(now);
  const timeline: EtaPoint[] = [];

  bundle.stops.forEach((stop, i) => {
    if (stop.km <= km + EPS_KM) return;
    const at = plan.arrivalAt(i);
    if (at !== null) timeline.push({ km: stop.km, eta: at, kind: 'stop', refId: stop.id, plan: at });
  });

  for (const zone of bundle.deadZones) {
    const enter = plan.timeAtKm(zone.fromKm);
    const exit = plan.timeAtKm(zone.toKm);
    if (zone.fromKm > km + EPS_KM && enter !== null) {
      timeline.push({ km: zone.fromKm, eta: enter, kind: 'zone-in', refId: zone.id, plan: enter });
    }
    if (zone.toKm > km + EPS_KM && exit !== null) {
      timeline.push({ km: zone.toKm, eta: exit, kind: 'zone-out', refId: zone.id, plan: exit });
    }
  }
  timeline.sort((a, b) => a.km - b.km);

  const current = zoneAt(bundle.deadZones, km, prevZoneId);
  const upcoming = bundle.deadZones.find((zone) => zone.fromKm > km + EPS_KM) ?? null;
  const timeAt = (target: number, fallback: number) => plan.timeAtKm(target) ?? fallback;

  return {
    source: 'plan',
    km,
    computedAt: now,
    timeline,
    nextZone: upcoming
      ? {
          zone: upcoming,
          etaIn: timeAt(upcoming.fromKm, now),
          etaOut: timeAt(upcoming.toKm, now),
        }
      : null,
    inZone: current ? { zone: current, etaOut: timeAt(current.toKm, now) } : null,
  };
}

export interface TripEtaInput {
  bundle: RouteBundle;
  now: number;
  /** `null` — позиції немає (трекінг вимкнено): переходимо в розклад-only. */
  km: number | null;
  speedKmh: number | null;
  confidence: SpeedConfidence;
  stopped: boolean;
  stoppedSince: number | null;
  prevZoneId: string | null;
}

/** Єдина точка входу для UI: сам обирає режим за наявністю даних. */
export function computeTripEta(input: TripEtaInput): EtaResult | null {
  if (input.km === null) return computeScheduleEta(input.bundle, input.now, input.prevZoneId);
  return computeEta({
    bundle: input.bundle,
    now: input.now,
    km: input.km,
    speedKmh: input.speedKmh,
    confidence: input.confidence,
    stopped: input.stopped,
    stoppedSince: input.stoppedSince,
    prevZoneId: input.prevZoneId,
  });
}
