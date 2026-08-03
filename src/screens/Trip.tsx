import { useState } from 'react';
import { EtaHeader } from '../components/EtaHeader';
import { Map } from '../components/Map';
import { RouteRibbon } from '../components/RouteRibbon';
import { TripStatusBar } from '../components/TripStatusBar';
import { ZoneSheet } from '../components/ZoneSheet';
import { useAppActions, useAppState } from '../app/app-state';
import { useEtaStore } from '../app/useEta';
import { useTripTracker, useTripTracking } from '../app/useTrip';
import { useTripSession, useTripSessionSync } from '../app/useTripSession';
import { useProbeLogger } from '../app/useProbeLogger';
import { setTripSession } from '../core/trip-session';
import { formatKm, formatTime } from '../core/format';
import { operatorLabel } from '../core/operators';
import { QUALITY_COLOR, QUALITY_LABEL } from '../core/measurements';
import type { LoggerSnapshot } from '../core/probe-logger';
import type { OperatorId } from '../core/operators';
import type { DeadZone, RouteBundle } from '../core/types';

type View = 'ribbon' | 'map';

export function Trip() {
  const { currentTrip, operator, savedTrips, logging } = useAppState();

  // Редірект робить App; сюди потрапляємо лише на кадр між dispatch і ререндером.
  if (!currentTrip) return null;

  // key: інший рейс — інший трекер, інша стрічка, все з нуля.
  return (
    <TripView
      key={currentTrip.tripId}
      bundle={currentTrip}
      operator={operator}
      logging={logging}
      offlineReady={savedTrips.some((trip) => trip.tripId === currentTrip.tripId)}
    />
  );
}

interface TripViewProps {
  bundle: RouteBundle;
  operator: OperatorId | null;
  /** Тумблер логера замірів із налаштувань. */
  logging: boolean;
  /** Пакет лежить у Dexie — рейс переживе airplane mode. */
  offlineReady: boolean;
}

function TripView({ bundle, operator, logging, offlineReady }: TripViewProps) {
  const { setScreen } = useAppActions();
  const tracker = useTripTracker(bundle);
  const etaStore = useEtaStore(tracker);
  const tracking = useTripTracking(tracker);
  const [view, setView] = useState<View>('ribbon');
  /** Один шит на екран: його відкривають і стрічка, і карта. */
  const [zone, setZone] = useState<DeadZone | null>(null);

  useTripSessionSync(tracker, bundle.tripId);
  const session = useTripSession();
  const probeLog = useProbeLogger(tracker, operator, logging);
  // iOS вбив PWA посеред поїздки: трекера вже немає, а запис лишився.
  const interrupted = !tracking && session?.tripId === bundle.tripId;

  const last = bundle.stops[bundle.stops.length - 1];
  const zonesCount = bundle.deadZones.length;

  return (
    <div className="screen screen--full">
      <header className="trip-header">
        <span className="trip-header__badge">{bundle.carrier}</span>
        <span className="trip-header__title">{bundle.name}</span>
        <button type="button" className="trip-header__change" onClick={() => setScreen('home')}>
          {operator ? operatorLabel(operator) : 'оператор'} · змінити
        </button>
      </header>
      <div className="trip-subheader">
        {formatTime(bundle.stops[0]?.dep ?? null)} → {formatTime(last?.arr ?? null)} ·{' '}
        {formatKm(bundle.lengthKm)} · {bundle.stops.length} зупинок ·{' '}
        {zonesCount ? `${zonesCount} мертвих зон` : 'зон не знайдено'}
        {offlineReady && <span className="badge badge--saved">📦 офлайн-готовий</span>}
        <ProbeChip snapshot={probeLog} />
      </div>

      {interrupted && (
        <div className="banner banner--warn banner--action">
          <span>Поїздка перервалась. Продовжити відстеження?</span>
          <span className="banner__buttons">
            <button type="button" className="button button--inline" onClick={() => tracker.start()}>
              Продовжити
            </button>
            <button
              type="button"
              className="button button--inline button--ghost"
              onClick={() => setTripSession(null)}
            >
              Ні
            </button>
          </span>
        </div>
      )}

      <EtaHeader store={etaStore} />
      <TripStatusBar tracker={tracker} />

      <div className="view-switch">
        <button
          type="button"
          className={`view-switch__item ${view === 'ribbon' ? 'view-switch__item--active' : ''}`}
          onClick={() => setView('ribbon')}
        >
          Стрічка
        </button>
        <button
          type="button"
          className={`view-switch__item ${view === 'map' ? 'view-switch__item--active' : ''}`}
          onClick={() => setView('map')}
        >
          Карта
        </button>
      </div>

      {view === 'ribbon' ? (
        <RouteRibbon tracker={tracker} etaStore={etaStore} onZoneSelect={setZone} />
      ) : (
        <Map
          route={bundle.shape}
          stops={bundle.stops}
          zones={bundle.deadZones}
          onZoneSelect={setZone}
          tracker={tracker}
        />
      )}

      <ZoneSheet zone={zone} onClose={() => setZone(null)} />
    </div>
  );
}

/**
 * Крапка + лічильник замірів у підзаголовку. Логер працює мовчки, і без цієї
 * крапки єдиний спосіб дізнатись, що він живий, — сходити на екран логера,
 * тобто зупинити поїздку.
 */
function ProbeChip({ snapshot }: { snapshot: LoggerSnapshot }) {
  if (!snapshot.running) return null;
  const quality = snapshot.last?.quality;
  const title = quality
    ? `${QUALITY_LABEL[quality]}${snapshot.last?.rttMs === null ? '' : ` · ${snapshot.last?.rttMs} мс`}`
    : 'перший замір…';
  return (
    <span className="badge badge--muted" title={title}>
      <i
        className="probe-dot"
        style={{ background: quality ? QUALITY_COLOR[quality] : 'var(--text-dim)' }}
      />
      {snapshot.count}
    </span>
  );
}
