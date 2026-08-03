/**
 * Активне зондування мережі.
 *
 * Браузер не дає рівень сигналу (dBm), а `navigator.connection` є лише в
 * Chrome/Android. Тому «є інтернет чи ні» ми не питаємо, а перевіряємо:
 * маленький GET із таймаутом → RTT або фейл.
 *
 * Чого свідомо НЕ робимо: не міряємо bandwidth. Важкі завантаження їдять
 * трафік і батарею, а для відповіді «є/нема» досить RTT і факту втрати.
 */
import { measurementQuality, type ProbeQuality } from './measurements';

export const PROBE_TIMEOUT_MS = 4000;

export interface ProbeEndpoint {
  url: string;
  /**
   * Ендпоінт віддає `Access-Control-Allow-Origin` — тоді видно реальний статус.
   * Інакше йдемо `mode: 'no-cors'`: відповідь непрозора, але сам факт її появи
   * і час до неї вже дають те, що треба.
   */
  cors: boolean;
}

/**
 * Рекомендований шлях — власний ендпоінт (`VITE_PROBE_URL`, наприклад
 * `https://probe.example.com/ping`, що віддає 204 + `ACAO: *`): нульова вартість,
 * повний контроль, і в v2 той самий Worker прийматиме заміри.
 *
 * Дефолт — гуглівський `generate_204`. Він CORS-заголовків НЕ віддає (перевірено),
 * тому тільки `no-cors`: RTT чесний, але редірект captive-порталу від справжньої
 * відповіді не відрізнити. Це і є головна причина мати свій ендпоінт.
 */
const FALLBACK_ENDPOINT: ProbeEndpoint = {
  url: 'https://www.gstatic.com/generate_204',
  cors: false,
};

function configuredEndpoint(): ProbeEndpoint {
  const url = import.meta.env?.VITE_PROBE_URL;
  return typeof url === 'string' && url ? { url, cors: true } : FALLBACK_ENDPOINT;
}

export const PROBE_ENDPOINT: ProbeEndpoint = configuredEndpoint();

export interface ProbeResult {
  ok: boolean;
  /** Мс до відповіді; `null` — відповіді не було. */
  rttMs: number | null;
  ts: number;
}

/**
 * `AbortSignal.timeout` — Safari ≥ 16, а апка має працювати і на старших:
 * там збираємо той самий ефект руками.
 */
function timeoutSignal(timeoutMs: number): { signal: AbortSignal; cancel: () => void } {
  if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
    return { signal: AbortSignal.timeout(timeoutMs), cancel: () => {} };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return { signal: controller.signal, cancel: () => clearTimeout(timer) };
}

export function probeQuality(result: ProbeResult): ProbeQuality {
  return measurementQuality(result.ok, result.rttMs);
}

/**
 * Один замір. Ніколи не кидає: фейл — це теж результат, і саме він найцінніший.
 *
 * `cache: 'no-store'` + кеш-бастер `?t=` обов'язкові: інакше SW або HTTP-кеш
 * відповість із кеша, і RTT буде брехнею (0 мс посеред мертвої зони).
 */
export async function probe(
  timeoutMs = PROBE_TIMEOUT_MS,
  endpoint: ProbeEndpoint = PROBE_ENDPOINT,
): Promise<ProbeResult> {
  const ts = Date.now();
  const started = performance.now();
  const { signal, cancel } = timeoutSignal(timeoutMs);
  const url = `${endpoint.url}${endpoint.url.includes('?') ? '&' : '?'}t=${ts}`;

  try {
    const response = await fetch(url, {
      method: 'GET',
      cache: 'no-store',
      mode: endpoint.cors ? 'cors' : 'no-cors',
      credentials: 'omit',
      signal,
    });
    // У no-cors відповідь opaque: `status` завжди 0, тож перевіряти нічого —
    // сам факт, що fetch дорезолвився, і означає «мережа є».
    if (endpoint.cors && !response.ok) return { ok: false, rttMs: null, ts };
    return { ok: true, rttMs: Math.round(performance.now() - started), ts };
  } catch {
    // Airplane mode, таймаут, DNS — усе це один і той самий факт: інтернету немає.
    return { ok: false, rttMs: null, ts };
  } finally {
    cancel();
  }
}
