/**
 * Probe ніколи не кидає і завжди класифікується — це його головна властивість:
 * у дорозі фейл мережі є нормою, а не винятком.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { probe, probeQuality, type ProbeEndpoint } from './probe';

const CORS: ProbeEndpoint = { url: 'https://example.test/ping', cors: true };
const OPAQUE: ProbeEndpoint = { url: 'https://example.test/generate_204', cors: false };

function mockFetch(impl: (url: string, init: RequestInit) => Promise<Response>) {
  const spy = vi.fn(impl);
  vi.stubGlobal('fetch', spy);
  return spy;
}

beforeEach(() => {
  vi.stubGlobal('performance', { now: () => Date.now() });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('probe', () => {
  it('успішна відповідь дає ok і невід’ємний RTT', async () => {
    mockFetch(async () => new Response(null, { status: 204 }));
    const result = await probe(1000, CORS);
    expect(result.ok).toBe(true);
    expect(result.rttMs).toBeGreaterThanOrEqual(0);
  });

  it('додає кеш-бастер і no-store — інакше RTT показував би кеш', async () => {
    const spy = mockFetch(async () => new Response(null, { status: 204 }));
    await probe(1000, CORS);
    const [url, init] = spy.mock.calls[0] as [string, RequestInit];
    expect(url).toMatch(/[?&]t=\d+$/);
    expect(init.cache).toBe('no-store');
    expect(init.mode).toBe('cors');
  });

  it('ендпоінт без CORS зондується в no-cors', async () => {
    // Opaque-відповідь конструктором Response не зробити — підсовуємо те, що
    // від неї бачить код: status 0, ok false.
    const spy = mockFetch(
      async () => ({ ok: false, status: 0, type: 'opaque' }) as unknown as Response,
    );
    const result = await probe(1000, OPAQUE);
    expect((spy.mock.calls[0][1] as RequestInit).mode).toBe('no-cors');
    // Opaque-відповідь має status 0 і ok=false — але сам факт відповіді і є сигнал.
    expect(result.ok).toBe(true);
  });

  it('HTTP-помилка на CORS-ендпоінті — це не зв’язок', async () => {
    mockFetch(async () => new Response(null, { status: 502 }));
    const result = await probe(1000, CORS);
    expect(result).toMatchObject({ ok: false, rttMs: null });
  });

  it('відмова мережі (airplane mode) не кидає, а дає dead', async () => {
    mockFetch(async () => {
      throw new TypeError('Failed to fetch');
    });
    const result = await probe(1000, CORS);
    expect(result).toMatchObject({ ok: false, rttMs: null });
    expect(probeQuality(result)).toBe('dead');
  });

  it('таймаут перериває запит', async () => {
    mockFetch(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => reject(new Error('aborted')));
        }),
    );
    const result = await probe(10, CORS);
    expect(result.ok).toBe(false);
  });
});

describe('probeQuality', () => {
  it('швидка відповідь — good, повільна — poor, фейл — dead', () => {
    expect(probeQuality({ ok: true, rttMs: 240, ts: 0 })).toBe('good');
    expect(probeQuality({ ok: true, rttMs: 1500, ts: 0 })).toBe('poor');
    expect(probeQuality({ ok: false, rttMs: null, ts: 0 })).toBe('dead');
  });
});
