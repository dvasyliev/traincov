/**
 * Wake Lock: у режимі поїздки екран не має гаснути — телефон лежить на столику,
 * а countdown до діри цінний саме тоді, коли на нього не дивляться впритул.
 *
 * Дві незручності API, які тут і закриті:
 * 1. Система знімає лок щоразу, коли вкладка йде у фон → `visibilitychange`
 *    і повторний захват при поверненні.
 * 2. `wakeLock` немає в Safari < 16.4 і в WebView → UI має чесно сказати
 *    «вимкни автоблокування вручну», а не мовчки нічого не робити.
 */

export type WakeLockStatus =
  /** API немає — лишається тільки текстова порада користувачу. */
  | 'unsupported'
  /** Не просили (поїздка не запущена). */
  | 'idle'
  /** Лок утримується. */
  | 'active'
  /** Просили, але браузер відмовив (фон, батарея, політика). */
  | 'failed';

export const wakeLockSupported =
  typeof navigator !== 'undefined' && 'wakeLock' in navigator;

let sentinel: WakeLockSentinel | null = null;
/** Чого хоче апка — на відміну від того, що зараз реально утримується. */
let wanted = false;
let status: WakeLockStatus = wakeLockSupported ? 'idle' : 'unsupported';
const listeners = new Set<() => void>();

function setStatus(next: WakeLockStatus): void {
  if (status === next) return;
  status = next;
  for (const listener of listeners) listener();
}

export function getWakeLockStatus(): WakeLockStatus {
  return status;
}

export function subscribeWakeLock(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

async function acquire(): Promise<void> {
  if (!wanted || sentinel || document.visibilityState !== 'visible') return;
  try {
    sentinel = await navigator.wakeLock.request('screen');
    // Лок може зникнути й без нашої участі — тоді статус має це показати.
    sentinel.addEventListener('release', () => {
      sentinel = null;
      if (wanted) setStatus(document.visibilityState === 'visible' ? 'failed' : 'idle');
    });
    setStatus('active');
  } catch {
    sentinel = null;
    setStatus('failed');
  }
}

function onVisibilityChange(): void {
  if (document.visibilityState === 'visible') void acquire();
}

/** Вмикається на старті поїздки, вимикається на стопі. Ідемпотентна. */
export async function keepAwake(on: boolean): Promise<void> {
  if (!wakeLockSupported) return;
  wanted = on;

  if (on) {
    document.addEventListener('visibilitychange', onVisibilityChange);
    await acquire();
    return;
  }

  document.removeEventListener('visibilitychange', onVisibilityChange);
  setStatus('idle');
  const current = sentinel;
  sentinel = null;
  await current?.release().catch(() => {});
}
