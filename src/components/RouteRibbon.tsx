/**
 * Вертикальна «стрічка маршруту» — головний екран поїздки.
 * Вісь = км маршруту; маркер «я» стоїть на місці, стрічка їде під ним.
 *
 * Оновлюється імперативно (scrollTop + два style), без ререндера:
 * статичну частину — станції — React малює один раз на бандл.
 */
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useEtaResult } from '../app/useEta';
import { useTripUpdates } from '../app/useTrip';
import { useThrottledValue } from '../hooks/useThrottledValue';
import { formatClock, formatKm1, formatTime } from '../core/format';
import { formatZoneLength, zoneIcon, zoneSummary } from '../core/zones';
import type { EtaStore } from '../core/eta-store';
import type { TripSnapshot, TripTracker } from '../core/trip-tracker';
import type { DeadZone, RouteStop } from '../core/types';

/** Масштаб осі. 3.5 px/км: 400-кілометровий рейс — це ~1400 px, огляд на 2–3 екрани. */
const PX_PER_KM = 3.5;
/** Маркер «я» на 35% висоти: попереду видно більше, ніж позаду (як у навігаторах). */
const MARKER_RATIO = 0.35;
/** Ближчі за це підписи станцій злипаються — лишаємо тільки крапку. */
const MIN_LABEL_GAP_PX = 18;
/** Тунель на 40 м — це 0.14 px. Смужку все одно треба бачити. */
const MIN_ZONE_PX = 4;
/** Розходження прогнозу з розкладом менше цього нікому не цікаве. */
const PLAN_DRIFT_MS = 3 * 60_000;
/**
 * А більше цього — це вже не запізнення, а інший рейс дня (наприклад, симулятор
 * о 15:00 на потязі 06:05). Порівнювати з ним планові часи безглуздо.
 */
const PLAN_DRIFT_MAX_MS = 6 * 3_600_000;
/** Коротшу діру показуємо однією міткою: `~15:42–15:42` виглядає як помилка. */
const ZONE_RANGE_MS = 60_000;

/** Ключ мітки: `stop_id` може повторитись, якщо рейс двічі заходить на ту саму станцію. */
const pointKey = (refId: string, km: number) => `${refId}|${km.toFixed(3)}`;

interface RibbonStop {
  stop: RouteStop;
  top: number;
  showLabel: boolean;
}

interface RibbonZone {
  zone: DeadZone;
  top: number;
  height: number;
  showLabel: boolean;
}

function layout(stops: RouteStop[]): RibbonStop[] {
  let lastLabelTop = -Infinity;
  return stops.map((stop, i) => {
    const top = stop.km * PX_PER_KM;
    // Кінцеві підписуємо завжди — без них незрозуміло, звідки й куди рейс.
    const terminal = i === 0 || i === stops.length - 1;
    const showLabel = terminal || top - lastLabelTop >= MIN_LABEL_GAP_PX;
    if (showLabel) lastLabelTop = top;
    return { stop, top, showLabel };
  });
}

/**
 * Смужки зон. Підписи проріджуємо так само, як у станцій: у Варшаві
 * чотири зони лягають на 20 px, і без цього там каша з чипів.
 */
function layoutZones(zones: DeadZone[]): RibbonZone[] {
  let lastLabelTop = -Infinity;
  return zones.map((zone) => {
    const top = zone.fromKm * PX_PER_KM;
    const height = Math.max(zone.lengthKm * PX_PER_KM, MIN_ZONE_PX);
    const center = top + height / 2;
    const showLabel = center - lastLabelTop >= MIN_LABEL_GAP_PX;
    if (showLabel) lastLabelTop = center;
    return { zone, top, height, showLabel };
  });
}

interface ZoneTimes {
  in?: number;
  out?: number;
}

/** Мітка зони: `⛔ 2.2 км · ~15:42–15:49`, поки прогнозу немає — просто тип зони. */
function zoneLabel(zone: DeadZone, times: ZoneTimes | undefined): string {
  if (times?.in === undefined) return zoneSummary(zone);
  const range =
    times.out !== undefined && times.out - times.in >= ZONE_RANGE_MS
      ? `~${formatClock(times.in)}–${formatClock(times.out)}`
      : `~${formatClock(times.in)}`;
  return `${zoneIcon(zone.severity)} ${formatZoneLength(zone.lengthKm)} · ${range}`;
}

/** Мітки часу оновлюємо рідко: щосекундні цифри в дорозі просто не читаються. */
const ETA_REFRESH_MS = 10_000;

export interface RouteRibbonProps {
  tracker: TripTracker;
  /** Прогноз (задача 06): мітки часу біля станцій і зон. */
  etaStore: EtaStore;
  /** Тап по зоні → bottom-sheet; його тримає екран поїздки. */
  onZoneSelect?: (zone: DeadZone) => void;
}

export function RouteRibbon({ tracker, etaStore, onZoneSelect }: RouteRibbonProps) {
  const { bundle } = tracker;
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const meRef = useRef<HTMLDivElement | null>(null);
  const meLabelRef = useRef<HTMLSpanElement | null>(null);
  const doneRef = useRef<HTMLDivElement | null>(null);
  const [viewportH, setViewportH] = useState(0);

  const stops = useMemo(() => layout(bundle.stops), [bundle.stops]);
  const zones = useMemo(() => layoutZones(bundle.deadZones), [bundle.deadZones]);
  const trackH = bundle.lengthKm * PX_PER_KM;

  const eta = useThrottledValue(useEtaResult(etaStore), ETA_REFRESH_MS);

  const stopEta = useMemo(() => {
    const map = new Map<string, { eta: number; plan: number | null }>();
    for (const point of eta?.timeline ?? []) {
      if (point.kind === 'stop') map.set(pointKey(point.refId, point.km), point);
    }
    return map;
  }, [eta]);

  const zoneEta = useMemo(() => {
    const map = new Map<string, ZoneTimes>();
    for (const point of eta?.timeline ?? []) {
      if (point.kind === 'stop') continue;
      const times = map.get(point.refId) ?? {};
      if (point.kind === 'zone-in') times.in = point.eta;
      else times.out = point.eta;
      map.set(point.refId, times);
    }
    return map;
  }, [eta]);

  const apply = useCallback((snapshot: TripSnapshot) => {
    const scroll = scrollRef.current;
    const me = meRef.current;
    if (!scroll || !me) return;

    if (snapshot.km === null) {
      me.style.opacity = '0';
      if (doneRef.current) doneRef.current.style.height = '0px';
      return;
    }
    me.style.opacity = '1';
    me.dataset.status = snapshot.status;
    if (meLabelRef.current) meLabelRef.current.textContent = `${formatKm1(snapshot.km)} км`;
    if (doneRef.current) doneRef.current.style.height = `${snapshot.km * PX_PER_KM}px`;
    // Верхній спейсер уже дорівнює MARKER_RATIO * висоти, тому зсув = чистий км.
    scroll.scrollTop = snapshot.km * PX_PER_KM;
  }, []);

  useTripUpdates(tracker, apply);

  // Розміри потрібні для спейсерів; після кожної зміни повертаємо стрічку під маркер.
  useLayoutEffect(() => {
    const scroll = scrollRef.current;
    if (!scroll) return;
    const observer = new ResizeObserver(() => {
      setViewportH(scroll.clientHeight);
      apply(tracker.getSnapshot());
    });
    observer.observe(scroll);
    return () => observer.disconnect();
  }, [apply, tracker]);

  useLayoutEffect(() => apply(tracker.getSnapshot()), [apply, tracker, viewportH]);

  return (
    <div className="ribbon">
      <div className="ribbon__scroll" ref={scrollRef}>
        <div style={{ height: viewportH * MARKER_RATIO }} />
        <div className="ribbon__track" style={{ height: trackH }}>
          <div className="ribbon__rail" />
          {zones.map(({ zone, top, height, showLabel }) => (
            <button
              type="button"
              key={zone.id}
              className={`ribbon__zone ribbon__zone--${zone.severity}`}
              style={{ top, height }}
              aria-label={`${zoneSummary(zone)}, ${zone.fromKm}–${zone.toKm} км`}
              onClick={() => onZoneSelect?.(zone)}
            >
              <span className="ribbon__zone-hit" />
              {showLabel && (
                <span className="ribbon__zone-label">{zoneLabel(zone, zoneEta.get(zone.id))}</span>
              )}
            </button>
          ))}
          <div className="ribbon__done" ref={doneRef} />
          {stops.map(({ stop, top, showLabel }) => {
            const forecast = stopEta.get(pointKey(stop.id, stop.km));
            const planned = formatTime(stop.arr ?? stop.dep);
            // Плановий час показуємо сірим лише коли прогноз від нього помітно відійшов.
            const gap =
              forecast !== undefined && forecast.plan !== null
                ? Math.abs(forecast.eta - forecast.plan)
                : 0;
            const drift = gap >= PLAN_DRIFT_MS && gap <= PLAN_DRIFT_MAX_MS;
            return (
              <div className="ribbon__stop" key={stop.id + stop.km} style={{ top }}>
                <span className="ribbon__dot" />
                {showLabel && (
                  <>
                    <span className="ribbon__time">
                      {forecast === undefined ? planned : formatClock(forecast.eta)}
                      {drift && <span className="ribbon__time-plan">{planned}</span>}
                    </span>
                    <span className="ribbon__name">{stop.name}</span>
                  </>
                )}
              </div>
            );
          })}
        </div>
        <div style={{ height: viewportH * (1 - MARKER_RATIO) }} />
      </div>

      <div className="ribbon__me" ref={meRef} style={{ top: `${MARKER_RATIO * 100}%` }}>
        <span className="ribbon__me-dot" />
        <span className="ribbon__me-label" ref={meLabelRef} />
      </div>
    </div>
  );
}
