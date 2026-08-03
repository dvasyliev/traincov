/**
 * Презентація мертвих зон — спільна для стрічки, карти й bottom-sheet,
 * щоб та сама зона всюди називалася однаково.
 */
import { along, length as turfLength } from '@turf/turf';
import type { DeadZone, DeadZoneKind, DeadZoneSeverity, DeadZoneSource } from './types';

/** Кольори живуть тут, бо їх потребує ще й MapLibre (він CSS-змінних не бачить). */
export const ZONE_COLOR: Record<DeadZoneSeverity, string> = {
  none: '#ef4444',
  weak: '#f59e0b',
};

const KIND_LABEL: Record<DeadZoneKind, string> = {
  tunnel: 'тунель',
  cutting: 'виїмка',
  manual: 'спостереження',
};

const SOURCE_LABEL: Record<DeadZoneSource, string> = {
  osm: 'OpenStreetMap',
  manual: 'ручний запис',
};

export const zoneKindLabel = (kind: DeadZoneKind) => KIND_LABEL[kind];
export const zoneSourceLabel = (source: DeadZoneSource) => SOURCE_LABEL[source];

export const zoneIcon = (severity: DeadZoneSeverity) => (severity === 'none' ? '⛔' : '⚠️');

export const zoneSeverityLabel = (severity: DeadZoneSeverity) =>
  severity === 'none' ? 'інтернету немає' : 'слабкий сигнал';

/** Коротка зона в метрах: «0.0 км» на стрічці виглядає як помилка. */
export function formatZoneLength(km: number): string {
  return km < 1 ? `${Math.round(km * 1000)} м` : `${km.toFixed(1)} км`;
}

/** Підпис на стрічці: `⛔ 2.2 км · тунель`. */
export function zoneSummary(zone: DeadZone): string {
  return `${zoneIcon(zone.severity)} ${formatZoneLength(zone.lengthKm)} · ${zoneKindLabel(zone.kind)}`;
}

/** Усі зони одним FeatureCollection — саме в такому вигляді їх їсть MapLibre. */
export function zonesToGeoJson(zones: DeadZone[]): GeoJSON.FeatureCollection<GeoJSON.LineString> {
  return {
    type: 'FeatureCollection',
    features: zones.map((zone) => ({
      type: 'Feature',
      geometry: zone.geometry,
      properties: { id: zone.id, severity: zone.severity },
    })),
  };
}

/** Середина зони по довжині — саме там стоятиме маркер. */
function midpoint(line: GeoJSON.LineString): GeoJSON.Point {
  const feature: GeoJSON.Feature<GeoJSON.LineString> = {
    type: 'Feature',
    properties: {},
    geometry: line,
  };
  const half = turfLength(feature, { units: 'kilometers' }) / 2;
  return along(feature, half, { units: 'kilometers' }).geometry;
}

/**
 * Маркери зон. Лінія зони на оглядовому зумі субпіксельна (тунель на 40 м —
 * це мікрон екрана), тож саму зону на карті видно тільки впритул. Крапка
 * фіксованого радіуса тримає всі зони маршруту видимими на будь-якому зумі.
 */
export function zoneMarkersToGeoJson(zones: DeadZone[]): GeoJSON.FeatureCollection<GeoJSON.Point> {
  return {
    type: 'FeatureCollection',
    features: zones.map((zone) => ({
      type: 'Feature',
      geometry: midpoint(zone.geometry),
      properties: { id: zone.id, severity: zone.severity, label: zoneSummary(zone) },
    })),
  };
}
