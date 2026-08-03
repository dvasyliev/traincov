import { describe, expect, it } from 'vitest';
import { entryFromBundle, hasScheduleUpdate, homeTrips, type SavedTrip } from './offline';
import type { RouteBundle, TripIndex, TripIndexEntry } from './types';

function entry(tripId: string, name = tripId): TripIndexEntry {
  return {
    tripId,
    name,
    carrier: 'IC',
    dep: '08:00:00',
    arr: '12:00:00',
    fromStop: 'A',
    toStop: 'B',
    lengthKm: 100,
    stopCount: 5,
    zonesCount: 2,
    file: `routes/${tripId}.json`,
    sizeKb: 10,
  };
}

function index(trips: TripIndexEntry[], generatedAt = '2026-08-03T10:00:00.000Z'): TripIndex {
  return { generatedAt, serviceDate: '2026-08-03', source: 'test', trips };
}

function saved(tripId: string, over: Partial<SavedTrip> = {}): SavedTrip {
  return { tripId, entry: entry(tripId), dataVersion: null, savedAt: 1, ...over };
}

describe('homeTrips', () => {
  it('онлайн віддає весь індекс', () => {
    const trips = [entry('a'), entry('b')];
    expect(homeTrips({ index: index(trips), saved: [saved('a')], online: true })).toEqual(trips);
  });

  it('офлайн лишає тільки збережені рейси', () => {
    const result = homeTrips({
      index: index([entry('a'), entry('b')]),
      saved: [saved('b')],
      online: false,
    });
    expect(result.map((t) => t.tripId)).toEqual(['b']);
  });

  it('офлайн без індексу бере опис зі збереженого, найновіші зверху', () => {
    const result = homeTrips({
      index: null,
      saved: [saved('a', { savedAt: 1 }), saved('b', { savedAt: 2 })],
      online: false,
    });
    expect(result.map((t) => t.tripId)).toEqual(['b', 'a']);
  });

  it('офлайн віддає перевагу свіжому опису з індексу', () => {
    const result = homeTrips({
      index: index([entry('a', 'нова назва')]),
      saved: [saved('a')],
      online: false,
    });
    expect(result[0]?.name).toBe('нова назва');
  });
});

describe('hasScheduleUpdate', () => {
  const current = index([], '2026-08-03T10:00:00.000Z');

  it('версії збігаються — оновлення немає', () => {
    expect(hasScheduleUpdate(saved('a', { dataVersion: current.generatedAt }), current)).toBe(false);
  });

  it('пайплайн перегенерував дані — є оновлення', () => {
    expect(hasScheduleUpdate(saved('a', { dataVersion: '2026-08-01T00:00:00.000Z' }), current)).toBe(
      true,
    );
  });

  it('без індексу (офлайн) нічого не обіцяємо', () => {
    expect(hasScheduleUpdate(saved('a', { dataVersion: '2026-08-01T00:00:00.000Z' }), null)).toBe(
      false,
    );
  });

  it('невідома версія збереженого — не турбуємо', () => {
    expect(hasScheduleUpdate(saved('a', { dataVersion: null }), current)).toBe(false);
  });
});

describe('entryFromBundle', () => {
  const bundle = {
    tripId: 'PLK/IC:1',
    name: 'IC 1 A → B',
    carrier: 'IC',
    carrierName: 'IC',
    trainNumber: '1',
    serviceDate: '2026-08-03',
    shape: { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [] } },
    lengthKm: 42.5,
    stops: [
      { id: 'a', name: 'A', km: 0, lat: 51, lng: 17, arr: null, dep: '08:00:00' },
      { id: 'b', name: 'B', km: 42.5, lat: 52, lng: 18, arr: '09:00:00', dep: null },
    ],
    speedProfile: [],
    deadZones: [],
  } as unknown as RouteBundle;

  it('відновлює картку рейсу без index.json', () => {
    expect(entryFromBundle(bundle)).toMatchObject({
      tripId: 'PLK/IC:1',
      fromStop: 'A',
      toStop: 'B',
      dep: '08:00:00',
      arr: '09:00:00',
      stopCount: 2,
      zonesCount: 0,
      // Слеші й двокрапки пайплайн замінює на підкреслення — інакше файл не знайдеться.
      file: 'routes/PLK_IC_1.json',
    });
  });
});
