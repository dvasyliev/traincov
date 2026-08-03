import type { TripIndexEntry } from '../core/types';
import { formatKm, formatTime } from '../core/format';

export interface TripCardProps {
  entry: TripIndexEntry;
  saved: boolean;
  loading: boolean;
  /** Офлайн і пакета немає в Dexie — завантажити його зараз неможливо. */
  unavailable: boolean;
  current: boolean;
  onSelect: (entry: TripIndexEntry) => void;
}

export function TripCard({ entry, saved, loading, unavailable, current, onSelect }: TripCardProps) {
  const className = [
    'trip-card',
    current && 'trip-card--current',
    unavailable && 'trip-card--unavailable',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <button
      type="button"
      className={className}
      disabled={loading || unavailable}
      onClick={() => onSelect(entry)}
    >
      <div className="trip-card__top">
        <span className="trip-card__carrier">{entry.carrier}</span>
        <span className="trip-card__name">{entry.name}</span>
      </div>
      <div className="trip-card__times">
        {formatTime(entry.dep)} → {formatTime(entry.arr)}
      </div>
      <div className="trip-card__meta">
        {entry.fromStop} → {entry.toStop}
      </div>
      <div className="trip-card__meta">
        {formatKm(entry.lengthKm)} · {entry.stopCount} зупинок · {entry.zonesCount ?? 0} зон ·{' '}
        {entry.sizeKb} КБ
        {saved && <span className="badge badge--saved">збережено</span>}
        {loading && <span className="badge">завантаження…</span>}
        {unavailable && !loading && <span className="badge badge--muted">офлайн</span>}
      </div>
    </button>
  );
}
