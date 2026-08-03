import raw from './demo-route.json';

export interface DemoRouteStop {
  name: string;
  lng: number;
  lat: number;
}

export interface DemoRoute {
  name: string;
  shape: GeoJSON.Feature<GeoJSON.LineString>;
  stops: DemoRouteStop[];
}

/**
 * Тимчасовий хардкод-маршрут (задача 01).
 * У задачі 02 його замінить реальний route bundle із GTFS-пайплайну.
 */
export const demoRoute = raw as DemoRoute;
