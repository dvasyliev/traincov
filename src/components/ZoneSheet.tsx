/**
 * Bottom-sheet із деталями мертвої зони: звідки взялася, скільки триває, примітка.
 * Джерело показуємо явно — «OSM» і «моє спостереження» мають різну ціну довіри.
 */
import { useEffect } from 'react';
import { formatKm1 } from '../core/format';
import {
  formatZoneLength,
  zoneIcon,
  zoneKindLabel,
  zoneSeverityLabel,
  zoneSourceLabel,
} from '../core/zones';
import type { DeadZone } from '../core/types';

export interface ZoneSheetProps {
  zone: DeadZone | null;
  onClose: () => void;
}

export function ZoneSheet({ zone, onClose }: ZoneSheetProps) {
  useEffect(() => {
    if (!zone) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [zone, onClose]);

  if (!zone) return null;

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      {/* Кліки всередині картки не мають закривати шит. */}
      <div
        className={`sheet sheet--${zone.severity}`}
        role="dialog"
        aria-modal="true"
        aria-label="Мертва зона"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sheet__grip" />
        <div className="sheet__title">
          {zoneIcon(zone.severity)} {zoneSeverityLabel(zone.severity)}
        </div>
        <div className="sheet__big">{formatZoneLength(zone.lengthKm)}</div>
        <dl className="sheet__rows">
          <div className="sheet__row">
            <dt>Ділянка</dt>
            <dd>
              {formatKm1(zone.fromKm)} → {formatKm1(zone.toKm)} км
            </dd>
          </div>
          <div className="sheet__row">
            <dt>Тип</dt>
            <dd>{zoneKindLabel(zone.kind)}</dd>
          </div>
          <div className="sheet__row">
            <dt>Джерело</dt>
            <dd>{zoneSourceLabel(zone.source)}</dd>
          </div>
        </dl>
        {zone.note && <p className="sheet__note">{zone.note}</p>}
        <button type="button" className="button" onClick={onClose}>
          Закрити
        </button>
      </div>
    </div>
  );
}
