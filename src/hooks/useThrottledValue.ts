import { useEffect, useRef, useState } from 'react';

/**
 * Значення, яке оновлюється не частіше ніж раз на `intervalMs`.
 *
 * Для міток часу на стрічці: перерендер списку дешевий, але цифри, що
 * смикаються щосекунди, читати в дорозі неможливо.
 */
export function useThrottledValue<T>(value: T, intervalMs: number): T {
  const [throttled, setThrottled] = useState(value);
  const lastAt = useRef(0);

  useEffect(() => {
    const elapsed = Date.now() - lastAt.current;
    if (elapsed >= intervalMs) {
      lastAt.current = Date.now();
      setThrottled(value);
      return;
    }
    const timer = setTimeout(() => {
      lastAt.current = Date.now();
      setThrottled(value);
    }, intervalMs - elapsed);
    return () => clearTimeout(timer);
  }, [value, intervalMs]);

  return throttled;
}
