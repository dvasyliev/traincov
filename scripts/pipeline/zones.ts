/**
 * Крок 5.3–5.6: збірка `deadZones` бандла.
 *
 * Порядок: OSM дає об'єктивний шар (тунелі/виїмки), ручний файл — суб'єктивний,
 * але пріоритетніший: там, де людина заміряла, машинна здогадка поступається.
 * На виході — відсортований, невзаємоперетинний список із готовою геометрією.
 */
import { lineSliceAlong } from '@turf/turf';
import type { DeadZone, DeadZoneSeverity } from '../../src/core/types.ts';
import { ZONE_MIN_REMNANT_KM } from './config.ts';
import { manualZonesFor, type ManualRule, type TripRef } from './manual-zones.ts';
import type { RawZone } from './zones-osm.ts';

interface Interval {
  fromKm: number;
  toKm: number;
  kind: DeadZone['kind'];
  severity: DeadZoneSeverity;
  source: DeadZone['source'];
  note?: string;
}

function round(value: number, digits: number): number {
  const f = 10 ** digits;
  return Math.round(value * f) / f;
}

/** 5.4: інтервал поза межами маршруту — помилка даних, зона викидається. */
function validate(
  zone: { fromKm: number; toKm: number },
  lengthKm: number,
  label: string,
  errors: string[],
): boolean {
  if (!Number.isFinite(zone.fromKm) || !Number.isFinite(zone.toKm)) {
    errors.push(`${label}: не число (${zone.fromKm}…${zone.toKm})`);
    return false;
  }
  if (zone.fromKm < 0 || zone.toKm > lengthKm || zone.fromKm >= zone.toKm) {
    errors.push(
      `${label}: ${round(zone.fromKm, 2)}…${round(zone.toKm, 2)} км поза 0…${lengthKm} км`,
    );
    return false;
  }
  return true;
}

/** Злиття перетинів усередині одного джерела: ручні записи теж бувають внахлест. */
function mergeSameSource(intervals: Interval[]): Interval[] {
  const sorted = [...intervals].sort((a, b) => a.fromKm - b.fromKm);
  const out: Interval[] = [];
  for (const interval of sorted) {
    const last = out[out.length - 1];
    // Різна severity — різний колір і різний зміст, такі не зливаємо.
    if (last && interval.fromKm <= last.toKm && last.severity === interval.severity) {
      last.toKm = Math.max(last.toKm, interval.toKm);
      if (interval.note && last.note !== interval.note) {
        last.note = last.note ? `${last.note}; ${interval.note}` : interval.note;
      }
      continue;
    }
    out.push({ ...interval });
  }
  return out;
}

/** Вирізає з `base` усе, що накрите `cut`; обрізки коротші за поріг — геть. */
function subtract(base: Interval[], cut: Interval[]): Interval[] {
  const out: Interval[] = [];
  for (const interval of base) {
    let parts = [{ from: interval.fromKm, to: interval.toKm }];
    for (const hole of cut) {
      const next: typeof parts = [];
      for (const part of parts) {
        if (hole.toKm <= part.from || hole.fromKm >= part.to) {
          next.push(part);
          continue;
        }
        if (hole.fromKm > part.from) next.push({ from: part.from, to: hole.fromKm });
        if (hole.toKm < part.to) next.push({ from: hole.toKm, to: part.to });
      }
      parts = next;
    }
    for (const part of parts) {
      // Поріг стосується САМЕ обрізків. Незайманий інтервал лишається як є:
      // короткий тунель (кілька десятків метрів) — теж мертва зона.
      const untouched = part.from === interval.fromKm && part.to === interval.toKm;
      if (!untouched && part.to - part.from < ZONE_MIN_REMNANT_KM) continue;
      out.push({ ...interval, fromKm: part.from, toKm: part.to });
    }
  }
  return out;
}

/** Геометрію ріже пайплайн — клієнт у дорозі отримує готовий шматок колії. */
function sliceGeometry(
  shape: GeoJSON.Feature<GeoJSON.LineString>,
  fromKm: number,
  toKm: number,
): GeoJSON.LineString {
  const slice = lineSliceAlong(shape, fromKm, toKm, { units: 'kilometers' });
  return {
    type: 'LineString',
    coordinates: slice.geometry.coordinates.map(([lng, lat]) => [round(lng as number, 6), round(lat as number, 6)]),
  };
}

export interface BuildZonesInput {
  trip: TripRef;
  shape: GeoJSON.Feature<GeoJSON.LineString>;
  lengthKm: number;
  osm: RawZone[];
  manualRules: ManualRule[];
}

export interface BuildZonesResult {
  zones: DeadZone[];
  /** Некоректні записи: у лог як помилки, самі зони пропущені. */
  errors: string[];
}

export function buildDeadZones(input: BuildZonesInput): BuildZonesResult {
  const { trip, shape, lengthKm, osm, manualRules } = input;
  const errors: string[] = [];

  const manual: Interval[] = manualZonesFor(manualRules, trip)
    .filter((z) => validate(z, lengthKm, `manual ${trip.name}`, errors))
    .map((z) => ({
      fromKm: z.fromKm,
      toKm: z.toKm,
      kind: 'manual' as const,
      severity: z.severity ?? 'none',
      source: 'manual' as const,
      note: z.note,
    }));

  const fromOsm: Interval[] = osm
    .filter((z) => validate(z, lengthKm, `osm ${trip.name}`, errors))
    .map((z) => ({
      fromKm: z.fromKm,
      toKm: z.toKm,
      kind: z.kind,
      severity: z.kind === 'tunnel' ? ('none' as const) : ('weak' as const),
      source: 'osm' as const,
      note: z.note,
    }));

  const mergedManual = mergeSameSource(manual);
  // Manual пріоритетніший при перетині: OSM-шматок під ручною зоною зникає.
  const mergedOsm = subtract(mergeSameSource(fromOsm), mergedManual);

  const all = [...mergedManual, ...mergedOsm].sort((a, b) => a.fromKm - b.fromKm);

  const zones = all.map((interval, i) => {
    const fromKm = round(interval.fromKm, 3);
    const toKm = round(interval.toKm, 3);
    return {
      id: `dz-${String(i + 1).padStart(2, '0')}`,
      fromKm,
      toKm,
      lengthKm: round(toKm - fromKm, 3),
      kind: interval.kind,
      severity: interval.severity,
      source: interval.source,
      ...(interval.note ? { note: interval.note } : {}),
      geometry: sliceGeometry(shape, fromKm, toKm),
    } satisfies DeadZone;
  });

  return { zones, errors };
}
