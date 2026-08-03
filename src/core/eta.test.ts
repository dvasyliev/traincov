import { describe, expect, it } from 'vitest';
import {
  BLEND_HORIZON_KM,
  DEFAULT_KMH,
  ZONE_HYSTERESIS_KM,
  blendSpeedKmh,
  computeEta,
  computeScheduleEta,
  computeTripEta,
  createSchedulePlan,
  profileKmh,
} from './eta';
import { etaState, shouldAlert } from './eta-status';
import type { DeadZone, RouteBundle, RouteStop, SpeedSegment } from './types';

const MIN = 60_000;
const HOUR = 3_600_000;
const SERVICE_DATE = '2026-08-03';

/** Локальний час дня розкладу — тести не мають залежати від таймзони машини. */
const at = (h: number, m = 0, s = 0) => new Date(2026, 7, 3, h, m, s).getTime();

function stop(id: string, km: number, arr: string | null, dep: string | null): RouteStop {
  return { id, name: id, km, lat: 0, lng: 0, arr, dep };
}

function zone(id: string, fromKm: number, toKm: number, over: Partial<DeadZone> = {}): DeadZone {
  return {
    id,
    fromKm,
    toKm,
    lengthKm: toKm - fromKm,
    kind: 'tunnel',
    severity: 'none',
    source: 'osm',
    geometry: { type: 'LineString', coordinates: [[0, 0], [0, 1]] },
    ...over,
  };
}

function bundle(over: Partial<RouteBundle> = {}): RouteBundle {
  const stops = over.stops ?? [stop('a', 0, null, '06:00:00'), stop('b', 100, '07:00:00', null)];
  const lengthKm = over.lengthKm ?? stops[stops.length - 1].km;
  const profile: SpeedSegment[] = over.speedProfile ?? [{ fromKm: 0, toKm: lengthKm, kmh: 100 }];
  return {
    tripId: 'T',
    name: 'Test',
    carrier: 'IC',
    carrierName: 'IC',
    trainNumber: null,
    serviceDate: SERVICE_DATE,
    shape: {
      type: 'Feature',
      properties: {},
      geometry: { type: 'LineString', coordinates: [[0, 0], [0, 1]] },
    },
    lengthKm,
    stops,
    speedProfile: profile,
    deadZones: over.deadZones ?? [],
    ...over,
  };
}

const base = {
  now: at(6),
  speedKmh: null,
  confidence: 'none' as const,
  stopped: false,
};

const etaOfStop = (result: { timeline: { kind: string; refId: string; eta: number }[] }, id: string) =>
  result.timeline.find((p) => p.kind === 'stop' && p.refId === id)?.eta;

describe('computeEta — рівномірний рух', () => {
  it('без зупинок ETA = відстань / швидкість профілю', () => {
    const result = computeEta({ ...base, km: 0, bundle: bundle() });
    expect(etaOfStop(result, 'b')).toBe(at(6) + HOUR);
    expect(result.source).toBe('profile');
  });

  it('рахує від поточного км, а не від початку маршруту', () => {
    const result = computeEta({ ...base, km: 25, bundle: bundle() });
    expect(etaOfStop(result, 'b')).toBeCloseTo(at(6) + 0.75 * HOUR, -1);
  });

  it('станції позаду в таймлайн не потрапляють', () => {
    const b = bundle({
      stops: [stop('a', 0, null, '06:00:00'), stop('m', 50, '06:30:00', '06:30:00'), stop('b', 100, '07:00:00', null)],
      speedProfile: [
        { fromKm: 0, toKm: 50, kmh: 100 },
        { fromKm: 50, toKm: 100, kmh: 100 },
      ],
    });
    const result = computeEta({ ...base, km: 60, bundle: b });
    expect(result.timeline.map((p) => p.refId)).toEqual(['b']);
  });
});

describe('computeEta — стоянки', () => {
  const withDwell = bundle({
    stops: [
      stop('a', 0, null, '06:00:00'),
      stop('m', 50, '06:30:00', '06:35:00'),
      stop('b', 100, '07:05:00', null),
    ],
    speedProfile: [
      { fromKm: 0, toKm: 50, kmh: 100 },
      { fromKm: 50, toKm: 100, kmh: 100 },
    ],
  });

  it('планова стоянка попереду додається до ETA наступних точок', () => {
    const result = computeEta({ ...base, km: 0, bundle: withDwell });
    // Прибуття на проміжну — це ще без стоянки.
    expect(etaOfStop(result, 'm')).toBe(at(6) + 30 * MIN);
    expect(etaOfStop(result, 'b')).toBe(at(6) + 65 * MIN);
  });

  it('стоїмо на станції → додається лише залишок планової стоянки', () => {
    const now = at(6, 31);
    const result = computeEta({
      ...base,
      now,
      km: 50,
      stopped: true,
      stoppedSince: now - 2 * MIN,
      bundle: withDwell,
    });
    // З 5 хв стоянки 2 вже відстояли: лишається 3 + 30 хв ходу.
    expect(etaOfStop(result, 'b')).toBe(now + 3 * MIN + 30 * MIN);
  });

  it('стоїмо довше плану → час тече в реальному часі, стоянка не додається вдруге', () => {
    const now = at(6, 40);
    const result = computeEta({
      ...base,
      now,
      km: 50,
      stopped: true,
      stoppedSince: now - 9 * MIN,
      bundle: withDwell,
    });
    expect(etaOfStop(result, 'b')).toBe(now + 30 * MIN);
  });
});

describe('blendSpeedKmh', () => {
  it('на нулі — чистий GPS, за горизонтом — чистий профіль', () => {
    expect(blendSpeedKmh(0, 160, 100)).toBe(160);
    expect(blendSpeedKmh(BLEND_HORIZON_KM, 160, 100)).toBe(100);
    expect(blendSpeedKmh(BLEND_HORIZON_KM * 3, 160, 100)).toBe(100);
  });

  it('монотонний на всьому горизонті', () => {
    const values = Array.from({ length: 31 }, (_, i) => blendSpeedKmh((i / 10) * 1, 160, 100));
    for (let i = 1; i < values.length; i++) expect(values[i]).toBeLessThanOrEqual(values[i - 1]);

    const rising = Array.from({ length: 31 }, (_, i) => blendSpeedKmh(i / 10, 60, 100));
    for (let i = 1; i < rising.length; i++) expect(rising[i]).toBeGreaterThanOrEqual(rising[i - 1]);
  });

  it('швидший GPS пришвидшує тільки близькі точки', () => {
    const b = bundle();
    const slow = computeEta({ ...base, km: 0, bundle: b });
    const fast = computeEta({ ...base, km: 0, speedKmh: 200, confidence: 'gps', bundle: b });
    expect(fast.source).toBe('gps');
    // Виграш обмежений горизонтом бленду: 3 км, а не весь маршрут.
    const gain = (etaOfStop(slow, 'b') as number) - (etaOfStop(fast, 'b') as number);
    expect(gain).toBeGreaterThan(0);
    expect(gain).toBeLessThan((BLEND_HORIZON_KM / 100) * HOUR);
  });

  it('швидкість без довіри або без значення → чистий профіль', () => {
    const b = bundle();
    const expected = etaOfStop(computeEta({ ...base, km: 0, bundle: b }), 'b');
    expect(etaOfStop(computeEta({ ...base, km: 0, speedKmh: 200, confidence: 'none', bundle: b }), 'b')).toBe(expected);
    expect(etaOfStop(computeEta({ ...base, km: 0, speedKmh: null, confidence: 'gps', bundle: b }), 'b')).toBe(expected);
    // Стоїмо: нульова швидкість не має відправляти прогноз у нескінченність.
    expect(etaOfStop(computeEta({ ...base, km: 0, speedKmh: 0, confidence: 'gps', stopped: true, bundle: b }), 'b')).toBe(expected);
  });
});

describe('profileKmh', () => {
  it('порожній профіль → дефолт', () => {
    expect(profileKmh(bundle({ speedProfile: [] }), 10)).toBe(DEFAULT_KMH);
  });

  it('нульова або битa швидкість сегмента → дефолт', () => {
    expect(profileKmh(bundle({ speedProfile: [{ fromKm: 0, toKm: 100, kmh: 0 }] }), 10)).toBe(DEFAULT_KMH);
    expect(profileKmh(bundle({ speedProfile: [{ fromKm: 0, toKm: 100, kmh: NaN }] }), 10)).toBe(DEFAULT_KMH);
  });

  it('дірка в профілі → швидкість сусіднього сегмента', () => {
    const b = bundle({
      speedProfile: [
        { fromKm: 0, toKm: 30, kmh: 120 },
        { fromKm: 70, toKm: 100, kmh: 60 },
      ],
    });
    expect(profileKmh(b, 35)).toBe(120);
    expect(profileKmh(b, 65)).toBe(60);
    expect(profileKmh(b, 200)).toBe(60);
  });
});

describe('computeEta — мертві зони', () => {
  const b = bundle({ deadZones: [zone('z1', 40, 45), zone('z2', 80, 82)] });

  it('зона попереду: etaIn/etaOut за швидкістю профілю', () => {
    const result = computeEta({ ...base, km: 0, bundle: b });
    expect(result.inZone).toBeNull();
    expect(result.nextZone?.zone.id).toBe('z1');
    expect(result.nextZone?.etaIn).toBeCloseTo(at(6) + 24 * MIN, -1);
    expect(result.nextZone?.etaOut).toBeCloseTo(at(6) + 27 * MIN, -1);
  });

  it('всередині зони: inZone і прогноз виходу; nextZone — вже наступна', () => {
    const result = computeEta({ ...base, km: 42, bundle: b });
    expect(result.inZone?.zone.id).toBe('z1');
    expect(result.inZone?.etaOut).toBeCloseTo(at(6) + 1.8 * MIN, -1);
    expect(result.nextZone?.zone.id).toBe('z2');
  });

  it('зона позаду не рахується', () => {
    const result = computeEta({ ...base, km: 90, bundle: b });
    expect(result.inZone).toBeNull();
    expect(result.nextZone).toBeNull();
  });

  it('гістерезис: щойно вийшли — ще вважаємось у зоні', () => {
    const justOut = 45 + ZONE_HYSTERESIS_KM / 2;
    expect(computeEta({ ...base, km: justOut, prevZoneId: 'z1', bundle: b }).inZone?.zone.id).toBe('z1');
    expect(computeEta({ ...base, km: justOut, prevZoneId: null, bundle: b }).inZone).toBeNull();
    expect(computeEta({ ...base, km: 45 + ZONE_HYSTERESIS_KM * 2, prevZoneId: 'z1', bundle: b }).inZone).toBeNull();
  });

  it('зона починається рівно на станції: вхід = прибуття, вихід — після стоянки', () => {
    const withStopZone = bundle({
      stops: [
        stop('a', 0, null, '06:00:00'),
        stop('m', 50, '06:30:00', '06:35:00'),
        stop('b', 100, '07:05:00', null),
      ],
      speedProfile: [
        { fromKm: 0, toKm: 50, kmh: 100 },
        { fromKm: 50, toKm: 100, kmh: 100 },
      ],
      deadZones: [zone('zs', 50, 52)],
    });
    const result = computeEta({ ...base, km: 0, bundle: withStopZone });
    expect(result.nextZone?.etaIn).toBe(at(6) + 30 * MIN);
    expect(result.nextZone?.etaOut).toBeCloseTo(at(6) + 36.2 * MIN, -1);
  });

  it('лічильник сходиться до нуля на межі зони', () => {
    const now = at(6);
    const nearly = computeEta({ ...base, now, km: 39.999, bundle: b });
    expect((nearly.nextZone as { etaIn: number }).etaIn - now).toBeLessThan(15_000);
  });
});

describe('розклад-only', () => {
  const b = bundle({
    stops: [
      stop('a', 0, null, '06:00:00'),
      stop('m', 50, '06:30:00', '06:35:00'),
      stop('b', 100, '07:05:00', null),
    ],
    speedProfile: [
      { fromKm: 0, toKm: 50, kmh: 100 },
      { fromKm: 50, toKm: 100, kmh: 100 },
    ],
    deadZones: [zone('z1', 75, 80)],
  });

  it('позиція за розкладом інтерполюється всередині перегону', () => {
    const plan = createSchedulePlan(b, at(6, 15));
    expect(plan?.kmAt(at(6, 15))).toBeCloseTo(25, 6);
    expect(plan?.kmAt(at(6, 32))).toBeCloseTo(50, 6); // стоянка
    expect(plan?.kmAt(at(5))).toBe(0);
    expect(plan?.kmAt(at(9))).toBe(100);
  });

  it('мітки беруться з планових часів, а не з інтегрування', () => {
    const result = computeScheduleEta(b, at(6, 15));
    expect(result?.source).toBe('plan');
    expect(etaOfStop(result as never, 'm')).toBe(at(6, 30));
    expect(etaOfStop(result as never, 'b')).toBe(at(7, 5));
    expect(result?.nextZone?.etaIn).toBe(at(6, 50));
    expect(result?.nextZone?.etaOut).toBe(at(6, 53));
  });

  it('computeTripEta без км падає в розклад-only', () => {
    const result = computeTripEta({
      bundle: b,
      now: at(6, 15),
      km: null,
      speedKmh: null,
      confidence: 'none',
      stopped: false,
      stoppedSince: null,
      prevZoneId: null,
    });
    expect(result?.source).toBe('plan');
    expect(result?.km).toBeCloseTo(25, 6);
  });

  it('рейс дня вже завершився → розклад беремо на наступний день', () => {
    const plan = createSchedulePlan(b, at(20));
    expect(plan?.anchor).toBe(new Date(2026, 7, 4).getTime());
    expect(plan?.kmAt(at(20))).toBe(0);
    // Стрічка не порожня: попереду весь маршрут завтрашнього рейсу.
    expect(computeScheduleEta(b, at(20))?.timeline.length).toBeGreaterThan(0);
  });

  it('рейс через північ: години ≥ 24 не ламають шкалу', () => {
    const night = bundle({
      stops: [stop('a', 0, null, '23:30:00'), stop('b', 100, '25:00:00', null)],
      speedProfile: [{ fromKm: 0, toKm: 100, kmh: 66.7 }],
    });
    const plan = createSchedulePlan(night, at(23, 45));
    expect(plan?.kmAt(at(23, 45))).toBeCloseTo(100 / 6, 4);
    expect(plan?.timeAtKm(100)).toBe(new Date(2026, 7, 4, 1, 0, 0).getTime());
  });
});

describe('etaState', () => {
  const b = bundle({ deadZones: [zone('z1', 40, 45)] });

  it('далека діра → zone-far з хвилинами', () => {
    const now = at(6);
    const state = etaState(computeEta({ ...base, now, km: 0, bundle: b }), now);
    expect(state.kind).toBe('zone-far');
    expect(Math.round((state.countdownMs as number) / MIN)).toBe(24);
    expect(Math.round((state.durationMs as number) / MIN)).toBe(3);
    expect(state.scheduled).toBe(true);
  });

  it('ближче 10 хв → zone-soon', () => {
    const now = at(6);
    const state = etaState(computeEta({ ...base, now, km: 35, bundle: b }), now);
    expect(state.kind).toBe('zone-soon');
  });

  it('у зоні → рахуємо до сигналу', () => {
    const now = at(6);
    const state = etaState(computeEta({ ...base, now, km: 42, bundle: b }), now);
    expect(state.kind).toBe('in-zone');
    expect(state.zone?.id).toBe('z1');
    expect(state.durationMs).toBeNull();
  });

  it('дір попереду немає', () => {
    const now = at(6);
    expect(etaState(computeEta({ ...base, now, km: 90, bundle: b }), now).kind).toBe('no-zones');
    expect(etaState(null, now).kind).toBe('idle');
  });

  it('жива швидкість знімає позначку «за розкладом»', () => {
    const now = at(6);
    const state = etaState(computeEta({ ...base, now, km: 0, speedKmh: 100, confidence: 'gps', bundle: b }), now);
    expect(state.scheduled).toBe(false);
  });

  it('shouldAlert спрацьовує раз на зону і лише за 2 хв', () => {
    const now = at(6);
    const far = etaState(computeEta({ ...base, now, km: 35, bundle: b }), now);
    expect(shouldAlert(far, null)).toBe(false);
    const near = etaState(computeEta({ ...base, now, km: 37, bundle: b }), now);
    expect(shouldAlert(near, null)).toBe(true);
    expect(shouldAlert(near, 'z1')).toBe(false);
  });
});
