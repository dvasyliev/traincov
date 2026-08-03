import { length as turfLength, nearestPointOnLine, point, simplify } from '@turf/turf';
import type { RouteBundle, RouteStop, SpeedSegment } from '../../src/core/types.ts';
import { MAX_KMH, MIN_KMH, SIMPLIFY_TOLERANCE } from './config.ts';
import { parseGtfsTime } from './gtfs.ts';

export interface RawTrip {
  tripId: string;
  routeId: string;
  serviceId: string;
  shapeId: string;
  trainNumber: string | null;
}

export interface RawStopTime {
  tripId: string;
  stopId: string;
  seq: number;
  arr: string;
  dep: string;
  /** `shape_dist_traveled` зі stop_times, км; `null` якщо поля немає. */
  shapeDist: number | null;
}

export interface StopInfo {
  id: string;
  name: string;
  lat: number;
  lng: number;
}

export interface ShapePoint {
  seq: number;
  lat: number;
  lng: number;
  dist: number | null;
}

export interface BuildInput {
  trip: RawTrip;
  carrier: string;
  carrierName: string;
  serviceDate: string;
  stopTimes: RawStopTime[];
  stops: Map<string, StopInfo>;
  shapePoints: ShapePoint[];
}

export type BuildResult =
  | { ok: true; bundle: RouteBundle; warnings: string[] }
  | { ok: false; reason: string };

/** Допуск на немонотонність км станцій (округлення + спрощення геометрії). */
const KM_MONOTONIC_EPS = 0.05;
/** Наскільки км останньої станції може не дотягувати до довжини лінії. */
const KM_TAIL_TOLERANCE_RATIO = 0.05;

function toLineString(points: ShapePoint[]): GeoJSON.Feature<GeoJSON.LineString> {
  const coordinates = points.map((p) => [p.lng, p.lat] as GeoJSON.Position);
  return { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates } };
}

function round(value: number, digits: number): number {
  const f = 10 ** digits;
  return Math.round(value * f) / f;
}

/** Геометрію ріжемо до ~6 знаків (≈10 см) — інакше половина бандла це нулі після коми. */
function roundCoords(line: GeoJSON.Feature<GeoJSON.LineString>): void {
  line.geometry.coordinates = line.geometry.coordinates.map(([lng, lat]) => [
    round(lng, 6),
    round(lat, 6),
  ]);
}

/**
 * Км станцій. Пріоритет — `shape_dist_traveled` з GTFS: це рідне значення
 * перевізника і воно завжди монотонне. Але воно міряне по НЕспрощеній лінії,
 * тому масштабуємо його в довжину спрощеної, щоб km станцій і lengthKm
 * лишались в одній системі координат.
 */
function stopKilometers(
  stopTimes: RawStopTime[],
  stops: Map<string, StopInfo>,
  shape: GeoJSON.Feature<GeoJSON.LineString>,
  lengthKm: number,
  shapeDistTotal: number | null,
): { km: number[]; source: 'shape_dist_traveled' | 'nearest-point' } {
  const dists = stopTimes.map((st) => st.shapeDist);
  const haveAll = dists.every((d) => d !== null);

  if (haveAll && shapeDistTotal !== null && shapeDistTotal > 0) {
    const scale = lengthKm / shapeDistTotal;
    const base = dists[0] as number;
    return { km: dists.map((d) => round(((d as number) - base) * scale, 3)), source: 'shape_dist_traveled' };
  }

  const km = stopTimes.map((st) => {
    const info = stops.get(st.stopId);
    if (!info) return Number.NaN;
    const snapped = nearestPointOnLine(shape, point([info.lng, info.lat]), { units: 'kilometers' });
    return round(snapped.properties.location as number, 3);
  });
  return { km, source: 'nearest-point' };
}

/**
 * Середня швидкість на кожному перегоні з розкладу.
 * Дірки (стоянка без часів, нульовий інтервал) заповнюються медіаною
 * валідних перегонів — краще груба оцінка, ніж відсутній сегмент у профілі.
 */
function buildSpeedProfile(
  stops: RouteStop[],
  warnings: string[],
): SpeedSegment[] {
  const raw: (number | null)[] = [];

  for (let i = 0; i < stops.length - 1; i++) {
    const a = stops[i];
    const b = stops[i + 1];
    const depA = parseGtfsTime(a.dep ?? undefined) ?? parseGtfsTime(a.arr ?? undefined);
    const arrB = parseGtfsTime(b.arr ?? undefined) ?? parseGtfsTime(b.dep ?? undefined);
    const dKm = b.km - a.km;
    if (depA === null || arrB === null || arrB <= depA || dKm <= 0) {
      raw.push(null);
      continue;
    }
    raw.push(dKm / ((arrB - depA) / 3600));
  }

  const valid = raw.filter((v): v is number => v !== null).sort((x, y) => x - y);
  const fallback = valid.length ? valid[Math.floor(valid.length / 2)] : MIN_KMH;

  return raw.map((kmh, i) => {
    let value = kmh;
    if (value === null) {
      warnings.push(`перегін ${stops[i].name} → ${stops[i + 1].name}: немає часів, беремо медіану`);
      value = fallback;
    }
    if (value < MIN_KMH || value > MAX_KMH) {
      warnings.push(
        `перегін ${stops[i].name} → ${stops[i + 1].name}: ${value.toFixed(0)} км/год → кламп`,
      );
      value = Math.min(MAX_KMH, Math.max(MIN_KMH, value));
    }
    return { fromKm: stops[i].km, toKm: stops[i + 1].km, kmh: round(value, 1) };
  });
}

export function buildBundle(input: BuildInput): BuildResult {
  const { trip, carrier, carrierName, serviceDate, stopTimes, stops, shapePoints } = input;
  const warnings: string[] = [];

  if (shapePoints.length < 2) return { ok: false, reason: 'немає геометрії (shapes.txt)' };
  if (stopTimes.length < 2) return { ok: false, reason: 'менше 2 зупинок' };

  const ordered = [...shapePoints].sort((a, b) => a.seq - b.seq);
  const rawLine = toLineString(ordered);
  const shape = simplify(rawLine, { tolerance: SIMPLIFY_TOLERANCE, highQuality: false });
  roundCoords(shape);

  const lengthKm = round(turfLength(shape, { units: 'kilometers' }), 2);
  if (lengthKm <= 0) return { ok: false, reason: 'нульова довжина геометрії' };

  const lastDist = ordered[ordered.length - 1].dist;
  const firstDist = ordered[0].dist;
  const shapeDistTotal =
    lastDist !== null && firstDist !== null && lastDist > firstDist ? lastDist - firstDist : null;

  const times = [...stopTimes].sort((a, b) => a.seq - b.seq);
  const { km, source } = stopKilometers(times, stops, shape, lengthKm, shapeDistTotal);

  if (km.some((v) => !Number.isFinite(v))) {
    return { ok: false, reason: 'станція без координат у stops.txt' };
  }

  // Патології (петлі, шматки геометрії задом наперед) у MVP не лікуємо — викидаємо рейс.
  for (let i = 1; i < km.length; i++) {
    if (km[i] < km[i - 1] - KM_MONOTONIC_EPS) {
      return {
        ok: false,
        reason: `км не монотонні (${source}): ${km[i - 1]} → ${km[i]} на stop_sequence ${times[i].seq}`,
      };
    }
    if (km[i] < km[i - 1]) km[i] = km[i - 1];
  }
  if (km[km.length - 1] < lengthKm * (1 - KM_TAIL_TOLERANCE_RATIO)) {
    return {
      ok: false,
      reason: `остання станція на ${km[km.length - 1]} км при довжині лінії ${lengthKm} км`,
    };
  }

  const routeStops: RouteStop[] = times.map((st, i) => {
    const info = stops.get(st.stopId) as StopInfo;
    return {
      id: st.stopId,
      name: info.name,
      km: km[i],
      lat: round(info.lat, 6),
      lng: round(info.lng, 6),
      arr: i === 0 ? null : st.arr || null,
      dep: i === times.length - 1 ? null : st.dep || null,
    };
  });

  const first = routeStops[0];
  const last = routeStops[routeStops.length - 1];
  if (!first.dep || !last.arr) return { ok: false, reason: 'немає часів на кінцевих станціях' };

  const speedProfile = buildSpeedProfile(routeStops, warnings);
  const number = trip.trainNumber ? `${trip.trainNumber} ` : '';

  return {
    ok: true,
    warnings,
    bundle: {
      tripId: trip.tripId,
      name: `${carrier} ${number}${first.name} → ${last.name}`,
      carrier,
      carrierName,
      trainNumber: trip.trainNumber,
      serviceDate,
      shape,
      lengthKm,
      stops: routeStops,
      speedProfile,
      deadZones: [],
    },
  };
}
