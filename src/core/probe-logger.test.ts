/**
 * Планувальник замірів: період, джиттер, і — головне — коли замір НЕ пишеться.
 * Сміття в даних гірше за їх відсутність: воно виглядає як факт.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createProbeLogger, PROBE_INTERVAL_MS, PROBE_JITTER_MS } from './probe-logger';
import type { Measurement, MeasurementContext } from './measurements';
import type { TripSnapshot, TripTracker } from './trip-tracker';
import type { ProbeResult } from './probe';

const CONTEXT: MeasurementContext = {
  sessionId: 'trip#1',
  tripId: 'trip',
  operator: 'play',
  zones: [{ id: 'dz-01', fromKm: 10, toKm: 12, severity: 'none' }],
};

function snapshot(over: Partial<TripSnapshot> = {}): TripSnapshot {
  return {
    tracking: true,
    status: 'moving',
    km: 11,
    kmEstimated: false,
    speedKmh: 100,
    confidence: 'gps',
    stoppedSince: null,
    offsetM: 10,
    snapped: [17, 51],
    fix: { lat: 51.1, lng: 17.03, accuracyM: 12.4 },
    lastFixTs: 1000,
    error: null,
    simulated: false,
    ...over,
  };
}

function fakeTracker(initial: TripSnapshot) {
  let current = initial;
  const listeners = new Set<() => void>();
  const tracker = {
    bundle: { tripId: 'trip' },
    locator: {},
    now: () => Date.now(),
    getSnapshot: () => current,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    start() {},
    stop() {},
  } as unknown as TripTracker;
  return {
    tracker,
    set(next: TripSnapshot) {
      current = next;
      for (const listener of listeners) listener();
    },
  };
}

function setup(trip: TripSnapshot, result: ProbeResult = { ok: true, rttMs: 240, ts: 1 }) {
  const rows: Measurement[] = [];
  const { tracker, set } = fakeTracker(trip);
  const probe = vi.fn(async () => ({ ...result, ts: Date.now() }));
  const logger = createProbeLogger({
    tracker,
    onMeasurement: (m) => rows.push(m),
    probe,
    visible: () => true,
    // Фіксований random → передбачуваний період: тест перевіряє планування, не Math.random.
    random: () => 0.5,
  });
  return { logger, rows, probe, set };
}

/** Проганяє таймери разом із мікрозадачами, щоб await у циклі логера встиг завершитись. */
async function advance(ms: number) {
  await vi.advanceTimersByTimeAsync(ms);
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('createProbeLogger', () => {
  it('пише замір приблизно раз на 10 c', async () => {
    const { logger, rows } = setup(snapshot());
    logger.start(CONTEXT);

    await advance(1_100);
    expect(rows).toHaveLength(1);

    await advance(PROBE_INTERVAL_MS + PROBE_JITTER_MS);
    expect(rows).toHaveLength(2);
  });

  it('за 10 хв поїздки набирається ~60 замірів', async () => {
    const { logger, rows } = setup(snapshot());
    logger.start(CONTEXT);
    await advance(10 * 60_000);
    expect(rows.length).toBeGreaterThanOrEqual(58);
    expect(rows.length).toBeLessThanOrEqual(62);
  });

  it('замір несе км, сирі координати й зону', async () => {
    const { logger, rows } = setup(snapshot());
    logger.start(CONTEXT);
    await advance(1_100);

    expect(rows[0]).toMatchObject({
      sessionId: 'trip#1',
      routeKm: 11,
      lat: 51.1,
      lng: 17.03,
      acc: 12,
      inZoneId: 'dz-01',
      probeOk: true,
      probeRttMs: 240,
    });
  });

  it('фейл probe пишеться як dead і не валить цикл', async () => {
    const { logger, rows } = setup(snapshot(), { ok: false, rttMs: null, ts: 0 });
    logger.start(CONTEXT);
    await advance(1_100);
    expect(rows[0]).toMatchObject({ probeOk: false, probeRttMs: null });

    await advance(PROBE_INTERVAL_MS + PROBE_JITTER_MS);
    expect(rows).toHaveLength(2);
    expect(logger.getSnapshot()).toMatchObject({ count: 2, deadCount: 2 });
  });

  it('у тунелі пише км без координат — це найцінніший рядок', async () => {
    const { logger, rows } = setup(
      snapshot({ status: 'no-gps', fix: null, kmEstimated: true, km: 10.8 }),
      { ok: false, rttMs: null, ts: 0 },
    );
    logger.start(CONTEXT);
    await advance(1_100);

    expect(rows[0]).toMatchObject({
      lat: null,
      lng: null,
      acc: null,
      routeKm: 10.8,
      kmEstimated: true,
      inZoneId: 'dz-01',
      probeOk: false,
    });
  });

  it('не пише поза маршрутом, без дозволу і без км', async () => {
    for (const trip of [
      snapshot({ status: 'off-route' }),
      snapshot({ status: 'denied', error: 'no permission' }),
      snapshot({ status: 'acquiring', km: null }),
      snapshot({ tracking: false, status: 'idle' }),
    ]) {
      const { logger, rows, probe } = setup(trip);
      logger.start(CONTEXT);
      await advance(30_000);
      expect(rows).toHaveLength(0);
      expect(probe).not.toHaveBeenCalled();
      logger.stop();
    }
  });

  it('не зондує у фоні: тротлені таймери міряли б не мережу', async () => {
    const rows: Measurement[] = [];
    const { tracker } = fakeTracker(snapshot());
    const probe = vi.fn(async () => ({ ok: true, rttMs: 10, ts: Date.now() }));
    const logger = createProbeLogger({
      tracker,
      onMeasurement: (m) => rows.push(m),
      probe,
      visible: () => false,
      random: () => 0.5,
    });
    logger.start(CONTEXT);
    await advance(60_000);
    expect(probe).not.toHaveBeenCalled();
    logger.stop();
  });

  it('поїздка спинилась поки чекали відповідь — замір не пишеться', async () => {
    const rows: Measurement[] = [];
    const { tracker, set } = fakeTracker(snapshot());
    let release: (result: ProbeResult) => void = () => {};
    const logger = createProbeLogger({
      tracker,
      onMeasurement: (m) => rows.push(m),
      probe: () => new Promise<ProbeResult>((resolve) => (release = resolve)),
      visible: () => true,
      random: () => 0.5,
    });

    logger.start(CONTEXT);
    await advance(1_100);
    // Probe полетів; поїздку спинили до того, як прийшла відповідь.
    set(snapshot({ tracking: false, status: 'idle' }));
    release({ ok: true, rttMs: 100, ts: 1 });
    await advance(10);

    expect(rows).toHaveLength(0);
    logger.stop();
  });

  it('stop зупиняє цикл', async () => {
    const { logger, rows } = setup(snapshot());
    logger.start(CONTEXT);
    await advance(1_100);
    logger.stop();
    await advance(60_000);
    expect(rows).toHaveLength(1);
    expect(logger.getSnapshot().running).toBe(false);
  });
});
