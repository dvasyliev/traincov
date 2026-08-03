import { useEffect, useRef, useState } from 'react';
import {
  MapLibreMap,
  Marker,
  NavigationControl,
  Popup,
  setWorkerUrl,
  type ExpressionSpecification,
  type LngLatBoundsLike,
  type StyleSpecification,
} from 'maplibre-gl';
// maplibre-gl 6 шукає свій воркер як файл-сусід поруч зі своїм import.meta.url.
// Після бандлінгу такого сусіда не існує → воркер мовчки падає, і GeoJSON-джерела
// ніколи не парсяться (карта є, лінії немає). Тому вказуємо URL воркера явно.
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import { bbox } from '@turf/turf';
import 'maplibre-gl/dist/maplibre-gl.css';
import { ZONE_COLOR, zoneMarkersToGeoJson, zonesToGeoJson } from '../core/zones';
import type { DeadZone, RouteStop } from '../core/types';
import type { TripTracker } from '../core/trip-tracker';

setWorkerUrl(maplibreWorkerUrl);

const ROUTE_SOURCE = 'route';
const ROUTE_LAYER = 'route-line';
const ROUTE_COLOR = '#e11d48';
const ZONE_SOURCE = 'zones';
const ZONE_LAYER = 'zone-line';
const ZONE_MARKER_SOURCE = 'zone-markers';
const ZONE_MARKER_LAYER = 'zone-marker';
const FIT_PADDING = 40;

/** Колір за severity — один вираз на всі шари зон. */
const ZONE_COLOR_EXPRESSION: ExpressionSpecification = [
  'match',
  ['get', 'severity'],
  'weak',
  ZONE_COLOR.weak,
  ZONE_COLOR.none,
];

/** Уся Польща — запасний кадр, якщо маршруту ще немає. */
const POLAND_CENTER: [number, number] = [19.0, 51.7];
const POLAND_ZOOM = 5.5;

/**
 * Растровий OSM — тимчасово. У задачі 07 його замінить PMTiles,
 * тому вся робота з картою має жити тільки в цьому компоненті.
 */
const RASTER_OSM_STYLE: StyleSpecification = {
  version: 8,
  sources: {
    osm: {
      type: 'raster',
      tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
      tileSize: 256,
      maxzoom: 19,
      attribution: '© OpenStreetMap contributors',
    },
  },
  layers: [{ id: 'osm', type: 'raster', source: 'osm' }],
};

function routeBounds(route: GeoJSON.Feature<GeoJSON.LineString>): LngLatBoundsLike {
  const [minX, minY, maxX, maxY] = bbox(route);
  return [
    [minX, minY],
    [maxX, maxY],
  ];
}

/** Зум, на який переходимо, коли вмикається слідування за позицією. */
const FOLLOW_ZOOM = 12;
const FOLLOW_EASE_MS = 900;

export interface MapProps {
  route?: GeoJSON.Feature<GeoJSON.LineString>;
  stops?: RouteStop[];
  /** Готові шматки колії з пайплайна — клієнт нічого не ріже. */
  zones?: DeadZone[];
  onZoneSelect?: (zone: DeadZone) => void;
  /** Джерело позиції; маркер оновлюється імперативно, без ререндера. */
  tracker?: TripTracker;
}

export function Map({ route, stops, zones, onZoneSelect, tracker }: MapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const [follow, setFollow] = useState(true);
  const followRef = useRef(follow);
  followRef.current = follow;
  /** Ручний «перецентруйся зараз» — ефект карти публікує сюди свій обробник. */
  const applyRef = useRef<(() => void) | null>(null);
  // Через ref, а не через deps: інакше кожен ререндер батька перестворював би карту.
  const zoneSelectRef = useRef(onZoneSelect);
  zoneSelectRef.current = onZoneSelect;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // Кадр рахуємо ДО створення мапи: fitBounds після 'load' залежить від того,
    // чи вже виміряний контейнер, і на повільному старті може не спрацювати.
    const map = new MapLibreMap({
      container,
      style: RASTER_OSM_STYLE,
      attributionControl: { compact: true },
      ...(route
        ? { bounds: routeBounds(route), fitBoundsOptions: { padding: FIT_PADDING } }
        : { center: POLAND_CENTER, zoom: POLAND_ZOOM }),
    });
    mapRef.current = map;

    map.addControl(new NavigationControl({ showCompass: false }), 'top-right');

    const markers: Marker[] = [];
    for (const stop of stops ?? []) {
      const el = document.createElement('div');
      el.className = 'stop-marker';
      el.title = stop.name;
      markers.push(
        new Marker({ element: el })
          .setLngLat([stop.lng, stop.lat])
          .setPopup(new Popup({ offset: 12 }).setText(stop.name))
          .addTo(map),
      );
    }

    // Джерела й шари можна додавати лише після завантаження стилю.
    const addRouteLayer = () => {
      if (!route || map.getSource(ROUTE_SOURCE)) return;
      map.addSource(ROUTE_SOURCE, { type: 'geojson', data: route });
      map.addLayer({
        id: ROUTE_LAYER,
        type: 'line',
        source: ROUTE_SOURCE,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': ROUTE_COLOR, 'line-width': 4 },
      });

      if (!zones?.length) return;
      // Поверх маршруту й ширше за нього — зона має читатись першою.
      map.addSource(ZONE_SOURCE, { type: 'geojson', data: zonesToGeoJson(zones) });
      map.addLayer({
        id: ZONE_LAYER,
        type: 'line',
        source: ZONE_SOURCE,
        layout: { 'line-cap': 'butt', 'line-join': 'round' },
        paint: {
          'line-color': ZONE_COLOR_EXPRESSION,
          'line-width': 9,
          'line-opacity': 0.85,
        },
      });

      // Крапки — щоб усі зони маршруту було видно одразу, без зуму.
      map.addSource(ZONE_MARKER_SOURCE, {
        type: 'geojson',
        data: zoneMarkersToGeoJson(zones),
        // Кластеризації немає свідомо: злиплі крапки все одно кликабельні,
        // а «17 зон» замість самих зон нічого не пояснює.
      });
      map.addLayer({
        id: ZONE_MARKER_LAYER,
        type: 'circle',
        source: ZONE_MARKER_SOURCE,
        paint: {
          'circle-color': ZONE_COLOR_EXPRESSION,
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 5, 4, 10, 6, 14, 9],
          'circle-stroke-width': 2,
          'circle-stroke-color': '#0b1120',
        },
      });
    };

    if (map.isStyleLoaded()) addRouteLayer();
    else map.on('style.load', addRouteLayer);

    // Не `new Map(...)`: у цьому файлі `Map` — це наш компонент, а не колекція.
    const byId: Record<string, DeadZone> = {};
    for (const zone of zones ?? []) byId[zone.id] = zone;

    const onZoneClick = (e: { features?: { properties?: Record<string, unknown> }[] }) => {
      const id = e.features?.[0]?.properties?.id;
      const zone = typeof id === 'string' ? byId[id] : undefined;
      if (zone) zoneSelectRef.current?.(zone);
    };
    const setCursor = (value: string) => () => {
      map.getCanvas().style.cursor = value;
    };
    for (const layer of [ZONE_LAYER, ZONE_MARKER_LAYER]) {
      map.on('click', layer, onZoneClick);
      map.on('mouseenter', layer, setCursor('pointer'));
      map.on('mouseleave', layer, setCursor(''));
    }

    // Маркер «я»: показуємо snapped-точку, щоб він не гуляв поруч із колією.
    const meEl = document.createElement('div');
    meEl.className = 'me-marker';
    meEl.style.display = 'none';
    const me = new Marker({ element: meEl, pitchAlignment: 'map' })
      .setLngLat(POLAND_CENTER)
      .addTo(map);

    let lastEaseTs = 0;
    const applyPosition = () => {
      const snapshot = tracker?.getSnapshot();
      if (!snapshot?.snapped) {
        meEl.style.display = 'none';
        return;
      }
      meEl.style.display = '';
      meEl.dataset.status = snapshot.status;
      me.setLngLat(snapshot.snapped);
      if (!followRef.current) return;
      // Фікси йдуть частіше, ніж триває анімація; без тротлінга камера смикається.
      const now = Date.now();
      if (now - lastEaseTs < FOLLOW_EASE_MS) return;
      lastEaseTs = now;
      map.easeTo({
        center: snapshot.snapped,
        zoom: Math.max(map.getZoom(), FOLLOW_ZOOM),
        duration: FOLLOW_EASE_MS,
      });
    };

    applyRef.current = () => {
      lastEaseTs = 0;
      applyPosition();
    };
    applyPosition();
    const unsubscribe = tracker?.subscribe(applyPosition);

    // Драг карти = «я сам дивлюсь» → слідування вимикаємо, як у навігаторах.
    const onDragStart = () => {
      if (followRef.current) setFollow(false);
    };
    map.on('dragstart', onDragStart);

    return () => {
      unsubscribe?.();
      map.off('dragstart', onDragStart);
      applyRef.current = null;
      me.remove();
      for (const marker of markers) marker.remove();
      map.remove();
      mapRef.current = null;
    };
  }, [route, stops, zones, tracker]);

  return (
    <div className="map-wrap">
      <div ref={containerRef} className="map-container" />
      {tracker && (
        <button
          type="button"
          className={`map-follow ${follow ? 'map-follow--on' : ''}`}
          onClick={() => {
            const next = !follow;
            followRef.current = next;
            setFollow(next);
            if (next) applyRef.current?.();
          }}
        >
          {follow ? '🎯 слідкую' : '🎯 слідкувати'}
        </button>
      )}
    </div>
  );
}
