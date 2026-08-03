/**
 * Єдине джерело типів даних маршруту.
 * Імпортується І клієнтом (src/**), І офлайн-пайплайном (scripts/pipeline/**),
 * тому не має тягнути за собою ні DOM, ні Node API.
 */

/** Час у GTFS-нотації `HH:MM:SS`; години можуть бути ≥ 24 (рейс після півночі). */
export type GtfsTime = string;

export interface RouteStop {
  /** `stop_id` з GTFS. */
  id: string;
  name: string;
  /** Відстань від початку маршруту, км (лінійна референція по shape). */
  km: number;
  lat: number;
  lng: number;
  /** `null` на першій зупинці. */
  arr: GtfsTime | null;
  /** `null` на останній зупинці. */
  dep: GtfsTime | null;
}

/** Середня швидкість на перегоні між сусідніми зупинками (виведена з розкладу). */
export interface SpeedSegment {
  fromKm: number;
  toKm: number;
  kmh: number;
}

export type DeadZoneKind = 'tunnel' | 'cutting' | 'manual';
export type DeadZoneSeverity = 'none' | 'weak';
export type DeadZoneSource = 'osm' | 'manual';

export interface DeadZone {
  id: string;
  fromKm: number;
  toKm: number;
  /** `toKm - fromKm`; порахований пайплайном, щоб UI не рахував його на кожен кадр. */
  lengthKm: number;
  kind: DeadZoneKind;
  severity: DeadZoneSeverity;
  source: DeadZoneSource;
  note?: string;
  /**
   * Готовий шматок колії (`lineSliceAlong(shape, fromKm, toKm)`).
   * Ріже пайплайн: клієнт у дорозі має тільки малювати, а не рахувати геометрію.
   */
  geometry: GeoJSON.LineString;
}

/** Повний офлайн-пакет одного рейсу: `public/data/routes/{tripId}.json`. */
export interface RouteBundle {
  tripId: string;
  /** Людська назва: `IC 1234 Wrocław Główny → Warszawa Centralna`. */
  name: string;
  /** Код перевізника з `agency.txt` (IC, KM, PR, ...). */
  carrier: string;
  /** Назва перевізника повністю. */
  carrierName: string;
  /** Номер потяга (`trip_short_name`), якщо є. */
  trainNumber: string | null;
  /** Дата розкладу, на яку відібрано рейс (`YYYY-MM-DD`). */
  serviceDate: string;
  /** Спрощена (Douglas–Peucker) геометрія колії. */
  shape: GeoJSON.Feature<GeoJSON.LineString>;
  lengthKm: number;
  stops: RouteStop[];
  speedProfile: SpeedSegment[];
  /** Відсортовані за `fromKm`, не перетинаються. */
  deadZones: DeadZone[];
}

/** Рядок у `public/data/index.json`. */
export interface TripIndexEntry {
  tripId: string;
  name: string;
  carrier: string;
  /** Відправлення з першої зупинки. */
  dep: GtfsTime;
  /** Прибуття на останню зупинку. */
  arr: GtfsTime;
  fromStop: string;
  toStop: string;
  lengthKm: number;
  stopCount: number;
  /** Скільки мертвих зон у бандлі — видно ще до завантаження пакета. */
  zonesCount: number;
  /** Шлях відносно `public/data/`. */
  file: string;
  sizeKb: number;
}

export interface TripIndex {
  generatedAt: string;
  /** Дата розкладу, на яку згенеровано всі бандли (`YYYY-MM-DD`). */
  serviceDate: string;
  /** Джерело даних — для атрибуції в UI. */
  source: string;
  trips: TripIndexEntry[];
}
