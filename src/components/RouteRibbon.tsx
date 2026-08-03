/**
 * Вертикальна «стрічка маршруту» — головний екран поїздки.
 * Вісь = км маршруту; маркер «я» стоїть на місці, стрічка їде під ним.
 *
 * Оновлюється імперативно (scrollTop + два style), без ререндера:
 * статичну частину — станції — React малює один раз на бандл.
 */
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTripUpdates } from '../app/useTrip';
import { formatKm1, formatTime } from '../core/format';
import type { TripSnapshot, TripTracker } from '../core/trip-tracker';
import type { RouteStop } from '../core/types';

/** Масштаб осі. 3.5 px/км: 400-кілометровий рейс — це ~1400 px, огляд на 2–3 екрани. */
const PX_PER_KM = 3.5;
/** Маркер «я» на 35% висоти: попереду видно більше, ніж позаду (як у навігаторах). */
const MARKER_RATIO = 0.35;
/** Ближчі за це підписи станцій злипаються — лишаємо тільки крапку. */
const MIN_LABEL_GAP_PX = 18;

interface RibbonStop {
  stop: RouteStop;
  top: number;
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

export function RouteRibbon({ tracker }: { tracker: TripTracker }) {
  const { bundle } = tracker;
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const meRef = useRef<HTMLDivElement | null>(null);
  const meLabelRef = useRef<HTMLSpanElement | null>(null);
  const doneRef = useRef<HTMLDivElement | null>(null);
  const [viewportH, setViewportH] = useState(0);

  const stops = useMemo(() => layout(bundle.stops), [bundle.stops]);
  const trackH = bundle.lengthKm * PX_PER_KM;

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
          <div className="ribbon__done" ref={doneRef} />
          {stops.map(({ stop, top, showLabel }) => (
            <div className="ribbon__stop" key={stop.id + stop.km} style={{ top }}>
              <span className="ribbon__dot" />
              {showLabel && (
                <>
                  <span className="ribbon__time">{formatTime(stop.dep ?? stop.arr)}</span>
                  <span className="ribbon__name">{stop.name}</span>
                </>
              )}
            </div>
          ))}
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
