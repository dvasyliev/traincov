import { useSyncExternalStore, useEffect } from 'react';
import {
  getWakeLockStatus,
  keepAwake,
  subscribeWakeLock,
  type WakeLockStatus,
} from '../core/wakelock';

/**
 * Тримає екран увімкненим, поки `active`. Знімає лок на розмонтуванні —
 * інакше вихід з екрана поїздки лишав би телефон світитись до розрядки.
 */
export function useWakeLock(active: boolean): WakeLockStatus {
  useEffect(() => {
    void keepAwake(active);
    return () => {
      if (active) void keepAwake(false);
    };
  }, [active]);

  return useSyncExternalStore(subscribeWakeLock, getWakeLockStatus);
}
