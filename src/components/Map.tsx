import { useEffect, useRef } from 'react';
import {
  MapLibreMap,
  Marker,
  NavigationControl,
  Popup,
  setWorkerUrl,
  type LngLatBoundsLike,
  type StyleSpecification,
} from 'maplibre-gl';
// maplibre-gl 6 шукає свій воркер як файл-сусід поруч зі своїм import.meta.url.
// Після бандлінгу такого сусіда не існує → воркер мовчки падає, і GeoJSON-джерела
// ніколи не парсяться (карта є, лінії немає). Тому вказуємо URL воркера явно.
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import { bbox } from '@turf/turf';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { RouteStop } from '../core/types';

setWorkerUrl(maplibreWorkerUrl);

const ROUTE_SOURCE = 'route';
const ROUTE_LAYER = 'route-line';
const ROUTE_COLOR = '#e11d48';
const FIT_PADDING = 40;

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

export interface MapProps {
  route?: GeoJSON.Feature<GeoJSON.LineString>;
  stops?: RouteStop[];
}

export function Map({ route, stops }: MapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);

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
    };

    if (map.isStyleLoaded()) addRouteLayer();
    else map.on('style.load', addRouteLayer);

    return () => {
      for (const marker of markers) marker.remove();
      map.remove();
      mapRef.current = null;
    };
  }, [route, stops]);

  return <div ref={containerRef} className="map-container" />;
}
