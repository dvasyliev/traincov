// @vitest-environment jsdom
/** Смоук-рендер стрічки: мітки часу біля станцій і зон приходять із прогнозу. */
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeAll, describe, expect, it } from 'vitest';
import { RouteRibbon } from './RouteRibbon';
import { computeEta } from '../core/eta';
import { createTripTracker } from '../core/trip-tracker';
import type { EtaStore } from '../core/eta-store';
import type { GeoSource } from '../core/geo-source';
import type { DeadZone, RouteBundle } from '../core/types';

const NOW = new Date(2026, 7, 3, 6, 0, 0).getTime();

const zone: DeadZone = {
  id: 'z1',
  fromKm: 40,
  toKm: 45,
  lengthKm: 5,
  kind: 'tunnel',
  severity: 'none',
  source: 'osm',
  geometry: { type: 'LineString', coordinates: [[17, 51], [17, 51.1]] },
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
    geometry: { type: 'LineString', coordinates: [[17, 51], [17, 52]] },
  },
  lengthKm: 100,
  stops: [
    { id: 'a', name: 'Wrocław', km: 0, lat: 51, lng: 17, arr: null, dep: '06:00:00' },
    { id: 'b', name: 'Poznań', km: 100, lat: 52, lng: 17, arr: '07:00:00', dep: null },
  ],
  speedProfile: [{ fromKm: 0, toKm: 100, kmh: 100 }],
  deadZones: [zone],
};

const idleSource: GeoSource = {
  kind: 'simulated',
  now: () => NOW,
  start: () => {},
  stop: () => {},
};

const result = computeEta({
  km: 0,
  now: NOW,
  speedKmh: null,
  confidence: 'none',
  stopped: false,
  bundle,
});

const store: EtaStore = {
  getResult: () => result,
  now: () => NOW,
  subscribe: () => () => {},
  start: () => {},
  stop: () => {},
};

beforeAll(() => {
  // jsdom не має ResizeObserver, а стрічка міряє ним свій вьюпорт.
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});

describe('RouteRibbon', () => {
  it('показує прогнозний час станцій і діапазон зони', () => {
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    const tracker = createTripTracker(bundle, idleSource);

    act(() => root.render(<RouteRibbon tracker={tracker} etaStore={store} />));
    const text = host.textContent ?? '';
    act(() => root.unmount());
    host.remove();

    expect(text).toContain('Poznań');
    expect(text).toContain('07:00');
    // Зона 40–45 км при 100 км/год: 06:24–06:27.
    expect(text).toContain('~06:24–06:27');
  });
});
