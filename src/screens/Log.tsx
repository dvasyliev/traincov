/**
 * Екран логера: сесії замірів, міні-стрічка «якість по маршруту» і експорт.
 *
 * Заміри збираються лише на екрані «Дорога» під час поїздки (трекер живе рівно
 * там), тож тут дані завжди читаються з Dexie при відкритті — жодних живих
 * підписок не треба.
 */
import { useCallback, useEffect, useState } from 'react';
import { QualityRibbon } from '../components/QualityRibbon';
import { useAppActions, useAppState } from '../app/app-state';
import {
  clearMeasurements,
  deleteLogSession,
  listLogSessions,
  listMeasurements,
  MAX_MEASUREMENTS,
} from '../core/db';
import {
  deadShare,
  exportFileName,
  medianRtt,
  sessionExport,
  type LogSession,
  type Measurement,
} from '../core/measurements';
import { PROBE_ENDPOINT } from '../core/probe';
import { shareJson } from '../core/share';
import { formatDateTime, formatKm1, formatMinutes } from '../core/format';
import { isOperatorId, operatorLabel } from '../core/operators';

export function Log() {
  const { savedTrips, logging } = useAppState();
  const { clearBundles, setLogging } = useAppActions();

  const [sessions, setSessions] = useState<LogSession[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [rows, setRows] = useState<Measurement[]>([]);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const list = await listLogSessions().catch(() => []);
    setSessions(list);
    setSelectedId((current) =>
      current && list.some((s) => s.id === current) ? current : (list[0]?.id ?? null),
    );
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  // Заміри обраної сесії тримаємо в пам'яті: їх малює стрічка, і саме вони
  // мають бути готові в момент тапу «Експорт» — share sheet не чекає на await.
  useEffect(() => {
    if (!selectedId) {
      setRows([]);
      return;
    }
    let cancelled = false;
    void listMeasurements(selectedId)
      .catch(() => [])
      .then((list) => {
        if (!cancelled) setRows(list);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  const selected = sessions?.find((s) => s.id === selectedId) ?? null;
  const total = sessions?.reduce((sum, s) => sum + s.count, 0) ?? 0;
  const rtt = medianRtt(rows);

  const onExport = async () => {
    if (!selected) return;
    const outcome = await shareJson(
      exportFileName(selected),
      sessionExport(selected, rows, Date.now()),
    );
    if (outcome === 'shared') setNote('Файл передано.');
    else if (outcome === 'downloaded') setNote(`Завантажено ${exportFileName(selected)}`);
  };

  const onDeleteSession = async () => {
    if (!selected) return;
    if (!confirm(`Видалити сесію ${formatDateTime(selected.startedAt)} (${selected.count} замірів)?`))
      return;
    setBusy(true);
    try {
      await deleteLogSession(selected.id);
      await reload();
    } finally {
      setBusy(false);
    }
  };

  const onClearLog = async () => {
    if (!confirm('Видалити всі заміри? Експортуйте те, що потрібно, перед цим.')) return;
    setBusy(true);
    try {
      await clearMeasurements();
      await reload();
      setNote('Лог замірів очищено.');
    } finally {
      setBusy(false);
    }
  };

  const onClearBundles = async () => {
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
        <div className="card__label">Збір замірів</div>
        <div className="card__value">{logging ? 'Увімкнено' : 'Вимкнено'}</div>
        <label className="switch">
          <input
            type="checkbox"
            checked={logging}
            onChange={(e) => setLogging(e.target.checked)}
          />
          <span>Міряти зв'язок у дорозі</span>
        </label>
        <div className="card__meta">
          Раз на ~10 c під час поїздки: GET на <code>{PROBE_ENDPOINT.url}</code> з таймаутом 4 c →
          RTT або фейл. ~0.3 МБ/год трафіку. Пишеться, поки відкрито екран «Дорога» і триває
          поїздка.
        </div>
      </section>

      <section className="card card--spaced">
        <div className="card__label">Накопичено</div>
        <div className="card__value">
          {total} {total === 1 ? 'замір' : 'замірів'}
        </div>
        <div className="card__meta">
          {sessions === null
            ? 'Читаємо…'
            : `${sessions.length} сесій · ротація на ${MAX_MEASUREMENTS.toLocaleString('uk-UA')} записів`}
        </div>
      </section>

      {sessions !== null && sessions.length === 0 && (
        <p className="hint">
          Замірів ще немає. Обери рейс, відкрий «Дорога» і натисни «Почати поїздку» — або
          перевір усе на симуляторі: <code>?sim=1</code>.
        </p>
      )}

      {sessions !== null && sessions.length > 0 && (
        <section className="section">
          <h2 className="section__title">Сесії</h2>
          <div className="session-list">
            {sessions.map((session) => (
              <button
                key={session.id}
                type="button"
                className={`session${session.id === selectedId ? ' session--active' : ''}`}
                onClick={() => setSelectedId(session.id)}
              >
                <span className="session__top">
                  <span className="session__date">{formatDateTime(session.startedAt)}</span>
                  {session.simulated && <span className="badge badge--muted">sim</span>}
                  {session.endedAt === null && <span className="badge badge--saved">активна</span>}
                </span>
                <span className="session__name">{session.tripName}</span>
                <span className="session__meta">
                  {session.count} замірів · {Math.round(deadShare(session) * 100)}% dead
                  {isOperatorId(session.operator) ? ` · ${operatorLabel(session.operator)}` : ''}
                </span>
              </button>
            ))}
          </div>
        </section>
      )}

      {selected && (
        <section className="section">
          <h2 className="section__title">Якість по маршруту</h2>
          <QualityRibbon measurements={rows} zones={selected.zones} lengthKm={selected.lengthKm} />

          <dl className="stats">
            <div className="stats__row">
              <dt>Тривалість</dt>
              <dd>
                {formatMinutes((selected.endedAt ?? Date.now()) - selected.startedAt)}
                {selected.endedAt === null ? ' (триває)' : ''}
              </dd>
            </div>
            <div className="stats__row">
              <dt>Заміри</dt>
              <dd>
                {selected.count} · dead {selected.deadCount} · слабких {selected.poorCount}
              </dd>
            </div>
            <div className="stats__row">
              <dt>Медіана RTT</dt>
              <dd>{rtt === null ? '—' : `${rtt} мс`}</dd>
            </div>
            <div className="stats__row">
              <dt>Покрито км</dt>
              <dd>
                {kmSpan(rows)} з {formatKm1(selected.lengthKm)} км
              </dd>
            </div>
            <div className="stats__row">
              <dt>Прогноз зон</dt>
              <dd>{selected.zones.length}</dd>
            </div>
          </dl>

          <button className="button" onClick={() => void onExport()} disabled={!rows.length}>
            Експорт JSON
          </button>
          <button className="button button--danger" onClick={() => void onDeleteSession()} disabled={busy}>
            Видалити цю сесію
          </button>
          <p className="hint hint--tight">
            Схема <code>schema: 1</code>. Кластери мертвих зон із файлу друкує{' '}
            <code>npm run analyze -- {'<file.json>'}</code> — готові сніпети для{' '}
            <code>manual-zones.json</code>.
          </p>
        </section>
      )}

      {note && <p className="hint">{note}</p>}

      <section className="card card--spaced">
        <div className="card__label">Збережені пакети</div>
        <div className="card__value">{savedTrips.length}</div>
        <div className="card__meta">Маршрутні бандли в IndexedDB — доступні офлайн.</div>
        <button
          className="button button--danger"
          onClick={() => void onClearBundles()}
          disabled={busy || savedTrips.length === 0}
        >
          Очистити всі
        </button>
        <button
          className="button button--danger"
          onClick={() => void onClearLog()}
          disabled={busy || total === 0}
        >
          Очистити лог замірів
        </button>
      </section>
    </div>
  );
}

/** `12.4–301.7` — від якого до якого км є дані. */
function kmSpan(rows: Measurement[]): string {
  const km = rows.map((r) => r.routeKm).filter((v): v is number => v !== null);
  if (!km.length) return '—';
  return `${formatKm1(Math.min(...km))}–${formatKm1(Math.max(...km))}`;
}
