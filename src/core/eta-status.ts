/**
 * Стан хедера поїздки — окремо від React, бо це єдине місце, де вирішується,
 * що саме бачить користувач у дорозі, і його треба вміти тестувати.
 *
 * Розрахунок ETA важкий і робиться на GPS-фікс; ця функція — навпаки, дешева
 * і крутиться раз на секунду, щоб лічильник цокав рівно між фіксами.
 */
import type { EtaResult } from './eta';
import type { DeadZone } from './types';

/** Ближче цього до діри показуємо великий mm:ss замість «через 38 хв». */
export const ZONE_SOON_MS = 10 * 60_000;
/** За скільки до діри попереджаємо вібрацією і звуком. */
export const ALERT_LEAD_MS = 2 * 60_000;

export type EtaStateKind =
  /** Прогнозу ще немає (немає бандла/розкладу). */
  | 'idle'
  /** Ми в дірі — рахуємо до повернення сигналу. */
  | 'in-zone'
  | 'zone-soon'
  | 'zone-far'
  /** Попереду до кінця маршруту дір не відомо. */
  | 'no-zones';

export interface EtaState {
  kind: EtaStateKind;
  /** Мс до події (в'їзд у діру або вихід із неї); `null` — події немає. */
  countdownMs: number | null;
  /** Час події, ms epoch. */
  at: number | null;
  zone: DeadZone | null;
  /** Скільки триватиме діра, мс; `null` — коли ми вже всередині і початок невідомий. */
  durationMs: number | null;
  /** Прогноз без живої швидкості: підписуємо «за розкладом». */
  scheduled: boolean;
}

const IDLE: EtaState = {
  kind: 'idle',
  countdownMs: null,
  at: null,
  zone: null,
  durationMs: null,
  scheduled: false,
};

export function etaState(result: EtaResult | null, now: number): EtaState {
  if (!result) return IDLE;
  const scheduled = result.source !== 'gps';

  if (result.inZone) {
    return {
      kind: 'in-zone',
      countdownMs: Math.max(0, result.inZone.etaOut - now),
      at: result.inZone.etaOut,
      zone: result.inZone.zone,
      durationMs: null,
      scheduled,
    };
  }

  if (result.nextZone) {
    const { zone, etaIn, etaOut } = result.nextZone;
    const countdownMs = Math.max(0, etaIn - now);
    return {
      kind: countdownMs <= ZONE_SOON_MS ? 'zone-soon' : 'zone-far',
      countdownMs,
      at: etaIn,
      zone,
      durationMs: Math.max(0, etaOut - etaIn),
      scheduled,
    };
  }

  return { ...IDLE, kind: 'no-zones', scheduled };
}

/**
 * Чи час попереджати про діру. Стан «вже попередили» тримає викликач:
 * попередження прив'язане до конкретної зони і має спрацювати рівно раз.
 */
export function shouldAlert(state: EtaState, alertedZoneId: string | null): boolean {
  if (state.kind !== 'zone-soon' || !state.zone || state.countdownMs === null) return false;
  if (state.zone.id === alertedZoneId) return false;
  return state.countdownMs <= ALERT_LEAD_MS;
}
