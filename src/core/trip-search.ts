import type { TripIndexEntry } from './types';
import { normalizeSearch } from './format';

/** Всі токени запиту мають знайтися в назві/станціях (порядок слів не важливий). */
export function matchesQuery(entry: TripIndexEntry, query: string): boolean {
  const tokens = normalizeSearch(query).split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return true;
  const haystack = normalizeSearch(
    `${entry.name} ${entry.fromStop} ${entry.toStop} ${entry.carrier}`,
  );
  return tokens.every((token) => haystack.includes(token));
}

export interface TripGroup {
  key: string;
  label: string;
  trips: TripIndexEntry[];
}

const byDep = (a: TripIndexEntry, b: TripIndexEntry) => a.dep.localeCompare(b.dep);

/** Порожній пошук → рейси, згруповані за напрямком; групи й картки — за часом відправлення. */
export function groupByDirection(trips: TripIndexEntry[]): TripGroup[] {
  const groups = new Map<string, TripGroup>();

  for (const trip of trips) {
    const key = `${trip.fromStop} → ${trip.toStop}`;
    const group = groups.get(key) ?? { key, label: key, trips: [] };
    group.trips.push(trip);
    groups.set(key, group);
  }

  const result = [...groups.values()];
  for (const group of result) group.trips.sort(byDep);
  result.sort((a, b) => byDep(a.trips[0], b.trips[0]));
  return result;
}

export function sortByDeparture(trips: TripIndexEntry[]): TripIndexEntry[] {
  return [...trips].sort(byDep);
}
