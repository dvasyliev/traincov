import { useState } from 'react';
import { useAppActions, useAppState } from '../app/app-state';

export function Log() {
  const { savedTripIds } = useAppState();
  const { clearBundles } = useAppActions();
  const [busy, setBusy] = useState(false);

  const onClear = async () => {
    if (!confirm('Видалити всі збережені пакети маршрутів?')) return;
    setBusy(true);
    try {
      await clearBundles();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="screen screen--padded">
      <h1 className="title">Логер</h1>
      <p className="subtitle">Заміри якості зв'язку</p>

      <section className="card">
        <div className="card__label">Статус</div>
        <div className="card__value">Вимкнено</div>
        <div className="card__meta">Probe RTT + експорт JSON з'являться в задачі 08.</div>
      </section>

      <section className="card card--spaced">
        <div className="card__label">Збережені пакети</div>
        <div className="card__value">{savedTripIds.length}</div>
        <div className="card__meta">Маршрутні бандли в IndexedDB — доступні офлайн.</div>
        <button
          className="button button--danger"
          onClick={onClear}
          disabled={busy || savedTripIds.length === 0}
        >
          {busy ? 'Видалення…' : 'Очистити всі'}
        </button>
      </section>
    </div>
  );
}
