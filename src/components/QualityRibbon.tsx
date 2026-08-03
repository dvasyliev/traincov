/**
 * Міні-стрічка «якість по маршруту» — перша фактична карта покриття поїздки.
 *
 * Сірі смуги — прогнозовані мертві зони (з пайплайна, «сфотографовані» на старті
 * сесії). Кольорові тики — факт. Розбіжність між ними і є те, заради чого логер
 * узагалі існує: кожен червоний тик поза сірою смугою — кандидат у
 * `manual-zones.json`.
 */
import { useMemo } from 'react';
import {
  QUALITY_COLOR,
  QUALITY_LABEL,
  qualityBuckets,
  type LogSessionZone,
  type Measurement,
  type ProbeQuality,
} from '../core/measurements';

export interface QualityRibbonProps {
  measurements: Measurement[];
  zones: LogSessionZone[];
  lengthKm: number;
}

const LEGEND: ProbeQuality[] = ['good', 'poor', 'dead'];
/** Скільки підписів км під віссю: більше на телефон не влазить. */
const AXIS_TICKS = 4;

const percent = (value: number, total: number) => `${((value / total) * 100).toFixed(3)}%`;

export function QualityRibbon({ measurements, zones, lengthKm }: QualityRibbonProps) {
  const buckets = useMemo(
    () => qualityBuckets(measurements, lengthKm),
    [measurements, lengthKm],
  );

  if (lengthKm <= 0) return null;

  const axis = Array.from({ length: AXIS_TICKS + 1 }, (_, i) => (lengthKm * i) / AXIS_TICKS);

  return (
    <div className="qribbon">
      <div className="qribbon__track">
        {zones.map((zone) => (
          <span
            key={zone.id}
            className="qribbon__zone"
            title={`прогноз: ${zone.fromKm.toFixed(1)}–${zone.toKm.toFixed(1)} км`}
            style={{
              left: percent(zone.fromKm, lengthKm),
              // Зона на 40 м — це частка пікселя: без мінімуму її просто не видно.
              width: `max(2px, ${percent(zone.toKm - zone.fromKm, lengthKm)})`,
            }}
          />
        ))}
        {buckets.map((bucket) => (
          <span
            key={bucket.index}
            className="qribbon__tick"
            title={`${bucket.fromKm.toFixed(1)} км · ${QUALITY_LABEL[bucket.quality]} · ${bucket.count} замір(ів)`}
            style={{
              left: percent(bucket.fromKm, lengthKm),
              width: `max(2px, ${percent(bucket.toKm - bucket.fromKm, lengthKm)})`,
              background: QUALITY_COLOR[bucket.quality],
            }}
          />
        ))}
      </div>

      <div className="qribbon__axis">
        {axis.map((km, i) => (
          <span key={km} className="qribbon__axis-label" data-align={i === axis.length - 1 ? 'end' : undefined}>
            {Math.round(km)}
          </span>
        ))}
      </div>

      <div className="qribbon__legend">
        {LEGEND.map((quality) => (
          <span key={quality} className="qribbon__legend-item">
            <i className="qribbon__dot" style={{ background: QUALITY_COLOR[quality] }} />
            {QUALITY_LABEL[quality]}
          </span>
        ))}
        <span className="qribbon__legend-item">
          <i className="qribbon__dot qribbon__dot--zone" />
          прогноз зон
        </span>
      </div>
    </div>
  );
}
