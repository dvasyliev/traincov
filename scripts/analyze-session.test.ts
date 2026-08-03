import { describe, expect, it } from 'vitest';
import { clusterDead, tripNameContains } from './analyze-session.ts';

const ZONES = [{ id: 'dz-01', fromKm: 100, toKm: 102, severity: 'none' }];

function m(routeKm: number, probeOk: boolean, kmEstimated = false) {
  return { ts: routeKm * 1000, routeKm, probeOk, probeRttMs: probeOk ? 200 : null, kmEstimated };
}

describe('clusterDead', () => {
  it('групує сусідні мертві заміри в один кластер', () => {
    const clusters = clusterDead(
      [m(10, true), m(20, false), m(20.5, false), m(21, false), m(30, true)],
      [],
      0.8,
      2,
    );
    expect(clusters).toHaveLength(1);
    expect(clusters[0].count).toBe(3);
    // Межі розсунуті до середини прогалини між живими сусідами.
    expect(clusters[0].fromKm).toBeCloseTo(15);
    expect(clusters[0].toKm).toBeCloseTo(25.5);
  });

  it('розрив більший за gap ріже кластер надвоє', () => {
    const clusters = clusterDead(
      [m(20, false), m(20.5, false), m(40, false), m(40.5, false)],
      [],
      0.8,
      2,
    );
    expect(clusters).toHaveLength(2);
  });

  it('одиничний фейл відкидається як шум probe', () => {
    expect(clusterDead([m(10, true), m(20, false), m(30, true)], [], 0.8, 2)).toHaveLength(0);
  });

  it('позначає, чи кластер уже є в прогнозі', () => {
    const clusters = clusterDead(
      [m(100.2, false), m(100.8, false), m(200, false), m(200.5, false)],
      ZONES,
      0.8,
      2,
    );
    expect(clusters[0].matched.map((z) => z.id)).toEqual(['dz-01']);
    expect(clusters[1].matched).toEqual([]);
  });

  it('рахує заміри без GPS окремо — це підтверджений тунель', () => {
    const clusters = clusterDead([m(50, false, true), m(50.4, false, true)], [], 0.8, 2);
    expect(clusters[0].estimated).toBe(2);
  });

  it('рядки без км не ламають кластеризацію', () => {
    const rows = [
      { ts: 1, routeKm: null, probeOk: false, probeRttMs: null },
      m(20, false),
      m(20.4, false),
    ];
    expect(clusterDead(rows, [], 0.8, 2)).toHaveLength(1);
  });
});

describe('tripNameContains', () => {
  it('фіксує номер потяга і напрямок', () => {
    expect(tripNameContains('IC 6148/9 Oleńka Wrocław Główny → Warszawa Wschodnia')).toEqual([
      'IC 6148/9',
      '→ Warszawa Wschodnia',
    ]);
  });

  it('без номера бере ліву частину як є', () => {
    expect(tripNameContains('Wrocław Główny → Warszawa')).toEqual([
      'Wrocław Główny',
      '→ Warszawa',
    ]);
  });
});
