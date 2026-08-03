/**
 * Інтеграційний прогон: симулятор → трекер → прогноз.
 * Перевіряє саме те, що записано в acceptance задачі 06 — лічильник сходиться
 * до нуля на в'їзді в зону, а в «GPS-дірі» dead reckoning веде маркер далі.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRouteLocator } from './linref';
import { createSimulatedGeoSource, simulatedGpsHole } from './simulator';
import { createTripTracker } from './trip-tracker';
import { computeTripEta, type EtaResult } from './eta';
import type { DeadZone, RouteBundle } from './types';

const START = new Date(2026, 7, 3, 6, 0, 0);
const ZONE_FROM_KM = 20;
const ZONE_TO_KM = 28;

/** Пряма «колія» по меридіану: крок ~0.002° ≈ 222 м, разом близько 70 км. */
function meridian(): GeoJSON.Feature<GeoJSON.LineString> {
  const coordinates: [number, number][] = [];
  for (let i = 0; i < 320; i++) coordinates.push([17, 51 + i * 0.002]);
  return { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates } };
}

function testBundle(): RouteBundle {
  const shape = meridian();
  const lengthKm = createRouteLocator(shape).lengthKm;
  const zone: DeadZone = {
    id: 'z1',
    fromKm: ZONE_FROM_KM,
    toKm: ZONE_TO_KM,
    lengthKm: ZONE_TO_KM - ZONE_FROM_KM,
    kind: 'tunnel',
    severity: 'none',
    source: 'osm',
    geometry: { type: 'LineString', coordinates: shape.geometry.coordinates.slice(0, 2) },
  };
  return {
    tripId: 'SIM',
    name: 'Sim',
    carrier: 'IC',
    carrierName: 'IC',
    trainNumber: null,
    serviceDate: '2026-08-03',
    shape,
    lengthKm,
    stops: [
      { id: 'a', name: 'A', km: 0, lat: 51, lng: 17, arr: null, dep: '06:00:00' },
      {
        id: 'b',
        name: 'B',
        km: lengthKm,
        lat: 51 + 319 * 0.002,
        lng: 17,
        arr: '06:35:00',
        dep: null,
      },
    ],
    speedProfile: [{ fromKm: 0, toKm: lengthKm, kmh: 120 }],
    deadZones: [zone],
  };
}

interface Sample {
  km: number;
  estimated: boolean;
  now: number;
  eta: EtaResult | null;
}

describe('симулятор + прогноз', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(START);
  });
  afterEach(() => vi.useRealTimers());

  it('лічильник сходиться до нуля на в’їзді в зону, у дірі працює dead reckoning', async () => {
    const bundle = testBundle();
    expect(simulatedGpsHole(bundle)).toEqual({ fromKm: ZONE_FROM_KM, toKm: ZONE_TO_KM });

    const source = createSimulatedGeoSource(bundle, { scale: 10, startKm: 15 });
    const tracker = createTripTracker(bundle, source);
    const samples: Sample[] = [];
    let prevZoneId: string | null = null;

    tracker.subscribe(() => {
      const s = tracker.getSnapshot();
      if (s.km === null) return;
      const now = tracker.now();
      const eta = computeTripEta({
        bundle,
        now,
        km: s.km,
        speedKmh: s.speedKmh,
        confidence: s.confidence,
        stopped: s.status === 'stopped',
        stoppedSince: s.stoppedSince,
        prevZoneId,
      });
      prevZoneId = eta?.inZone?.zone.id ?? null;
      samples.push({ km: s.km, estimated: s.kmEstimated, now, eta });
    });

    tracker.start();
    // 15 → 30 км при 120 км/год це 7.5 хв віртуальних, тобто 45 c реальних на ×10.
    await vi.advanceTimersByTimeAsync(90_000);
    tracker.stop();

    // 1. Останній справжній фікс перед дірою: лічильник має бути майже на нулі.
    const beforeZone = samples.filter((s) => !s.estimated && s.km < ZONE_FROM_KM);
    const last = beforeZone[beforeZone.length - 1];
    expect(last.km).toBeGreaterThan(ZONE_FROM_KM - 0.5);
    const countdown = (last.eta?.nextZone?.etaIn as number) - last.now;
    expect(countdown).toBeLessThan(15_000);
    expect(countdown).toBeGreaterThanOrEqual(0);

    // 2. Прогноз збігався: рання оцінка часу в'їзду близька до фактичної.
    const early = samples.find((s) => s.km < 16) as Sample;
    expect(Math.abs((early.eta?.nextZone?.etaIn as number) - last.now)).toBeLessThan(60_000);

    // 3. У дірі фіксів немає, але км іде далі — і ми бачимо себе всередині зони.
    const reckoned = samples.filter((s) => s.estimated);
    expect(reckoned.length).toBeGreaterThan(0);
    const inside = reckoned.find((s) => s.km > ZONE_FROM_KM) as Sample;
    expect(inside).toBeDefined();
    expect(inside.eta?.inZone?.zone.id).toBe('z1');
    // 4. Вихід із зони прогнозується — саме це користувач і читає в тунелі.
    expect(inside.eta?.inZone?.etaOut).toBeGreaterThan(inside.now);
  });
});
