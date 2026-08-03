import { useEffect, useState } from 'react';

/**
 * `navigator.onLine` бреше в один бік: `true` не гарантує інтернету.
 * Але `false` (airplane mode) — надійний, а саме він нам і потрібен,
 * щоб чесно сказати «новий пакет зараз не завантажити».
 */
export function useOnlineStatus(): boolean {
  const [online, setOnline] = useState(() => navigator.onLine);

  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);

  return online;
}
