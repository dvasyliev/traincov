// @vitest-environment jsdom
/**
 * Міні-стрічка малює факт поверх прогнозу. Перевіряємо саме це поєднання:
 * сірі смуги зон із пайплайна + тики замірів на своїх місцях по осі км.
 */
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { QualityRibbon } from './QualityRibbon';
import { QUALITY_COLOR, type LogSessionZone, type Measurement } from '../core/measurements';

const ZONES: LogSessionZone[] = [{ id: 'dz-01', fromKm: 50, toKm: 55, severity: 'none' }];

function row(routeKm: number, probeOk: boolean, probeRttMs: number | null): Measurement {
  return {
    sessionId: 's',
    ts: 0,
    lat: null,
    lng: null,
    acc: null,
    routeKm,
    kmEstimated: false,
    tripId: 't',
    operator: null,
    probeOk,
    probeRttMs,
    effectiveType: null,
    inZoneId: null,
  };
}

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe('QualityRibbon', () => {
  it('малює прогнозовані зони і кольорові тики замірів', () => {
    act(() => {
      root.render(
        <QualityRibbon
          measurements={[row(10, true, 200), row(52, false, null), row(80, true, 2000)]}
          zones={ZONES}
          lengthKm={100}
        />,
      );
    });

    const zones = host.querySelectorAll('.qribbon__zone');
    expect(zones).toHaveLength(1);
    expect((zones[0] as HTMLElement).style.left).toBe('50%');

    const ticks = [...host.querySelectorAll('.qribbon__tick')] as HTMLElement[];
    expect(ticks).toHaveLength(3);
    // Мертвий замір усередині зони має бути червоним і стояти на 52-му км.
    const dead = ticks.find((t) => t.style.left === '52%');
    expect(dead?.style.background).toBe('rgb(239, 68, 68)');
    expect(QUALITY_COLOR.dead).toBe('#ef4444');
  });

  it('порожня сесія не падає', () => {
    act(() => {
      root.render(<QualityRibbon measurements={[]} zones={[]} lengthKm={100} />);
    });
    expect(host.querySelectorAll('.qribbon__tick')).toHaveLength(0);
  });

  it('маршрут без довжини не малюється взагалі', () => {
    act(() => {
      root.render(<QualityRibbon measurements={[row(1, true, 100)]} zones={[]} lengthKm={0} />);
    });
    expect(host.querySelector('.qribbon')).toBeNull();
  });
});
