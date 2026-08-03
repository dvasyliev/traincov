import { mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { TripIndex, TripIndexEntry } from '../../src/core/types.ts';
import {
  buildBundle,
  type RawStopTime,
  type RawTrip,
  type ShapePoint,
  type StopInfo,
} from './build-bundle.ts';
import {
  ATTRIBUTION,
  BUNDLE_SIZE_WARN_KB,
  MAX_TRIPS_PER_PAIR,
  OUT_DIR,
  RAIL_ROUTE_TYPE,
  ROUTES_SUBDIR,
  SERVICE_DATE,
  TARGET,
} from './config.ts';
import { ensureGtfs } from './download.ts';
import {
  isoDate,
  normalizeStopName,
  parseGtfsTime,
  readCsv,
  streamCsv,
  todayYyyymmdd,
} from './gtfs.ts';

const log = (msg: string) => console.log(`[pipeline] ${msg}`);
const warn = (msg: string) => console.warn(`[pipeline] ⚠ ${msg}`);

/** Ім'я файлу з trip_id: у GTFS там трапляються і слеші, і двокрапки. */
function sanitize(tripId: string): string {
  return tripId.replace(/[^a-zA-Z0-9_-]/g, '_');
}

/** Дата розкладу: 'auto' → сьогодні, інакше найближчий наступний активний день. */
function pickServiceDate(activeByDate: Map<string, Set<string>>): string {
  if (SERVICE_DATE !== 'auto') {
    if (!activeByDate.has(SERVICE_DATE)) throw new Error(`У фіді немає дати ${SERVICE_DATE}`);
    return SERVICE_DATE;
  }
  const dates = [...activeByDate.keys()].filter((d) => (activeByDate.get(d) as Set<string>).size > 0).sort();
  if (!dates.length) throw new Error('calendar_dates.txt порожній');
  const today = todayYyyymmdd();
  return dates.find((d) => d >= today) ?? (dates[dates.length - 1] as string);
}

async function main(): Promise<void> {
  const started = Date.now();
  const zip = await ensureGtfs(process.argv.includes('--force-download'));

  // --- довідники (усі маленькі, тримаємо цілком) ---
  const [agencyRows, routeRows, stopRows, calendarRows] = await Promise.all([
    readCsv(zip, 'agency.txt'),
    readCsv(zip, 'routes.txt'),
    readCsv(zip, 'stops.txt'),
    readCsv(zip, 'calendar_dates.txt'),
  ]);

  const agencyNames = new Map(agencyRows.map((r) => [r.agency_id, r.agency_name]));
  const railRoutes = new Map<string, string>(); // route_id → agency_id
  for (const r of routeRows) {
    if (r.route_type === RAIL_ROUTE_TYPE) railRoutes.set(r.route_id, r.agency_id);
  }

  const stops = new Map<string, StopInfo>();
  const parentOf = new Map<string, string>();
  const byName = new Map<string, string[]>();
  for (const r of stopRows) {
    if (r.location_type === '1') continue; // станція-контейнер, у stop_times не зустрічається
    const info: StopInfo = {
      id: r.stop_id,
      name: r.stop_name,
      lat: Number(r.stop_lat),
      lng: Number(r.stop_lon),
    };
    stops.set(r.stop_id, info);
    if (r.parent_station) parentOf.set(r.stop_id, r.parent_station);
    const key = normalizeStopName(r.stop_name);
    const list = byName.get(key);
    if (list) list.push(r.stop_id);
    else byName.set(key, [r.stop_id]);
  }
  // Перон/колія — окремі stop_id під спільним parent_station: підтягуємо їх до назви батька.
  for (const [child, parent] of parentOf) {
    const parentStop = stopRows.find((r) => r.stop_id === parent);
    if (!parentStop) continue;
    const key = normalizeStopName(parentStop.stop_name);
    const list = byName.get(key);
    if (list && !list.includes(child)) list.push(child);
  }

  const activeByDate = new Map<string, Set<string>>();
  const removedByDate = new Map<string, Set<string>>();
  for (const r of calendarRows) {
    const target = r.exception_type === '2' ? removedByDate : activeByDate;
    const set = target.get(r.date) ?? new Set<string>();
    set.add(r.service_id);
    target.set(r.date, set);
  }
  const serviceDate = pickServiceDate(activeByDate);
  const activeServices = new Set(activeByDate.get(serviceDate));
  for (const s of removedByDate.get(serviceDate) ?? []) activeServices.delete(s);
  log(`дата розкладу: ${isoDate(serviceDate)} (${activeServices.size} активних service_id)`);

  // --- рейси на цю дату ---
  const trips = new Map<string, RawTrip>();
  for (const r of await readCsv(zip, 'trips.txt')) {
    if (!activeServices.has(r.service_id)) continue;
    if (!railRoutes.has(r.route_id)) continue;
    if (!r.shape_id) continue; // без геометрії рейс нам ні до чого (пастка з ТЗ)
    trips.set(r.trip_id, {
      tripId: r.trip_id,
      routeId: r.route_id,
      serviceId: r.service_id,
      shapeId: r.shape_id,
      trainNumber: r.trip_short_name || null,
    });
  }
  log(`кандидатів (залізниця + активний service + shape): ${trips.size}`);

  // --- прохід 1 по stop_times: тільки цільові станції ---
  const targetIdsByPair = TARGET.map((pair) => ({
    pair,
    from: new Set(byName.get(normalizeStopName(pair.from)) ?? []),
    to: new Set(byName.get(normalizeStopName(pair.to)) ?? []),
  }));
  for (const t of targetIdsByPair) {
    if (!t.from.size || !t.to.size) {
      warn(`станцію не знайдено: ${!t.from.size ? t.pair.from : t.pair.to}`);
    }
  }
  const anyTargetId = new Set<string>();
  for (const t of targetIdsByPair) {
    for (const id of t.from) anyTargetId.add(id);
    for (const id of t.to) anyTargetId.add(id);
  }

  interface Hit {
    stopId: string;
    seq: number;
    dep: number | null;
  }
  const hits = new Map<string, Hit[]>();
  const scanned1 = await streamCsv(zip, 'stop_times.txt', (r) => {
    if (!anyTargetId.has(r.stop_id)) return;
    if (!trips.has(r.trip_id)) return;
    const list = hits.get(r.trip_id) ?? [];
    list.push({
      stopId: r.stop_id,
      seq: Number(r.stop_sequence),
      dep: parseGtfsTime(r.departure_time),
    });
    hits.set(r.trip_id, list);
  });
  log(`stop_times прохід 1: ${scanned1.toLocaleString('en-US')} рядків, ${hits.size} рейсів через цільові станції`);

  // --- відбір рейсів на пару ---
  const selected = new Map<string, RawTrip>();
  for (const { pair, from, to } of targetIdsByPair) {
    const matches: { trip: RawTrip; dep: number }[] = [];
    for (const [tripId, list] of hits) {
      const fromHit = list.filter((h) => from.has(h.stopId)).sort((a, b) => a.seq - b.seq)[0];
      const toHit = list.filter((h) => to.has(h.stopId)).sort((a, b) => b.seq - a.seq)[0];
      if (!fromHit || !toHit || fromHit.seq >= toHit.seq) continue;
      matches.push({ trip: trips.get(tripId) as RawTrip, dep: fromHit.dep ?? 0 });
    }
    matches.sort((a, b) => a.dep - b.dep);
    const take = matches.slice(0, MAX_TRIPS_PER_PAIR);
    for (const m of take) selected.set(m.trip.tripId, m.trip);
    log(`${pair.from} → ${pair.to}: знайдено ${matches.length}, беремо ${take.length}`);
  }
  if (!selected.size) throw new Error('жодного рейсу не відібрано — перевір TARGET');
  log(`унікальних рейсів до збірки: ${selected.size}`);

  // --- прохід 2 по stop_times: повні рядки відібраних рейсів ---
  const stopTimes = new Map<string, RawStopTime[]>();
  await streamCsv(zip, 'stop_times.txt', (r) => {
    if (!selected.has(r.trip_id)) return;
    const dist = r.shape_dist_traveled;
    const list = stopTimes.get(r.trip_id) ?? [];
    list.push({
      tripId: r.trip_id,
      stopId: r.stop_id,
      seq: Number(r.stop_sequence),
      arr: r.arrival_time ?? '',
      dep: r.departure_time ?? '',
      shapeDist: dist === undefined || dist === '' ? null : Number(dist),
    });
    stopTimes.set(r.trip_id, list);
  });
  log('stop_times прохід 2: розклади зібрано');

  // --- shapes.txt: тільки потрібні shape_id ---
  const neededShapes = new Set([...selected.values()].map((t) => t.shapeId));
  const shapes = new Map<string, ShapePoint[]>();
  await streamCsv(zip, 'shapes.txt', (r) => {
    if (!neededShapes.has(r.shape_id)) return;
    const dist = r.shape_dist_traveled;
    const list = shapes.get(r.shape_id) ?? [];
    list.push({
      seq: Number(r.shape_pt_sequence),
      lat: Number(r.shape_pt_lat),
      lng: Number(r.shape_pt_lon),
      dist: dist === undefined || dist === '' ? null : Number(dist),
    });
    shapes.set(r.shape_id, list);
  });
  log(`shapes: ${shapes.size}/${neededShapes.size} геометрій`);

  // --- збірка та запис ---
  const outDir = path.resolve(OUT_DIR);
  const routesDir = path.join(outDir, ROUTES_SUBDIR);
  await mkdir(routesDir, { recursive: true });
  // Ідемпотентність: старі бандли прибираємо, щоб у public/data не осідали
  // рейси, які випали з відбору після оновлення GTFS.
  for (const f of await readdir(routesDir)) {
    if (f.endsWith('.json')) await rm(path.join(routesDir, f));
  }

  const entries: TripIndexEntry[] = [];
  let dropped = 0;
  for (const trip of selected.values()) {
    const times = stopTimes.get(trip.tripId);
    const shapePoints = shapes.get(trip.shapeId);
    if (!times || !shapePoints) {
      warn(`${trip.tripId}: немає ${!times ? 'stop_times' : 'shapes'} → пропуск`);
      dropped++;
      continue;
    }
    const agencyId = railRoutes.get(trip.routeId) as string;
    const result = buildBundle({
      trip,
      carrier: agencyId,
      carrierName: agencyNames.get(agencyId) ?? agencyId,
      serviceDate: isoDate(serviceDate),
      stopTimes: times,
      stops,
      shapePoints,
    });

    if (!result.ok) {
      warn(`${trip.tripId}: ${result.reason} → пропуск`);
      dropped++;
      continue;
    }
    for (const w of result.warnings) warn(`${trip.tripId}: ${w}`);

    const { bundle } = result;
    const file = `${ROUTES_SUBDIR}/${sanitize(bundle.tripId)}.json`;
    const json = JSON.stringify(bundle);
    await writeFile(path.join(outDir, file), json);
    const sizeKb = Math.round((Buffer.byteLength(json) / 1024) * 10) / 10;
    if (sizeKb > BUNDLE_SIZE_WARN_KB) warn(`${file}: ${sizeKb} КБ > ${BUNDLE_SIZE_WARN_KB} КБ`);

    const first = bundle.stops[0];
    const last = bundle.stops[bundle.stops.length - 1];
    entries.push({
      tripId: bundle.tripId,
      name: bundle.name,
      carrier: bundle.carrier,
      dep: first.dep as string,
      arr: last.arr as string,
      fromStop: first.name,
      toStop: last.name,
      lengthKm: bundle.lengthKm,
      stopCount: bundle.stops.length,
      file,
      sizeKb,
    });
  }

  entries.sort((a, b) => a.dep.localeCompare(b.dep) || a.name.localeCompare(b.name));
  const index: TripIndex = {
    generatedAt: new Date().toISOString(),
    serviceDate: isoDate(serviceDate),
    source: ATTRIBUTION,
    trips: entries,
  };
  await writeFile(path.join(outDir, 'index.json'), `${JSON.stringify(index, null, 2)}\n`);

  const maxKb = entries.reduce((m, e) => Math.max(m, e.sizeKb), 0);
  log(
    `готово: ${entries.length} бандлів (відкинуто ${dropped}), максимум ${maxKb} КБ, ` +
      `${((Date.now() - started) / 1000).toFixed(1)} с`,
  );
}

main().catch((err) => {
  console.error('[pipeline] помилка:', err);
  process.exitCode = 1;
});
