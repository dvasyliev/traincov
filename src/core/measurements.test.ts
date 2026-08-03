import { describe, expect, it } from 'vitest';
import {
  buildMeasurement,
  deadShare,
  exportFileName,
  makeSessionId,
  measurementQuality,
  medianRtt,
  newLogSession,
  qualityBuckets,
  sessionExport,
  zoneIdAt,
  type LogSessionZone,
  type Measurement,
  type MeasurementContext,
} from './measurements';
import type { RouteBundle } from './types';

const ZONES: LogSessionZone[] = [
  { id: 'dz-01', fromKm: 10, toKm: 12, severity: 'none' },
  { id: 'dz-02', fromKm: 30, toKm: 30.4, severity: 'weak' },
];

const CTX: MeasurementContext = {
  sessionId: 'trip#1',
  tripId: 'trip',
  operator: 'play',
  zones: ZONES,
};

function row(over: Partial<Measurement> = {}): Measurement {
  return {
    sessionId: 'trip#1',
    ts: 0,
    lat: null,
    lng: null,
    acc: null,
    routeKm: 0,
    kmEstimated: false,
    tripId: 'trip',
    operator: 'play',
    probeOk: true,
    probeRttMs: 100,
    effectiveType: null,
    inZoneId: null,
    ...over,
  };
}

describe('measurementQuality', () => {
  it('фейл — dead, повільно — poor, решта — good', () => {
    expect(measurementQuality(false, null)).toBe('dead');
    expect(measurementQuality(true, 1499)).toBe('good');
    expect(measurementQuality(true, 1500)).toBe('poor');
    // ok без RTT (нема performance) все одно означає «зв'язок є».
    expect(measurementQuality(true, null)).toBe('good');
  });
});

describe('zoneIdAt', () => {
  it('знаходить зону за км і мовчить поза ними', () => {
    expect(zoneIdAt(ZONES, 11)).toBe('dz-01');
    expect(zoneIdAt(ZONES, 30.2)).toBe('dz-02');
    expect(zoneIdAt(ZONES, 20)).toBeNull();
    expect(zoneIdAt(ZONES, null)).toBeNull();
  });
});

describe('buildMeasurement', () => {
  it('склеює стан трекера з результатом probe', () => {
    const m = buildMeasurement(CTX, {
      ts: 1000,
      lat: 51.1,
      lng: 17.03,
      acc: 12,
      km: 11.2345678,
      kmEstimated: false,
      probeOk: true,
      probeRttMs: 240,
      effectiveType: '4g',
    });
    expect(m).toMatchObject({
      sessionId: 'trip#1',
      tripId: 'trip',
      operator: 'play',
      routeKm: 11.235,
      inZoneId: 'dz-01',
      probeOk: true,
      probeRttMs: 240,
      effectiveType: '4g',
    });
  });

  it('замір без GPS зберігає dead-reckoning км і прапорець', () => {
    const m = buildMeasurement(CTX, {
      ts: 2000,
      lat: null,
      lng: null,
      acc: null,
      km: 10.8,
      kmEstimated: true,
      probeOk: false,
      probeRttMs: null,
      effectiveType: null,
    });
    expect(m.lat).toBeNull();
    expect(m.kmEstimated).toBe(true);
    expect(m.inZoneId).toBe('dz-01');
  });
});

describe('qualityBuckets', () => {
  it('у бакеті перемагає найгірший замір', () => {
    const buckets = qualityBuckets(
      [
        row({ routeKm: 0.1 }),
        row({ routeKm: 0.2, probeOk: false, probeRttMs: null }),
        row({ routeKm: 0.3, probeRttMs: 2000 }),
      ],
      100,
      100,
    );
    expect(buckets).toHaveLength(1);
    expect(buckets[0]).toMatchObject({ index: 0, quality: 'dead', count: 3 });
  });

  it('розкладає заміри по осі км і пропускає рядки без км', () => {
    const buckets = qualityBuckets(
      [row({ routeKm: 5 }), row({ routeKm: 95, probeRttMs: 3000 }), row({ routeKm: null })],
      100,
      10,
    );
    expect(buckets.map((b) => [b.index, b.quality])).toEqual([
      [0, 'good'],
      [9, 'poor'],
    ]);
  });

  it('км за межами маршруту не вилітає за останній бакет', () => {
    const buckets = qualityBuckets([row({ routeKm: 120 })], 100, 10);
    expect(buckets[0].index).toBe(9);
  });
});

describe('medianRtt / deadShare', () => {
  it('медіана рахується лише по вдалих замірах', () => {
    expect(
      medianRtt([
        row({ probeRttMs: 100 }),
        row({ probeRttMs: 300 }),
        row({ probeOk: false, probeRttMs: null }),
      ]),
    ).toBe(200);
    expect(medianRtt([row({ probeOk: false, probeRttMs: null })])).toBeNull();
  });

  it('частка мертвих на порожній сесії — 0, а не NaN', () => {
    expect(deadShare({ count: 0, deadCount: 0 })).toBe(0);
    expect(deadShare({ count: 4, deadCount: 1 })).toBe(0.25);
  });
});

describe('експорт', () => {
  const bundle = {
    tripId: 'PLK_IC_2026_1',
    name: 'IC 1 A → B',
    carrier: 'IC',
    lengthKm: 100,
    deadZones: [
      { id: 'dz-01', fromKm: 10, toKm: 12, severity: 'none' },
      { id: 'dz-02', fromKm: 30, toKm: 30.4, severity: 'weak' },
    ],
  } as unknown as RouteBundle;

  it('сесія фотографує прогнозовані зони на момент старту', () => {
    const session = newLogSession(bundle, 'play', 1_754_220_000_000, false);
    expect(session.id).toBe(makeSessionId('PLK_IC_2026_1', 1_754_220_000_000));
    expect(session.zones).toEqual(ZONES);
    expect(session.endedAt).toBeNull();
  });

  it('файл має стабільну схему і не тягне локальні id рядків', () => {
    const session = newLogSession(bundle, 'play', 1_754_220_000_000, false);
    const payload = sessionExport(session, [row({ id: 7 })], 1_754_220_100_000);
    expect(payload.schema).toBe(1);
    expect(payload.exportedAt).toBe(1_754_220_100_000);
    expect(payload.measurements[0]).not.toHaveProperty('id');
    expect(JSON.parse(JSON.stringify(payload))).toEqual(payload);
  });

  it('ім’я файлу містить дату й рейс', () => {
    const session = newLogSession(bundle, null, new Date(2026, 7, 3, 14, 35).getTime(), false);
    expect(exportFileName(session)).toBe('traincov-2026-08-03-1435-PLK_IC_2026_1.json');
  });
});
