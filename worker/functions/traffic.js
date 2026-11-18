import { cached, getShared, setShared } from '../lib/cache.js';
import { coordinateParams, fetchJson, handler, json, badRequest } from '../lib/http.js';

// adsb.lol's open data (ODbL, credited on the card and in the footer). adsb.fi
// serves the same readsb format but refuses requests from Cloudflare Workers.
const ADSB_LOL_URL = 'https://api.adsb.lol';
const MAX_RADIUS_NM = 40;

// adsb.lol allows each address 500 requests a day (reset at midnight UTC),
// and every Cloudflare Worker sends from the same shared address, so other
// sites often use that allowance up by early morning (#11). The relay is a few
// lines of Caddy config on a separate server with an address of its own; it
// forwards only this one request, and only with ADSB_RELAY_KEY (a Worker
// secret). Without the key (local dev, tests) the Worker asks adsb.lol
// directly, and it does the same whenever the relay fails.
const RELAY_URL = 'https://adsb-relay.mattguenther.com';
const RELAY_TIMEOUT_MS = 5000;
const DIRECT_TIMEOUT_MS = 7000;

// Everyone watching an airport shares one upstream result for TTL_MS, through
// the D1 cache: about one request a minute per airport, since the app
// refreshes once a minute. If adsb.lol refuses, the last result is served,
// marked stale, for up to MAX_STALE_MS; older positions are no use as traffic.
const TTL_MS = 50 * 1000;
const MAX_STALE_MS = 5 * 60 * 1000;

// After a 429, every copy of this Worker stops using that route (relay or
// direct): for 1 minute, then 2, 4, 8 and 16 while it keeps refusing, at most
// 30 (or longer if it says so with Retry-After). A success starts the next
// backoff over at 1 minute. The state lives in D1 so all isolates wait
// together, with a copy in memory so a waiting isolate doesn't re-read it on
// every request. The two routes count against different allowances, so each
// has its own.
const FIRST_BACKOFF_MS = 60 * 1000;
const MAX_BACKOFF_MS = 30 * 60 * 1000;
const CLEAR = { until: 0, step: 0 };

function backoff(key) {
  let state = CLEAR;
  return {
    get until() {
      return state.until;
    },
    async current() {
      if (Date.now() < state.until) return state;
      state = (await getShared(key)) || state;
      return state;
    },
    async refused(previous, retryAfterSeconds) {
      const now = Date.now();
      // Escalate while the refusals keep coming; after a quiet spell, start over.
      const step = now - previous.until < MAX_BACKOFF_MS ? Math.min(previous.step + 1, 5) : 0;
      const wait = Math.max(Math.min(MAX_BACKOFF_MS, FIRST_BACKOFF_MS * 2 ** step), (retryAfterSeconds || 0) * 1000);
      state = { until: now + wait, step };
      await setShared(key, state);
    },
    async succeeded(previous) {
      if (!previous.until) return;
      state = CLEAR;
      await setShared(key, CLEAR);
    },
  };
}

const ROUTES = {
  relay: { url: RELAY_URL, timeoutMs: RELAY_TIMEOUT_MS, backoff: backoff('traffic/v1/relay-backoff') },
  direct: { url: ADSB_LOL_URL, timeoutMs: DIRECT_TIMEOUT_MS, backoff: backoff('traffic/v1/backoff') },
};

function clean(value) {
  return typeof value === 'string' ? value.trim() : value;
}

function normalizeAircraft(ac) {
  const onGround = ac.alt_baro === 'ground';
  const baro = onGround ? null : Number(ac.alt_baro);
  const geom = Number(ac.alt_geom);
  return {
    hex: ac.hex,
    callsign: clean(ac.flight) || clean(ac.r) || ac.hex,
    registration: clean(ac.r) || null,
    type: clean(ac.t) || null,
    description: clean(ac.desc) || null,
    lat: Number(ac.lat),
    lon: Number(ac.lon),
    on_ground: onGround,
    // Pressure altitude (MSL, uncorrected) is what ADS-B reports for display;
    // geometric altitude is closer to true MSL when available.
    altitude_ft: onGround ? 0 : Number.isFinite(geom) ? geom : Number.isFinite(baro) ? baro : null,
    ground_speed_kt: ac.gs == null ? null : Math.round(Number(ac.gs)),
    track_deg: ac.track == null ? null : Math.round(Number(ac.track)),
    vertical_rate_fpm: ac.baro_rate ?? ac.geom_rate ?? null,
    squawk: clean(ac.squawk) || null,
    emergency: ac.emergency && ac.emergency !== 'none' ? ac.emergency : null,
    distance_nm: ac.dst == null ? null : Math.round(Number(ac.dst) * 10) / 10,
    bearing_deg: ac.dir == null ? null : Math.round(Number(ac.dir)),
    seen_seconds: ac.seen == null ? null : Math.round(Number(ac.seen)),
  };
}

function rateLimited(url) {
  return Object.assign(new Error(`429 from ${new URL(url).host}`), { status: 429 });
}

async function ask(route, path, headers) {
  const state = await route.backoff.current();
  if (Date.now() < state.until) throw rateLimited(route.url);
  let body;
  try {
    body = await fetchJson(`${route.url}${path}`, { timeoutMs: route.timeoutMs, headers });
  } catch (error) {
    if (error.status === 429) await route.backoff.refused(state, error.retryAfterSeconds);
    throw error;
  }
  await route.backoff.succeeded(state);
  return body;
}

async function load(center, radius, env) {
  const path = `/v2/lat/${center.lat}/lon/${center.lon}/dist/${radius}`;
  let body;
  let via = 'direct';
  if (env.ADSB_RELAY_KEY) {
    try {
      body = await ask(ROUTES.relay, path, { 'X-Relay-Key': env.ADSB_RELAY_KEY });
      via = 'relay';
    } catch (error) {
      console.warn(`traffic: relay failed, asking adsb.lol directly: ${error.message}`);
    }
  }
  body ??= await ask(ROUTES.direct, path);
  const aircraft = (body.ac || [])
    .filter((ac) => Number.isFinite(Number(ac.lat)) && Number.isFinite(Number(ac.lon)))
    .map(normalizeAircraft)
    .sort((a, b) => (a.distance_nm ?? 999) - (b.distance_nm ?? 999));
  return { via, aircraft };
}

// When every route is rate limited: the soonest one to try again. A relay that
// failed some other way (a timeout, say) is tried again on the next request.
function secondsUntilRetry(env) {
  const now = Date.now();
  const waits = [ROUTES.direct.backoff.until - now];
  if (env.ADSB_RELAY_KEY) waits.push(ROUTES.relay.backoff.until > now ? ROUTES.relay.backoff.until - now : FIRST_BACKOFF_MS);
  return Math.max(1, Math.ceil(Math.min(...waits) / 1000));
}

export default handler(async (req, env) => {
  const url = new URL(req.url);
  const center = coordinateParams(url);
  if (!center) return badRequest('lat and lon are required');
  const radius = Math.min(MAX_RADIUS_NM, Math.max(5, Math.round(Number(url.searchParams.get('radius_nm')) || 25)));
  const rounded = { lat: Math.round(center.lat * 1000) / 1000, lon: Math.round(center.lon * 1000) / 1000 };
  // v2: entries hold { via, aircraft } (v1 held the bare list).
  const key = `traffic/v2/${rounded.lat},${rounded.lon},${radius}`;

  let result;
  try {
    result = await cached(key, TTL_MS, () => load(rounded, radius, env), { maxStaleMs: MAX_STALE_MS });
  } catch (error) {
    if (error.status !== 429) throw error;
    // Nothing recent to fall back on. The app shows a calm "busy" note for
    // this code and checks back once a minute; until the backoff ends, those
    // checks are answered here without asking adsb.lol.
    const retryAfter = secondsUntilRetry(env);
    return json(
      { error: 'Live traffic is busy', code: 'rate_limited', retry_after_s: retryAfter },
      { status: 503, headers: { 'Retry-After': String(retryAfter) } },
    );
  }
  const { value, cached_utc, stale } = result;
  const { via, aircraft } = value;

  return json(
    { fetched_utc: cached_utc, stale, source: 'adsb.lol', via, center: rounded, radius_nm: radius, count: aircraft.length, aircraft },
    { headers: { 'Cache-Control': 'public, max-age=10' } },
  );
});
