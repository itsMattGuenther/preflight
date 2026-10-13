import { coordinateParams, fetchJson, handler, json, badRequest } from '../lib/http.js';

const ADSB_FI_URL = 'https://opendata.adsb.fi/api/v3';
const MAX_RADIUS_NM = 40;
const MEMO_TTL_MS = 8000;

// adsb.fi's open API is free and rate limited. Identical requests that arrive
// within a few seconds (several visitors watching the same airport) share one
// upstream call while this function instance is warm.
const memo = new Map();

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

async function load(center, radius) {
  const body = await fetchJson(`${ADSB_FI_URL}/lat/${center.lat}/lon/${center.lon}/dist/${radius}`, { timeoutMs: 7000 });
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
  const key = `${rounded.lat},${rounded.lon},${radius}`;

  const now = Date.now();
  let entry = memo.get(key);
  if (!entry || now - entry.at > MEMO_TTL_MS) {
    entry = { at: now, promise: load(rounded, radius) };
    memo.set(key, entry);
    if (memo.size > 200) memo.delete(memo.keys().next().value);
    entry.promise.catch(() => memo.delete(key));
  }
  const aircraft = await entry.promise;

  return json(
    { fetched_utc: new Date(entry.at).toISOString(), source: 'adsb.fi', center: rounded, radius_nm: radius, count: aircraft.length, aircraft },
    { headers: { 'Cache-Control': 'public, max-age=10' } },
  );
});
