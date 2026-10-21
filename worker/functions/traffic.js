import { cached, getShared, setShared } from '../lib/cache.js';
import { coordinateParams, fetchJson, handler, json, badRequest } from '../lib/http.js';

// adsb.lol's open data (ODbL, credited on the card and in the footer). adsb.fi
// serves the same readsb format but refuses requests from Cloudflare Workers.
const ADSB_LOL_URL = 'https://api.adsb.lol/v2';
const MAX_RADIUS_NM = 40;

// adsb.lol's open API is free and rate limited, and Workers share outbound IP
// addresses, so other sites' requests count against the same limit. Everyone
// watching an airport shares one upstream result for TTL_MS, through the D1
// cache: about one request a minute per airport, since the app refreshes once
// a minute. If adsb.lol refuses, the last result is served, marked stale, for
// up to MAX_STALE_MS; older positions are no use as traffic.
const TTL_MS = 50 * 1000;
const MAX_STALE_MS = 5 * 60 * 1000;

// After a 429, every copy of this Worker stops asking adsb.lol: for 1 minute,
// then 2, 4, 8 and 16 while it keeps refusing, at most 30 (or longer if it
// says so with Retry-After). A success starts the next backoff over at 1
// minute. The state lives in D1 so all isolates wait together, with a copy in
// memory so a waiting isolate doesn't re-read it on every request.
const BACKOFF_KEY = 'traffic/v1/backoff';
const FIRST_BACKOFF_MS = 60 * 1000;
const MAX_BACKOFF_MS = 30 * 60 * 1000;
const CLEAR = { until: 0, step: 0 };
let backoff = CLEAR;

async function currentBackoff() {
  if (Date.now() < backoff.until) return backoff;
  backoff = (await getShared(BACKOFF_KEY)) || backoff;
  return backoff;
}

async function backOff(previous, retryAfterSeconds) {
  const now = Date.now();
  // Escalate while the refusals keep coming; after a quiet spell, start over.
  const step = now - previous.until < MAX_BACKOFF_MS ? Math.min(previous.step + 1, 5) : 0;
  const wait = Math.max(Math.min(MAX_BACKOFF_MS, FIRST_BACKOFF_MS * 2 ** step), (retryAfterSeconds || 0) * 1000);
  backoff = { until: now + wait, step };
  await setShared(BACKOFF_KEY, backoff);
}

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

function rateLimited() {
  return Object.assign(new Error('429 from api.adsb.lol'), { status: 429 });
}

async function load(center, radius) {
  const state = await currentBackoff();
  if (Date.now() < state.until) throw rateLimited();
  let body;
  try {
    body = await fetchJson(`${ADSB_LOL_URL}/lat/${center.lat}/lon/${center.lon}/dist/${radius}`, { timeoutMs: 7000 });
  } catch (error) {
    if (error.status === 429) await backOff(state, error.retryAfterSeconds);
    throw error;
  }
  if (state.until) {
    backoff = CLEAR;
    await setShared(BACKOFF_KEY, CLEAR);
  }
  return (body.ac || [])
    .filter((ac) => Number.isFinite(Number(ac.lat)) && Number.isFinite(Number(ac.lon)))
    .map(normalizeAircraft)
    .sort((a, b) => (a.distance_nm ?? 999) - (b.distance_nm ?? 999));
}

export default handler(async (req) => {
  const url = new URL(req.url);
  const center = coordinateParams(url);
  if (!center) return badRequest('lat and lon are required');
  const radius = Math.min(MAX_RADIUS_NM, Math.max(5, Math.round(Number(url.searchParams.get('radius_nm')) || 25)));
  const rounded = { lat: Math.round(center.lat * 1000) / 1000, lon: Math.round(center.lon * 1000) / 1000 };
  const key = `traffic/v1/${rounded.lat},${rounded.lon},${radius}`;

  let result;
  try {
    result = await cached(key, TTL_MS, () => load(rounded, radius), { maxStaleMs: MAX_STALE_MS });
  } catch (error) {
    if (error.status !== 429) throw error;
    // Nothing recent to fall back on. The app shows a calm "busy" note for
    // this code and checks back once a minute; until the backoff ends, those
    // checks are answered here without asking adsb.lol.
    const retryAfter = Math.max(1, Math.ceil((backoff.until - Date.now()) / 1000));
    return json(
      { error: 'Live traffic is busy', code: 'rate_limited', retry_after_s: retryAfter },
      { status: 503, headers: { 'Retry-After': String(retryAfter) } },
    );
  }
  const { value: aircraft, cached_utc, stale } = result;

  return json(
    { fetched_utc: cached_utc, stale, source: 'adsb.lol', center: rounded, radius_nm: radius, count: aircraft.length, aircraft },
    { headers: { 'Cache-Control': 'public, max-age=10' } },
  );
});
