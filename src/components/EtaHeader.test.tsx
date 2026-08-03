// @vitest-environment jsdom
/**
 * Смоук-рендер хедера прогнозу: перевіряє, що стан із `eta-status.ts`
 * доходить до екрана словами, які має побачити пасажир.
 */
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EtaHeader } from './EtaHeader';
import { computeEta } from '../core/eta';
import type { EtaStore } from '../core/eta-store';
import type { DeadZone, RouteBundle } from '../core/types';

vi.mock('../core/db', () => ({
  getSetting: () => Promise.resolve(undefined),
  setSetting: () => Promise.resolve(),
}));

const NOW = new Date(2026, 7, 3, 6, 0, 0).getTime();

const zone: DeadZone = {
  id: 'z1',
  fromKm: 40,
  toKm: 45,
  lengthKm: 5,
  kind: 'tunnel',
  severity: 'none',
  source: 'osm',
  geometry: { type: 'LineString', coordinates: [[0, 0], [0, 1]] },
};

const bundle: RouteBundle = {
  tripId: 'T',
  name: 'Test',
  carrier: 'IC',
  carrierName: 'IC',
  trainNumber: null,
  serviceDate: '2026-08-03',
  shape: {
    type: 'Feature',
    properties: {},
    geometry: { type: 'LineString', coordinates: [[0, 0], [0, 1]] },
  },
  lengthKm: 100,
  stops: [
    { id: 'a', name: 'A', km: 0, lat: 0, lng: 0, arr: null, dep: '06:00:00' },
    { id: 'b', name: 'B', km: 100, lat: 0, lng: 0, arr: '07:00:00', dep: null },
  ],
  speedProfile: [{ fromKm: 0, toKm: 100, kmh: 100 }],
  deadZones: [zone],
};

function storeAt(km: number): EtaStore {
  const result = computeEta({
    km,
    now: NOW,
    speedKmh: 100,
    confidence: 'gps',
    stopped: false,
    bundle,
  });
  return {
    getResult: () => result,
    now: () => NOW,
    subscribe: () => () => {},
    start: () => {},
    stop: () => {},
  };
}

function render(store: EtaStore): string {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  act(() => root.render(<EtaHeader store={store} />));
  const html = host.textContent ?? '';
  act(() => root.unmount());
  host.remove();
  return html;
}

describe('EtaHeader', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });
  afterEach(() => vi.useRealTimers());

  it('далека діра: хвилини, час і довжина', () => {
    const text = render(storeAt(0));
    expect(text).toContain('Наступна діра через');
    expect(text).toContain('24 хв');
    expect(text).toContain('о 06:24');
    expect(text).toContain('діра ~3 хв');
  });

  it('близька діра: великий mm:ss', () => {
    const text = render(storeAt(38));
    expect(text).toContain('Інтернет зникне через');
    expect(text).toMatch(/\d+:\d\d/);
  });

  it('усередині зони: рахуємо до сигналу', () => {
    const text = render(storeAt(42));
    expect(text).toContain('Мертва зона');
    expect(text).toContain('сигнал ~06:01');
  });

  it('дір попереду немає', () => {
    expect(render(storeAt(90))).toContain('дір не відомо');
  });
});
