/**
 * Оновлення апки — вручну і тільки поза поїздкою.
 *
 * `registerType: 'prompt'` у vite.config.ts означає: новий service worker чекає,
 * поки ми самі скажемо `updateSW()`. Це навмисно: `autoUpdate` перезавантажив би
 * вкладку посеред дороги — тобто рівно тоді, коли апка єдиний раз і потрібна.
 */
import { useSyncExternalStore } from 'react';
import { registerSW } from 'virtual:pwa-register';

interface UpdateState {
  /** Нова версія завантажена й чекає активації. */
  needRefresh: boolean;
  /** SW закешував app shell — апка переживе airplane mode. */
  offlineReady: boolean;
}

let state: UpdateState = { needRefresh: false, offlineReady: false };
const listeners = new Set<() => void>();

function patch(next: Partial<UpdateState>): void {
  state = { ...state, ...next };
  for (const listener of listeners) listener();
}

// Реєструємо один раз на модуль: SW — глобальний ресурс, не стан компонента.
const updateSW = registerSW({
  immediate: true,
  onNeedRefresh: () => patch({ needRefresh: true }),
  onOfflineReady: () => patch({ offlineReady: true }),
});

export function applyAppUpdate(): void {
  // true → SW бере контроль і перезавантажує сторінку.
  void updateSW(true);
}

export function useAppUpdate(): UpdateState {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => state,
  );
}
