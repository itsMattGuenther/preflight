import { cached } from '../lib/cache.js';
import { bboxParam, bearingDeg, distanceNm, round1 } from '../lib/geo.js';
import { coordinateParams, fetchJson, handler, json, normalizeIcao, badRequest } from '../lib/http.js';
import { normalizeMetar, normalizeTaf } from '../lib/wx.js';

const API_BASE = 'https://aviationweather.gov/api/data';
const METAR_MAX_AGE_MS = 2.5 * 60 * 60 * 1000;
const METAR_FALLBACK_RADIUS_NM = 30;
const TAF_FALLBACK_RADIUS_NM = 40;
// Reporting stations rarely change, and aviationweather.gov can take several
// seconds to answer, so each area's station list is shared for a week.
const STATIONS_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const STATIONS_MAX_STALE_MS = 30 * 24 * 60 * 60 * 1000;

async function stationsNear(center, radiusNm) {
  // Many training fields have no weather reporting, or a METAR but no TAF.
  // In that case use the nearest station that does, and say so in the UI.
  // Null when the lookup fails, which is not the same as no stations nearby.
  // The box is centred on the airport rounded to 0.01° (under 1 NM; the box
  // has 6 NM to spare) so neighbouring requests share one cached list.
  const lat = Math.round(center.lat * 100) / 100;
  const lon = Math.round(center.lon * 100) / 100;
  const delta = radiusNm / 60 + 0.1;
  let stations;
  try {
    ({ value: stations } = await cached(`stations/v1/${lat},${lon},${radiusNm}`, STATIONS_TTL_MS, async () => {
      const bbox = bboxParam({ minLat: lat - delta, minLon: lon - delta, maxLat: lat + delta, maxLon: lon + delta });
      const list = await fetchJson(`${API_BASE}/stationinfo?bbox=${bbox}&format=json`, { timeoutMs: 5000 });
      if (!Array.isArray(list)) throw new Error('Unexpected station list from aviationweather.gov');
      return list.map((station) => ({
        icao: station.icaoId,
        name: station.site,
        site_types: station.siteType || [],
        lat: Number(station.lat),
        lon: Number(station.lon),
      }));
    }, { maxStaleMs: STATIONS_MAX_STALE_MS }));
  } catch (error) {
    console.warn(`weather: station lookup failed: ${error.message}`);
    return null;
  }
  return stations
    .map(({ lat: stationLat, lon: stationLon, ...station }) => ({
      ...station,
      distance_nm: round1(distanceNm(center, { lat: stationLat, lon: stationLon })),
      bearing_deg: bearingDeg(center, { lat: stationLat, lon: stationLon }),
    }))
    .sort((a, b) => a.distance_nm - b.distance_nm);
}

function nearest(stations, siteType, radiusNm, excludeId) {
  return stations
    .filter((station) => station.icao !== excludeId && station.site_types.includes(siteType) && station.distance_nm <= radiusNm)
    .map(({ site_types: _siteTypes, ...station }) => station);
}

function isRecent(metar) {
  const observed = Date.parse(metar?.reportTime || '');
  return Number.isFinite(observed) && Date.now() - observed < METAR_MAX_AGE_MS;
}

function summary(metar) {
  const normalized = normalizeMetar(metar);
  return {
    observed_utc: normalized.observed_utc,
    raw: normalized.raw,
    flight_category: normalized.flight_category,
    wind_dir_deg: normalized.wind_dir_deg,
    wind_vrb: normalized.wind_vrb,
    wind_speed_kt: normalized.wind_speed_kt,
    wind_gust_kt: normalized.wind_gust_kt,
    visibility_sm: normalized.visibility_sm,
    ceiling_ft: normalized.ceiling_ft,
    altimeter_inhg: normalized.altimeter_inhg,
    temp_c: normalized.temp_c,
    dewpoint_c: normalized.dewpoint_c,
  };
}

export default handler(async (req) => {
  const url = new URL(req.url);
  const icao = normalizeIcao(url.searchParams.get('icao'));
  if (!icao) return badRequest('icao is required');
  const center = coordinateParams(url);

  // Lookups that failed. If the METAR or TAF then comes back empty, the
  // response says it's unavailable rather than letting the page claim there
  // is no station nearby.
  const failed = new Set();
  const attempt = (product, request) => request.catch((error) => {
    console.warn(`weather ${icao}: ${product} lookup failed: ${error.message}`);
    failed.add(product);
    return [];
  });

  // Field METAR/TAF and the nearby-station list are fetched in parallel so the
  // nearest-station fallback adds at most one more round trip.
  const [metars, tafs, nearbyStations] = await Promise.all([
    attempt('METAR', fetchJson(`${API_BASE}/metar?ids=${icao}&format=json&hours=3`, { timeoutMs: 6000 })),
    attempt('TAF', fetchJson(`${API_BASE}/taf?ids=${icao}&format=json`, { timeoutMs: 6000 })),
    center ? stationsNear(center, TAF_FALLBACK_RADIUS_NM) : Promise.resolve([]),
  ]);
  if (!nearbyStations) ['METAR', 'TAF'].forEach((product) => failed.add(product));
  const stations = nearbyStations || [];

  // Whether the field itself is a reporting station decides how a fallback is
  // explained: "no weather reporting here" vs "no current report right now".
  const fieldStation = stations.find((station) => station.icao === icao);
  const fieldHas = (type) => (fieldStation ? fieldStation.site_types.includes(type) : null);

  let metarList = (Array.isArray(metars) ? metars : []).sort((a, b) => Date.parse(b.reportTime) - Date.parse(a.reportTime));
  let metarSource = { icao, name: metarList[0]?.name || null, distance_nm: 0, bearing_deg: null, is_field: true };

  if ((!metarList.length || !isRecent(metarList[0])) && center) {
    for (const station of nearest(stations, 'METAR', METAR_FALLBACK_RADIUS_NM, icao).slice(0, 3)) {
      const nearby = await attempt('METAR', fetchJson(`${API_BASE}/metar?ids=${station.icao}&format=json&hours=3`));
      const sorted = (Array.isArray(nearby) ? nearby : []).sort((a, b) => Date.parse(b.reportTime) - Date.parse(a.reportTime));
      if (sorted.length && isRecent(sorted[0])) {
        metarList = sorted;
        metarSource = { ...station, is_field: false, reason: fieldHas('METAR') ? 'no_current_report' : 'no_reporting' };
        break;
      }
    }
  }

  let taf = Array.isArray(tafs) ? tafs[0] : null;
  let tafSource = taf ? { icao, name: taf.name || null, distance_nm: 0, bearing_deg: null, is_field: true } : null;
  if (!taf && center) {
    const [station] = nearest(stations, 'TAF', TAF_FALLBACK_RADIUS_NM, icao);
    if (station) {
      const nearby = await attempt('TAF', fetchJson(`${API_BASE}/taf?ids=${station.icao}&format=json`));
      if (Array.isArray(nearby) && nearby[0]) {
        taf = nearby[0];
        tafSource = { ...station, is_field: false, reason: fieldHas('TAF') ? 'no_current_report' : 'no_reporting' };
      }
    }
  }

  const latest = metarList[0] || null;
  return json(
    {
      fetched_utc: new Date().toISOString(),
      metar: latest ? normalizeMetar(latest) : null,
      metar_source: latest ? metarSource : null,
      recent: metarList.slice(0, 8).map(summary),
      taf: taf ? normalizeTaf(taf) : null,
      taf_source: tafSource,
      unavailable: [latest ? null : 'METAR', taf ? null : 'TAF'].filter((product) => product && failed.has(product)),
    },
    { headers: { 'Cache-Control': 'public, max-age=120' } },
  );
});
