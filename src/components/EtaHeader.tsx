/**
 * Головний блок екрана поїздки: коли зникне інтернет.
 *
 * Уся логіка «що показати» живе в `core/eta-status.ts` — тут лише текст,
 * великі цифри й попередження. Компонент ререндериться раз на секунду
 * (тільки він: стрічка і карта оновлюються імперативно).
 */
import { useEffect, useRef, useState } from 'react';
import { fireAlert, primeAlerts } from '../core/alerts';
import { getSetting, setSetting } from '../core/db';
import { formatClock, formatCountdown, formatKm1, formatMinutes } from '../core/format';
import { shouldAlert, type EtaState } from '../core/eta-status';
import { formatZoneLength, zoneKindLabel } from '../core/zones';
import { useEtaState } from '../app/useEta';
import type { EtaStore } from '../core/eta-store';

/** Скільки світиться хедер після попередження. */
const FLASH_MS = 4000;

function useAlertsEnabled(): [boolean, (value: boolean) => void] {
  const [enabled, setEnabled] = useState(true);

  useEffect(() => {
    let alive = true;
    void getSetting('etaAlerts').then((value) => {
      if (alive && typeof value === 'boolean') setEnabled(value);
    });
    return () => {
      alive = false;
    };
  }, []);

  return [
    enabled,
    (value: boolean) => {
      setEnabled(value);
      void setSetting('etaAlerts', value);
    },
  ];
}

export function EtaHeader({ store }: { store: EtaStore }) {
  const state = useEtaState(store);
  const [alerts, setAlerts] = useAlertsEnabled();
  const [flash, setFlash] = useState(false);
  /** Зона, про яку вже попередили: сигнал має спрацювати рівно раз. */
  const alertedRef = useRef<string | null>(null);

  useEffect(() => {
    // Попереду вже інша зона — попередження для неї ще не було.
    if (alertedRef.current !== null && state.zone?.id !== alertedRef.current) {
      alertedRef.current = null;
    }
    if (!alerts || !shouldAlert(state, alertedRef.current)) return;
    alertedRef.current = state.zone?.id ?? null;
    fireAlert();
    setFlash(true);
  }, [alerts, state]);

  // Окремим ефектом: стан оновлюється щосекунди, і спільний cleanup гасив би
  // таймер флеша ще до того, як той спрацює.
  useEffect(() => {
    if (!flash) return;
    const timer = setTimeout(() => setFlash(false), FLASH_MS);
    return () => clearTimeout(timer);
  }, [flash]);

  const toggleAlerts = () => {
    if (!alerts) primeAlerts();
    setAlerts(!alerts);
  };

  return (
    <div className={`eta eta--${state.kind}${flash ? ' eta--flash' : ''}`}>
      <div className="eta__top">
        <span className="eta__title">{title(state)}</span>
        <button
          type="button"
          className={`eta__bell ${alerts ? 'eta__bell--on' : ''}`}
          aria-pressed={alerts}
          aria-label={alerts ? 'Вимкнути попередження про діри' : 'Увімкнути попередження про діри'}
          onClick={toggleAlerts}
        >
          {alerts ? '🔔' : '🔕'}
        </button>
      </div>

      {state.countdownMs !== null && (
        <div className="eta__big">
          {state.kind === 'zone-far'
            ? formatMinutes(state.countdownMs)
            : formatCountdown(state.countdownMs)}
        </div>
      )}

      <div className="eta__meta">{meta(state)}</div>
    </div>
  );
}

function title(state: EtaState): string {
  switch (state.kind) {
    case 'in-zone':
      return '⛔ Мертва зона · чекаємо сигнал';
    case 'zone-soon':
      return '🟡 Інтернет зникне через';
    case 'zone-far':
      return '🟢 Наступна діра через';
    case 'no-zones':
      return '🟢 До кінця маршруту дір не відомо';
    case 'idle':
      return 'Прогноз недоступний';
  }
}

function meta(state: EtaState): string {
  const marks: string[] = [];

  if (state.kind === 'in-zone') {
    if (state.zone) marks.push(`${formatZoneLength(state.zone.lengthKm)} · ${zoneKindLabel(state.zone.kind)}`);
    if (state.at !== null) marks.push(`сигнал ~${formatClock(state.at)}`);
  } else if (state.zone) {
    marks.push(`о ${formatClock(state.at)}`);
    marks.push(`діра ~${formatMinutes(state.durationMs)}`);
    marks.push(`${formatKm1(state.zone.fromKm)}–${formatKm1(state.zone.toKm)} км`);
    marks.push(zoneKindLabel(state.zone.kind));
  } else if (state.kind === 'no-zones') {
    marks.push('це не гарантія покриття — просто немає даних');
  } else if (state.kind === 'idle') {
    marks.push('немає ні позиції, ні читабельного розкладу');
  }

  if (state.scheduled && state.kind !== 'idle') marks.push('за розкладом');
  return marks.join(' · ');
}
