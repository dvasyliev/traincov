import { useEffect, useState } from 'react';
import type { TripIndex } from '../core/types';
import { fetchData } from './http';

/** index.json маленький (десятки КБ) — кеш у пам'яті модуля; Dexie для нього — задача 07. */
let cached: TripIndex | null = null;
let inflight: Promise<TripIndex> | null = null;

/**
 * Версія даних із уже завантаженого index.json, синхронно і без мережі.
 * `null` — індексу ще немає (офлайн-старт): звіряти збережений бандл нема з чим.
 */
export function cachedDataVersion(): string | null {
  return cached?.generatedAt ?? null;
}

export function loadTripIndex(): Promise<TripIndex> {
  if (cached) return Promise.resolve(cached);
  inflight ??= fetchData<TripIndex>('index.json')
    .then((index) => {
      cached = index;
      return index;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

export type TripIndexState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; index: TripIndex };

export function useTripIndex(): TripIndexState {
  const [state, setState] = useState<TripIndexState>(() =>
    cached ? { status: 'ready', index: cached } : { status: 'loading' },
  );

  useEffect(() => {
    if (cached) return;
    let cancelled = false;

    loadTripIndex().then(
      (index) => !cancelled && setState({ status: 'ready', index }),
      (err: unknown) =>
        !cancelled &&
        setState({
          status: 'error',
          message: err instanceof Error ? err.message : String(err),
        }),
    );

    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}
