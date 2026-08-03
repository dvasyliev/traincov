/**
 * Швидкість потяга з потоку позицій. Чистий модуль без React і без DOM.
 *
 * Kalman у MVP не потрібен: EMA + монотонний km з linref дають достатньо
 * стабільну цифру, а головний споживач (задача 06) і так згладжує прогноз.
 */

export type SpeedConfidence =
  /** `position.coords.speed` — найточніше, приходить із чіпа. */
  | 'gps'
  /** Похідна Δkm/Δt — Android у WebView часто віддає `speed: null`. */
  | 'derived'
  /** Фіксів давно немає (тунель) або їх ще замало. */
  | 'none';

export interface SpeedFix {
  ts: number;
  /** Км уздовж маршруту (вже монотонний — з linref). */
  km: number;
  /** `coords.speed`, м/с; `null` — якщо пристрій не дає. */
  gpsSpeedMs: number | null;
  accuracyM: number;
}

export interface SpeedState {
  speedKmh: number | null;
  confidence: SpeedConfidence;
  /** Стоїмо на станції/семафорі — важливо для прогнозу в задачі 06. */
  stopped: boolean;
  /**
   * Відколи швидкість нижча за поріг, ms epoch; `null` — коли їдемо.
   * Прогноз віднімає це від планової стоянки: стоїмо довше плану — час тече далі.
   */
  stoppedSince: number | null;
}

/** ~30 c сталої часу при тіку 5 c. */
const EMA_ALPHA = 0.15;
const MAX_KMH = 220;
/** Гірший `accuracy`, ніж цей, робить `coords.speed` сміттям. */
const GPS_ACCURACY_LIMIT_M = 100;
const STOPPED_KMH = 3;
const STOPPED_HOLD_MS = 20_000;
/** Без фіксів довше цього — GPS зник (у тунелі він зникає теж). */
export const STALE_FIX_MS = 30_000;
/** Занадто короткий інтервал → Δkm/Δt вибухає на шумі. */
const MIN_DERIVED_DT_MS = 1_000;
/** Занадто довгий → це вже не «поточна» швидкість, а середня за півперегону. */
const MAX_DERIVED_DT_MS = 60_000;

export interface SpeedEstimator {
  /** Новий фікс → стан. */
  push(fix: SpeedFix): SpeedState;
  /** Стан «зараз» без нового фікса: ловить протухання (тунель). */
  state(now: number): SpeedState;
  reset(): void;
}

export function createSpeedEstimator(): SpeedEstimator {
  let ema: number | null = null;
  let confidence: SpeedConfidence = 'none';
  let lastTs: number | null = null;
  let lastKm: number | null = null;
  let slowSince: number | null = null;
  let stopped = false;

  function current(): SpeedState {
    return {
      speedKmh: ema === null ? null : Math.round(ema * 10) / 10,
      confidence,
      stopped,
      stoppedSince: stopped ? slowSince : null,
    };
  }

  return {
    push(fix) {
      const dt = lastTs === null ? null : fix.ts - lastTs;
      let raw: number | null = null;

      if (fix.gpsSpeedMs !== null && Number.isFinite(fix.gpsSpeedMs) && fix.gpsSpeedMs >= 0) {
        if (fix.accuracyM <= GPS_ACCURACY_LIMIT_M) {
          raw = fix.gpsSpeedMs * 3.6;
          confidence = 'gps';
        }
      }
      if (raw === null && dt !== null && dt >= MIN_DERIVED_DT_MS && dt <= MAX_DERIVED_DT_MS) {
        raw = ((fix.km - (lastKm as number)) / dt) * 3_600_000;
        confidence = 'derived';
      }

      lastTs = fix.ts;
      lastKm = fix.km;

      if (raw === null) {
        // Перший фікс або надто рідкі оновлення: показувати нічого, але й не панікувати.
        if (ema === null) confidence = 'none';
        return current();
      }

      const clamped = Math.min(MAX_KMH, Math.max(0, raw));
      ema = ema === null ? clamped : ema + EMA_ALPHA * (clamped - ema);

      if (ema < STOPPED_KMH) {
        slowSince ??= fix.ts;
        stopped = fix.ts - slowSince >= STOPPED_HOLD_MS;
      } else {
        slowSince = null;
        stopped = false;
      }

      return current();
    },

    state(now) {
      if (lastTs === null)
        return { speedKmh: null, confidence: 'none', stopped: false, stoppedSince: null };
      // Швидкість лишаємо останню відому — вона чесніша за нуль, поки потяг у тунелі.
      if (now - lastTs > STALE_FIX_MS) return { ...current(), confidence: 'none' };
      return current();
    },

    reset() {
      ema = null;
      confidence = 'none';
      lastTs = null;
      lastKm = null;
      slowSince = null;
      stopped = false;
    },
  };
}
