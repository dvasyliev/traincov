/**
 * Лінійна референція: GPS-точка → км уздовж маршруту.
 * Чистий модуль без React і без DOM.
 */
import { distance, lineString, nearestPointOnLine, point } from '@turf/turf';

export interface RoutePosition {
  /** Км уздовж маршруту від старту. */
  km: number;
  /** Точка на колії (саме її показуємо на карті, не сирий GPS). */
  snapped: [number, number];
  /** Відстань від GPS-точки до колії, м. */
  offsetM: number;
  /** `true`, якщо фікс відкинуто як рух назад — km/snapped лишились попередні. */
  regressed: boolean;
}

/**
 * Пошук ведемо у вікні ±WINDOW сегментів навколо попереднього положення:
 * O(вікно) замість O(n) і, головне, без стрибків на самоперетинах геометрії
 * (вокзальні горловини, де сусідні колії лежать за 20 м одна від одної).
 */
const WINDOW_SEGMENTS = 100;
/** Якщо у вікні нічого ближчого за це — вважаємо, що трек загублено, і шукаємо по всій лінії. */
const LOST_TRACK_KM = 2;
/** Наскільки далеко за межу вікна може «втекти» результат, перш ніж ми перепитаємо всю лінію. */
const EDGE_MARGIN = 2;
/** Потяг не їде назад: відкат більший за це — GPS-шум у тунелі/на вокзалі. */
const BACKWARD_TOLERANCE_KM = 0.3;
/** Далі цього від колії користувач не в цьому потязі. */
export const OFF_ROUTE_M = 500;

export interface RouteLocator {
  /** Довжина лінії, км (виміряна по тій самій геометрії, що й km станцій). */
  readonly lengthKm: number;
  /** Спроєктувати GPS-фікс; зберігає стан (вікно пошуку + монотонність). */
  locate(lng: number, lat: number): RoutePosition;
  /** Координата на км-позначці — для симулятора й міток на карті. */
  coordinateAt(km: number): [number, number];
  /** Забути попереднє положення (нова поїздка). */
  reset(): void;
}

export function createRouteLocator(shape: GeoJSON.Feature<GeoJSON.LineString>): RouteLocator {
  const coords = shape.geometry.coordinates as [number, number][];
  if (coords.length < 2) throw new Error('linref: лінія коротша за 2 точки');

  // Кумулятивна довжина до кожної вершини — база і для вікна, і для coordinateAt.
  const cum = new Float64Array(coords.length);
  for (let i = 1; i < coords.length; i++) {
    cum[i] = cum[i - 1] + distance(point(coords[i - 1]), point(coords[i]), { units: 'kilometers' });
  }
  const lengthKm = cum[coords.length - 1];

  let lastIndex: number | null = null;
  let lastKm: number | null = null;
  let lastSnapped: [number, number] | null = null;

  function search(lo: number, hi: number, lng: number, lat: number) {
    const line = lo === 0 && hi === coords.length - 1 ? shape : lineString(coords.slice(lo, hi + 1));
    const snapped = nearestPointOnLine(line, point([lng, lat]), { units: 'kilometers' });
    const props = snapped.properties as { dist: number; location: number; index: number };
    return {
      km: cum[lo] + props.location,
      offsetKm: props.dist,
      index: lo + props.index,
      coord: snapped.geometry.coordinates as [number, number],
    };
  }

  return {
    lengthKm,

    locate(lng, lat) {
      const full = () => search(0, coords.length - 1, lng, lat);
      let hit;

      if (lastIndex === null) {
        hit = full();
      } else {
        const lo = Math.max(0, lastIndex - WINDOW_SEGMENTS);
        const hi = Math.min(coords.length - 1, lastIndex + WINDOW_SEGMENTS);
        hit = search(lo, hi, lng, lat);
        // Прилипли до краю вікна або відірвались від колії — трек міг загубитись.
        const atEdge =
          (hit.index <= lo + EDGE_MARGIN && lo > 0) ||
          (hit.index >= hi - EDGE_MARGIN && hi < coords.length - 1);
        if (hit.offsetKm > LOST_TRACK_KM || atEdge) {
          const wide = full();
          if (wide.offsetKm < hit.offsetKm) hit = wide;
        }
      }

      const offsetM = hit.offsetKm * 1000;

      if (lastKm !== null && lastSnapped !== null && hit.km < lastKm - BACKWARD_TOLERANCE_KM) {
        return { km: lastKm, snapped: lastSnapped, offsetM, regressed: true };
      }

      // Дрібний відкат у межах допуску теж не показуємо — цифра км не має тремтіти.
      const km = lastKm !== null ? Math.max(lastKm, hit.km) : hit.km;
      lastIndex = hit.index;
      lastKm = km;
      lastSnapped = km === hit.km ? hit.coord : lastSnapped;
      return { km, snapped: lastSnapped as [number, number], offsetM, regressed: false };
    },

    coordinateAt(km) {
      const target = Math.min(Math.max(km, 0), lengthKm);
      let lo = 0;
      let hi = coords.length - 1;
      while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if (cum[mid] <= target) lo = mid;
        else hi = mid;
      }
      const span = cum[hi] - cum[lo];
      const t = span > 0 ? (target - cum[lo]) / span : 0;
      return [
        coords[lo][0] + (coords[hi][0] - coords[lo][0]) * t,
        coords[lo][1] + (coords[hi][1] - coords[lo][1]) * t,
      ];
    },

    reset() {
      lastIndex = null;
      lastKm = null;
      lastSnapped = null;
    },
  };
}
