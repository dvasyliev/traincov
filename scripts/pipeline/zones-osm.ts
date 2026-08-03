/**
 * Крок 5.1–5.2: тунелі та виїмки з OSM → інтервали км на маршруті.
 *
 * Overpass віддає *усі* тунельні ways у bbox — зокрема з чужих ліній, що
 * проходять поруч. Тому кожен way ще треба довести до нашої колії: way
 * вважається нашим, лише якщо переважна більшість його вершин лягає на shape.
 */
import {
  OVERPASS_TIMEOUT_S,
  ZONE_BBOX_PADDING_DEG,
  ZONE_TILE_DEG,
  ZONE_MATCH_MIN_RATIO,
  ZONE_MATCH_TOLERANCE_M,
  ZONE_MERGE_GAP_KM,
  ZONE_MIN_CUTTING_KM,
} from './config.ts';
import { overpassQuery, type OverpassWay } from './overpass.ts';
import type { ShapeIndex } from './shape-index.ts';

/** Інтервал маршруту до валідації та мержу з ручними зонами. */
export interface RawZone {
  fromKm: number;
  toKm: number;
  kind: 'tunnel' | 'cutting';
  note?: string;
}

interface BBox {
  south: number;
  west: number;
  north: number;
  east: number;
}

/** bbox маршруту з буфером — сирий, ще не порізаний на плитки. */
export function routeBBox(shape: GeoJSON.Feature<GeoJSON.LineString>): BBox {
  let south = Infinity;
  let west = Infinity;
  let north = -Infinity;
  let east = -Infinity;
  for (const [lng, lat] of shape.geometry.coordinates as [number, number][]) {
    if (lat < south) south = lat;
    if (lat > north) north = lat;
    if (lng < west) west = lng;
    if (lng > east) east = lng;
  }
  const p = ZONE_BBOX_PADDING_DEG;
  return { south: south - p, west: west - p, north: north + p, east: east + p };
}

/**
 * Плитки глобальної сітки ZONE_TILE_DEG, що накривають bbox. Межі плиток —
 * кратні розміру сітки, тому два різні маршрути через той самий регіон дають
 * буквально однакові запити й ділять кеш.
 */
export function routeTiles(shape: GeoJSON.Feature<GeoJSON.LineString>): BBox[] {
  const box = routeBBox(shape);
  const g = ZONE_TILE_DEG;
  const tiles: BBox[] = [];
  for (let y = Math.floor(box.south / g); y <= Math.floor(box.north / g); y++) {
    for (let x = Math.floor(box.west / g); x <= Math.floor(box.east / g); x++) {
      tiles.push({ south: y * g, west: x * g, north: (y + 1) * g, east: (x + 1) * g });
    }
  }
  return tiles;
}

const fixed = (v: number) => v.toFixed(4);

export function buildQuery(box: BBox): string {
  const bbox = `${fixed(box.south)},${fixed(box.west)},${fixed(box.north)},${fixed(box.east)}`;
  return [
    `[out:json][timeout:${OVERPASS_TIMEOUT_S}];`,
    '(',
    `  way["railway"~"rail|light_rail"]["tunnel"="yes"](${bbox});`,
    `  way["railway"~"rail|light_rail"]["cutting"="yes"](${bbox});`,
    ');',
    'out geom;',
  ].join('\n');
}

function kindOf(way: OverpassWay): 'tunnel' | 'cutting' | null {
  const tags = way.tags ?? {};
  // tunnel сильніший: у OSM трапляється way і з tunnel, і з cutting на різних кінцях.
  if (tags.tunnel === 'yes') return 'tunnel';
  if (tags.cutting === 'yes') return 'cutting';
  return null;
}

/**
 * Проєкція одного way на маршрут. Повертає `null`, якщо way не наш:
  * менш ніж ZONE_MATCH_MIN_RATIO його вершин лягає ближче ZONE_MATCH_TOLERANCE_M.
 */
function matchWay(way: OverpassWay, index: ShapeIndex): { fromKm: number; toKm: number } | null {
  const geometry = way.geometry;
  if (!geometry || geometry.length < 2) return null;

  let near = 0;
  let fromKm = Infinity;
  let toKm = -Infinity;

  for (const node of geometry) {
    const hit = index.locate(node.lon, node.lat);
    if (!hit || hit.distM > ZONE_MATCH_TOLERANCE_M) continue;
    near++;
    if (hit.km < fromKm) fromKm = hit.km;
    if (hit.km > toKm) toKm = hit.km;
  }

  if (near / geometry.length < ZONE_MATCH_MIN_RATIO) return null;
  if (!Number.isFinite(fromKm) || toKm <= fromKm) return null;
  return { fromKm, toKm };
}

interface Piece {
  fromKm: number;
  toKm: number;
  names: Set<string>;
  ids: number[];
}

/** Двоколійна лінія = 2 ways у тому самому тунелі, довгий тунель — десяток ways. */
function mergePieces(pieces: Piece[], gapKm: number): Piece[] {
  const sorted = [...pieces].sort((a, b) => a.fromKm - b.fromKm);
  const out: Piece[] = [];
  for (const piece of sorted) {
    const last = out[out.length - 1];
    if (last && piece.fromKm - last.toKm <= gapKm) {
      last.toKm = Math.max(last.toKm, piece.toKm);
      for (const name of piece.names) last.names.add(name);
      last.ids.push(...piece.ids);
      continue;
    }
    out.push({ ...piece, names: new Set(piece.names), ids: [...piece.ids] });
  }
  return out;
}

/** Вирізає з інтервалів `base` все, що накрите інтервалами `cut`. */
function subtract(base: Piece[], cut: Piece[], minKeepKm: number): Piece[] {
  const out: Piece[] = [];
  for (const piece of base) {
    let parts = [{ from: piece.fromKm, to: piece.toKm }];
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
      if (part.to - part.from < minKeepKm) continue;
      out.push({ ...piece, fromKm: part.from, toKm: part.to });
    }
  }
  return out;
}

function noteFor(kind: 'tunnel' | 'cutting', piece: Piece): string {
  const label = kind === 'tunnel' ? 'Тунель' : 'Виїмка';
  const name = [...piece.names][0];
  const ids = piece.ids.slice(0, 3).join(', ');
  const tail = piece.ids.length > 3 ? `, +${piece.ids.length - 3}` : '';
  return `${label}${name ? ` «${name}»` : ''} · OSM way ${ids}${tail}`;
}

export interface OsmZonesInput {
  shape: GeoJSON.Feature<GeoJSON.LineString>;
  index: ShapeIndex;
  /** Для логів: назва рейсу. */
  label: string;
  /** Не ходити в мережу — тільки кеш. */
  offline?: boolean;
}

export async function collectOsmZones(input: OsmZonesInput): Promise<RawZone[]> {
  const tiles = routeTiles(input.shape);
  const ways = new globalThis.Map<number, OverpassWay>();
  let missing = 0;
  for (const [i, tile] of tiles.entries()) {
    const response = await overpassQuery(buildQuery(tile), {
      label: `${input.label} [${i + 1}/${tiles.length}]`,
      offline: input.offline,
    });
    if (!response) {
      missing++;
      continue;
    }
    // Way на межі плиток приходить двічі — беремо його один раз.
    for (const way of response.elements) ways.set(way.id, way);
  }
  // Мовчазна дірка в даних гірша за відсутність даних: про неї треба знати.
  if (missing) {
    console.warn(
      `[zones] ⚠ ${input.label}: ${missing}/${tiles.length} плиток без відповіді — ` +
        'OSM-зони на цих ділянках відсутні',
    );
  }

  const buckets: Record<'tunnel' | 'cutting', Piece[]> = { tunnel: [], cutting: [] };
  for (const way of ways.values()) {
    const kind = kindOf(way);
    if (!kind) continue;
    const matched = matchWay(way, input.index);
    if (!matched) continue;
    buckets[kind].push({
      fromKm: matched.fromKm,
      toKm: matched.toKm,
      names: new Set(way.tags?.name ? [way.tags.name] : []),
      ids: [way.id],
    });
  }

  const tunnels = mergePieces(buckets.tunnel, ZONE_MERGE_GAP_KM);
  const cuttings = subtract(
    mergePieces(buckets.cutting, ZONE_MERGE_GAP_KM).filter(
      (p) => p.toKm - p.fromKm >= ZONE_MIN_CUTTING_KM,
    ),
    // Тунель важливіший за виїмку: там, де вони накладаються, лишається тунель.
    tunnels,
    ZONE_MIN_CUTTING_KM,
  );

  const zones: RawZone[] = [
    ...tunnels.map((p) => ({ fromKm: p.fromKm, toKm: p.toKm, kind: 'tunnel' as const, note: noteFor('tunnel', p) })),
    ...cuttings.map((p) => ({ fromKm: p.fromKm, toKm: p.toKm, kind: 'cutting' as const, note: noteFor('cutting', p) })),
  ];
  return zones.sort((a, b) => a.fromKm - b.fromKm);
}
