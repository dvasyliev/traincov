/**
 * Лінійна референція по shape для пайплайна: точка → (км маршруту, відстань до колії).
 *
 * Чому не `turf.nearestPointOnLine`: він лінійно перебирає всі сегменти лінії.
 * Маршрут — це тисячі сегментів, а спроєктувати треба десятки тисяч вершин
 * тунельних ways на кожен бандл. Тому сітковий індекс: сегменти розкладені по
 * комірках ~0.02°, і на запит перевіряються лише 9 комірок навколо точки.
 *
 * Клієнтський аналог живе в `src/core/linref.ts` — там інша задача (потік GPS-фіксів
 * з пам'яттю про попередню позицію), тому код свідомо не спільний.
 */

const EARTH_R_KM = 6371.0088;
const DEG = Math.PI / 180;
const KM_PER_DEG_LAT = (EARTH_R_KM * Math.PI) / 180;

/** Комірка сітки, градуси. Має бути помітно більшою за толеранс матчингу (50 м). */
const CELL_DEG = 0.02;

export interface ShapeHit {
  /** Відстань від початку маршруту, км. */
  km: number;
  /** Відстань точки до колії, метри. */
  distM: number;
}

export interface ShapeIndex {
  /** Загальна довжина, км — збігається з `turf.length` тієї ж лінії. */
  readonly lengthKm: number;
  /** `null`, якщо поблизу немає жодного сегмента (точка далеко від маршруту). */
  locate(lng: number, lat: number): ShapeHit | null;
}

/** Haversine — та сама формула й радіус, що в turf, щоб км сходились із lengthKm бандла. */
function haversineKm(aLng: number, aLat: number, bLng: number, bLat: number): number {
  const dLat = (bLat - aLat) * DEG;
  const dLng = (bLng - aLng) * DEG;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(aLat * DEG) * Math.cos(bLat * DEG) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_R_KM * Math.asin(Math.sqrt(h));
}

const cellKey = (ix: number, iy: number) => `${ix}|${iy}`;

export function createShapeIndex(line: GeoJSON.Feature<GeoJSON.LineString>): ShapeIndex {
  const coords = line.geometry.coordinates;
  const n = coords.length;

  // Кумулятивні км по вершинах: km проєкції = cum[i] + t * довжина сегмента.
  const cum = new Float64Array(n);
  for (let i = 1; i < n; i++) {
    const [aLng, aLat] = coords[i - 1] as [number, number];
    const [bLng, bLat] = coords[i] as [number, number];
    cum[i] = (cum[i - 1] as number) + haversineKm(aLng, aLat, bLng, bLat);
  }
  const lengthKm = n ? (cum[n - 1] as number) : 0;

  // Сегмент i = [i, i+1]; кладемо його в усі комірки, які накриває його bbox.
  const grid = new Map<string, number[]>();
  for (let i = 0; i < n - 1; i++) {
    const [aLng, aLat] = coords[i] as [number, number];
    const [bLng, bLat] = coords[i + 1] as [number, number];
    const ix0 = Math.floor(Math.min(aLng, bLng) / CELL_DEG);
    const ix1 = Math.floor(Math.max(aLng, bLng) / CELL_DEG);
    const iy0 = Math.floor(Math.min(aLat, bLat) / CELL_DEG);
    const iy1 = Math.floor(Math.max(aLat, bLat) / CELL_DEG);
    for (let ix = ix0; ix <= ix1; ix++) {
      for (let iy = iy0; iy <= iy1; iy++) {
        const key = cellKey(ix, iy);
        const list = grid.get(key);
        if (list) list.push(i);
        else grid.set(key, [i]);
      }
    }
  }

  return {
    lengthKm,

    locate(lng, lat) {
      if (n < 2) return null;
      // Локальна рівнокутна проєкція навколо самої точки: на масштабі комірки
      // похибка мізерна, а тригонометрії на сегмент — нуль.
      const kx = KM_PER_DEG_LAT * Math.cos(lat * DEG);
      const ky = KM_PER_DEG_LAT;

      const ix = Math.floor(lng / CELL_DEG);
      const iy = Math.floor(lat / CELL_DEG);

      let bestDistKm = Infinity;
      let bestKm = 0;
      let found = false;

      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          const list = grid.get(cellKey(ix + dx, iy + dy));
          if (!list) continue;
          for (const seg of list) {
            const [aLng, aLat] = coords[seg] as [number, number];
            const [bLng, bLat] = coords[seg + 1] as [number, number];
            const ax = (aLng - lng) * kx;
            const ay = (aLat - lat) * ky;
            const bx = (bLng - lng) * kx;
            const by = (bLat - lat) * ky;
            const vx = bx - ax;
            const vy = by - ay;
            const len2 = vx * vx + vy * vy;
            const t = len2 > 0 ? Math.min(1, Math.max(0, -(ax * vx + ay * vy) / len2)) : 0;
            const px = ax + t * vx;
            const py = ay + t * vy;
            const distKm = Math.hypot(px, py);
            if (distKm >= bestDistKm) continue;
            found = true;
            bestDistKm = distKm;
            const segKm = (cum[seg + 1] as number) - (cum[seg] as number);
            bestKm = (cum[seg] as number) + t * segKm;
          }
        }
      }

      if (!found) return null;
      return { km: bestKm, distM: bestDistKm * 1000 };
    },
  };
}
