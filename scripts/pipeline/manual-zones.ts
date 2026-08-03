/**
 * Крок 5.3: ручний файл власних спостережень.
 *
 * Km у файлі — км конкретного бандла, тому правило обов'язково прив'язується
 * до рейсу через `match`. Файл читається один раз за прогін.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { DeadZoneSeverity } from '../../src/core/types.ts';

export interface ManualZoneSpec {
  fromKm: number;
  toKm: number;
  /** За замовчуванням `none` — «інтернету немає». */
  severity?: DeadZoneSeverity;
  note?: string;
}

export interface ManualMatch {
  /** Підрядок або масив підрядків; мають збігтися ВСІ (так фіксується напрямок). */
  tripNameContains?: string | string[];
  /** Код перевізника з agency.txt (IC, PR, KM…). */
  carrier?: string;
  /** Точний `trip_id` — для разових прив'язок. */
  tripId?: string;
}

export interface ManualRule {
  match: ManualMatch;
  zones: ManualZoneSpec[];
}

export interface TripRef {
  tripId: string;
  name: string;
  carrier: string;
}

const FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'manual-zones.json');

function normalize(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ł/gi, 'l')
    .toLowerCase();
}

/** Файл може бути і голим масивом правил, і об'єктом `{ note, rules }`. */
function extractRules(parsed: unknown): ManualRule[] {
  if (Array.isArray(parsed)) return parsed as ManualRule[];
  const rules = (parsed as { rules?: unknown })?.rules;
  if (Array.isArray(rules)) return rules as ManualRule[];
  throw new Error('manual-zones.json: очікується масив правил або { rules: [...] }');
}

export async function loadManualRules(): Promise<ManualRule[]> {
  let text: string;
  try {
    text = await readFile(FILE, 'utf8');
  } catch {
    return []; // файлу немає — працюємо тільки на OSM
  }
  const rules = extractRules(JSON.parse(text));
  for (const rule of rules) {
    if (!rule?.match || !Array.isArray(rule.zones)) {
      throw new Error('manual-zones.json: правило без match або zones');
    }
  }
  return rules;
}

export function matchesTrip(match: ManualMatch, trip: TripRef): boolean {
  if (match.tripId && match.tripId !== trip.tripId) return false;
  if (match.carrier && match.carrier !== trip.carrier) return false;
  if (match.tripNameContains) {
    const needles = Array.isArray(match.tripNameContains)
      ? match.tripNameContains
      : [match.tripNameContains];
    const haystack = normalize(trip.name);
    if (!needles.every((n) => haystack.includes(normalize(n)))) return false;
  }
  return true;
}

/** Усі ручні зони, що стосуються цього рейсу. */
export function manualZonesFor(rules: ManualRule[], trip: TripRef): ManualZoneSpec[] {
  return rules.filter((r) => matchesTrip(r.match, trip)).flatMap((r) => r.zones);
}
