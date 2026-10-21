import { afterEach, describe, expect, it, vi } from 'vitest';
import traffic from '../functions/traffic.js';

const env = { API_AUTH_TOKEN: 'test-token' };
const aircraft = { ac: [{ hex: 'a1b2c3', flight: 'N123AB  ', lat: 36.35, lon: -94.22, alt_baro: 2500, dst: 1.2 }] };

function request(lat, lon) {
  return new Request(`https://preflight.test/api/traffic?lat=${lat}&lon=${lon}&radius_nm=25`, { headers: { Authorization: 'Bearer test-token' } });
}

function upstream(status, body = {}, headers = {}) {
  return new Response(JSON.stringify(body), { status, headers });
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

// Each test uses its own coordinates, so cached entries from one test never
// answer another. The cooldown is per module, so the clock moves forward.
describe('traffic', () => {
  it('shares one adsb.lol result between requests for the same airport', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-21T12:00:00Z'));
    const fetch = vi.fn(async () => upstream(200, aircraft));
    vi.stubGlobal('fetch', fetch);
    await traffic(request(36.35, -94.21), env);
    const res = await traffic(request(36.35, -94.21), env);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(await res.json()).toMatchObject({ stale: false, count: 1, aircraft: [{ callsign: 'N123AB' }] });
  });

  it('answers a 429 with no recent copy as rate_limited, then stops asking for a minute', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-21T13:00:00Z'));
    const fetch = vi.fn(async () => upstream(429, {}, { 'Retry-After': '5' }));
    vi.stubGlobal('fetch', fetch);
    const res = await traffic(request(40.1, -100.1), env);
    expect(res.status).toBe(503);
    expect(res.headers.get('Retry-After')).toBe('60');
    expect(await res.json()).toMatchObject({ code: 'rate_limited', retry_after_s: 60 });

    // Another airport during the cooldown doesn't reach adsb.lol at all.
    vi.setSystemTime(new Date('2026-10-21T13:00:30Z'));
    expect((await traffic(request(40.2, -100.2), env)).status).toBe(503);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('serves the last positions, marked stale, while rate limited, but not once they are old', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-21T14:00:00Z'));
    vi.stubGlobal('fetch', vi.fn(async () => upstream(200, aircraft)));
    await traffic(request(41.1, -101.1), env);

    vi.setSystemTime(new Date('2026-10-21T14:01:00Z'));
    vi.stubGlobal('fetch', vi.fn(async () => upstream(429)));
    const stale = await traffic(request(41.1, -101.1), env);
    expect(stale.status).toBe(200);
    expect(await stale.json()).toMatchObject({ stale: true, fetched_utc: '2026-10-21T14:00:00.000Z', count: 1 });

    vi.setSystemTime(new Date('2026-10-21T14:10:00Z'));
    expect((await traffic(request(41.1, -101.1), env)).status).toBe(503);
  });

  it('backs off longer while adsb.lol keeps refusing, and starts over after a success', async () => {
    vi.useFakeTimers();
    const fetch = vi.fn(async () => upstream(429));
    vi.stubGlobal('fetch', fetch);
    const retryAfterAt = async (time, lat = 43.1) => {
      vi.setSystemTime(new Date(time));
      return (await (await traffic(request(lat, -103.1), env)).json()).retry_after_s;
    };
    expect(await retryAfterAt('2026-10-21T16:00:00Z')).toBe(60);
    expect(await retryAfterAt('2026-10-21T16:01:00Z')).toBe(120);
    expect(await retryAfterAt('2026-10-21T16:03:00Z')).toBe(240);
    // Halfway through, the request is answered without asking adsb.lol.
    expect(await retryAfterAt('2026-10-21T16:05:00Z')).toBe(120);
    expect(fetch).toHaveBeenCalledTimes(3);
    // A longer Retry-After wins over the 8-minute step.
    fetch.mockImplementationOnce(async () => upstream(429, {}, { 'Retry-After': '3600' }));
    expect(await retryAfterAt('2026-10-21T16:07:00Z')).toBe(3600);

    fetch.mockImplementationOnce(async () => upstream(200, aircraft));
    vi.setSystemTime(new Date('2026-10-21T17:07:00Z'));
    expect((await traffic(request(43.1, -103.1), env)).status).toBe(200);
    expect(await retryAfterAt('2026-10-21T17:08:00Z', 43.2)).toBe(60);
  });

  it('makes every isolate wait out the backoff, through D1', async () => {
    // A stand-in for the D1 binding, just enough for cache.js.
    const rows = new Map();
    const db = {
      prepare: () => ({
        bind: (key, entry) => ({ first: async () => rows.get(key) ?? null, run: async () => rows.set(key, entry) }),
      }),
    };
    // Each fresh import of traffic.js and cache.js stands for a new isolate.
    async function isolate() {
      vi.resetModules();
      (await import('./cache.js')).setDatabase(db);
      return (await import('../functions/traffic.js')).default;
    }
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-21T19:00:00Z'));
    vi.stubGlobal('fetch', vi.fn(async () => upstream(429)));
    expect((await (await isolate())(request(44.1, -104.1), env)).status).toBe(503);

    vi.setSystemTime(new Date('2026-10-21T19:00:30Z'));
    const fetch = vi.fn(async () => upstream(200, aircraft));
    vi.stubGlobal('fetch', fetch);
    const res = await (await isolate())(request(44.2, -104.2), env);
    expect(await res.json()).toMatchObject({ code: 'rate_limited', retry_after_s: 30 });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('still reports other upstream failures as errors', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-21T18:00:00Z'));
    vi.stubGlobal('fetch', vi.fn(async () => upstream(404)));
    const res = await traffic(request(42.1, -102.1), env);
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: '404 from api.adsb.lol' });
  });
});
