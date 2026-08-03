import type { RouteBundle } from '../core/types';
import { fetchData } from './http';

/** `file` — шлях відносно `public/data/`, як його записав пайплайн в index.json. */
export const loadRouteBundle = (file: string) => fetchData<RouteBundle>(file);
