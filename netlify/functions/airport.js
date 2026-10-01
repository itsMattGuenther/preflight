import tzlookup from '@photostructure/tz-lookup';
import {
  frequencyKind,
  parseAwcFrequencies,
  parseMagVar,
  runwaysFromAwc,
  runwaysFromFallback,
  splitAwcName,
} from '../lib/airportData.js';
import { cached, TTL_OVERRIDE } from '../lib/cache.js';
import fallbackAirports from '../lib/data/airports-fallback.json';
import { bearingDeg, distanceNm, round1 } from '../lib/geo.js';
import { fetchJson, fetchText, handler, json, normalizeIcao, badRequest } from '../lib/http.js';

const API_BASE = 'https://aviationweather.gov/api/data';
const AIRPORT_TTL_MS = 24 * 60 * 60 * 1000;
// If AviationWeather's airport record failed to load, the result (built from
// station info / OurAirports) is cached briefly so the full FAA record is
// picked up soon, rather than a degraded copy sticking for a day.
const DEGRADED_TTL_MS = 15 * 60 * 1000;

function fallbackRecord(id) {
  // OurAirports keys small fields by their FAA id (7M5) and others by ICAO.
  const candidates = [id, id.replace(/^K(?=[A-Z0-9]{3}$)/, '')];
  for (const key of candidates) {
    const record = fallbackAirports[key];
    if (record?.alias) return { id: record.alias, ...fallbackAirports[record.alias] };
    if (record) return { id: key, ...record };
  }
  return null;
}

function decodeHtml(value) {
  return String(value || '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&deg;/g, ' deg ');
}

function htmlToText(html) {
  return decodeHtml(String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(?:p|tr|td|div|li|h[1-6]|table)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s+/g, '\n')
    .replace(/\n{2,}/g, '\n'))
    .trim();
}

const VHF_PATTERN = /\b1(?:1[89]|2\d|3[0-6])\.\d{1,3}\b/;

function frequencyRow(label, value) {
  const cleanLabel = String(label || '').replace(/\s+/g, ' ').replace(/:$/, '').trim().toUpperCase();
  return { label: cleanLabel, value: String(value || '').replace(/\s+/g, ' ').trim().slice(0, 120), kind: frequencyKind(cleanLabel) };
}

function parseSkyVectorFrequencies(html) {
  // SkyVector's communications table mirrors the FAA Chart Supplement.
  const table = String(html || '').match(/<table[^>]+id=["']aptcomms["'][^>]*>([\s\S]*?)<\/table>/i)?.[1] || '';
  const rows = [];
  const rowPattern = /<tr[\s\S]*?<th[^>]*>([\s\S]*?):?<\/th>\s*<td[^>]*>([\s\S]*?)<\/td>[\s\S]*?<\/tr>/gi;
  let match = rowPattern.exec(table);
  while (match) {
    const row = frequencyRow(htmlToText(match[1]), htmlToText(match[2]));
    if (VHF_PATTERN.test(row.value) && !/\bat\s+[A-Z0-9]{3,4}\b/i.test(row.label)) rows.push(row);
    match = rowPattern.exec(table);
  }
  return rows;
}

function parseAirnavFrequencies(html) {
  // AirNav's "Airport Communications" section, narrowed so nearby stations'
  // weather frequencies are not mistaken for this airport's CTAF/tower.
  const text = htmlToText(html);
  const section = text.match(/Airport Communications([\s\S]*?)(?:Nearby radio navigation aids|Airport Services|Runway Information|Instrument Procedures|Airport Operational Statistics)/i)?.[1] || '';
  const rows = [];
  const seen = new Set();
  const lines = section.split('\n').map((line) => line.replace(/\s+/g, ' ').trim()).filter(Boolean);
  lines.forEach((line, index) => {
    const lineMatch = line.match(/^([A-Z][A-Z0-9 /&().-]{1,64}?):\s*(.*)$/i);
    if (!lineMatch) return;
    const row = frequencyRow(lineMatch[1], lineMatch[2] || lines[index + 1] || '');
    const key = `${row.label}:${row.value}`;
    if (VHF_PATTERN.test(row.value) && !/\bat\s+[A-Z0-9]{3,4}\b/i.test(row.label) && !seen.has(key)) {
      seen.add(key);
      rows.push(row);
    }
  });
  return rows;
}

async function scrapedFrequencies(icao, faaId) {
  // Fallback when AviationWeather lists no frequencies (common at non-towered
  // fields). Results are cached with the airport for 24 hours, so this runs
  // roughly once per airport per day rather than on every page view.
  const id = faaId || icao.replace(/^K/, '');
  const providers = [
    { label: 'SkyVector (FAA Chart Supplement data)', url: `https://skyvector.com/airport/${encodeURIComponent(id)}`, parse: parseSkyVectorFrequencies },
    { label: 'AirNav (FAA data)', url: `https://www.airnav.com/airport/${encodeURIComponent(icao)}`, parse: parseAirnavFrequencies },
  ];
  for (const provider of providers) {
    try {
      const frequencies = provider.parse(await fetchText(provider.url, { timeoutMs: 4500, retries: 0 }));
      if (frequencies.length) return { frequencies, source: { label: provider.label, url: provider.url } };
    } catch {
      // Try the next provider.
    }
  }
  return null;
}

async function nearbyStations(center, selfId) {
  const delta = 0.75;
  const bbox = `${center.lat - delta},${center.lon - delta},${center.lat + delta},${center.lon + delta}`;
  const stations = await fetchJson(`${API_BASE}/stationinfo?bbox=${bbox}&format=json`).catch(() => []);
  return (Array.isArray(stations) ? stations : [])
    .filter((station) => station.icaoId && station.icaoId !== selfId && Number.isFinite(Number(station.lat)) && Number.isFinite(Number(station.lon)))
    .map((station) => {
      const point = { lat: Number(station.lat), lon: Number(station.lon) };
      return {
        icao: station.icaoId,
        name: station.site,
        state: station.state,
        lat: point.lat,
        lon: point.lon,
        distance_nm: round1(distanceNm(center, point)),
        bearing_deg: bearingDeg(center, point),
        has_metar: (station.siteType || []).includes('METAR'),
        has_taf: (station.siteType || []).includes('TAF'),
      };
    })
    .sort((a, b) => a.distance_nm - b.distance_nm)
    .slice(0, 8);
}

async function loadAirport(icao) {
  const early = fallbackRecord(icao);
  let awcFailed = false;
  // Everything that does not depend on another response runs in parallel;
  // when OurAirports already knows the location, the nearby-station lookup
  // starts immediately too.
  const [airports, stations, earlyNearby] = await Promise.all([
    fetchJson(`${API_BASE}/airport?ids=${icao}&format=json`, { timeoutMs: 6000 }).catch(() => {
      awcFailed = true;
      return [];
    }),
    fetchJson(`${API_BASE}/stationinfo?ids=${icao}&format=json`, { timeoutMs: 6000 }).catch(() => []),
    early?.la != null ? nearbyStations({ lat: early.la, lon: early.lo }, icao) : Promise.resolve(null),
  ]);
  const awc = Array.isArray(airports) ? airports[0] : null;
  const station = Array.isArray(stations) ? stations[0] : null;
  const fallback = early || (awc?.faaId ? fallbackRecord(awc.faaId) : null);

  const lat = Number(awc?.lat ?? station?.lat ?? fallback?.la);
  const lon = Number(awc?.lon ?? station?.lon ?? fallback?.lo);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || (lat === 0 && lon === 0)) return null;

  const magVar = parseMagVar(awc?.magdec);
  const awcRunways = runwaysFromAwc(awc?.runways, magVar);
  const fallbackRunways = runwaysFromFallback(fallback?.r, magVar);
  // FAA data is authoritative when present; OurAirports only fills in fields
  // AviationWeather does not cover (it can list runways the FAA has removed).
  const runways = awcRunways.length ? awcRunways : fallbackRunways;

  const awcName = splitAwcName(awc?.name || station?.site);
  const elevationM = awc?.elev ?? station?.elev;
  const id = awc?.icaoId || station?.icaoId || fallback?.id || icao;
  const faaId = awc?.faaId || station?.faaId || (fallback?.id && !/^K[A-Z]{3}$/.test(fallback.id) ? fallback.id : id.replace(/^K(?=[A-Z]{3}$)/, ''));

  let frequencies = parseAwcFrequencies(awc?.freqs);
  let frequencySource = frequencies.length ? { label: 'FAA via AviationWeather.gov', url: 'https://aviationweather.gov/' } : null;
  const needScrape = !frequencies.length || !frequencies.some((item) => ['ctaf', 'tower', 'unicom'].includes(item.kind));
  const [scraped, nearby] = await Promise.all([
    needScrape ? scrapedFrequencies(id, faaId) : Promise.resolve(null),
    earlyNearby || nearbyStations({ lat, lon }, id),
  ]);
  if (scraped) {
    frequencies = scraped.frequencies;
    frequencySource = scraped.source;
  }

  let timezone = null;
  try {
    timezone = tzlookup(lat, lon);
  } catch {
    timezone = null;
  }

  const towerKnown = awc ? awc.tower === 'T' : null;
  return {
    airport: {
      icao: id,
      faa_id: faaId,
      name: fallback?.n || awcName.name || id,
      city: fallback?.c || awcName.city || '',
      state: awc?.state || station?.state || fallback?.s || '',
      country: awc?.country || station?.country || 'US',
      lat,
      lon,
      elevation_ft: elevationM != null ? Math.round(Number(elevationM) * 3.28084) : fallback?.e ?? null,
      magvar_deg: magVar,
      timezone,
      towered: towerKnown ?? (frequencies.length ? frequencies.some((item) => item.kind === 'tower') : null),
      beacon: awc ? awc.beacon === 'B' : null,
      has_metar: (station?.siteType || []).includes('METAR'),
      has_taf: (station?.siteType || []).includes('TAF'),
      runways,
      frequencies,
      frequency_source: frequencySource,
      data_source: awc ? 'FAA via AviationWeather.gov' : 'OurAirports (verify in Chart Supplement)',
    },
    nearby: nearby.filter((item) => item.icao !== id),
    degraded: awcFailed,
  };
}

export default handler(async (req) => {
  const url = new URL(req.url);
  const icao = normalizeIcao(url.searchParams.get('icao'));
  if (!icao || icao.length < 3) return badRequest('A 3-5 character airport identifier is required');

  const { value, cached_utc } = await cached(`airport/v2/${icao}`, AIRPORT_TTL_MS, async () => {
    const result = await loadAirport(icao);
    // Do not cache "not found": a typo should not be remembered for a day,
    // and a briefly unavailable upstream should be retried next request.
    if (!result) throw Object.assign(new Error('not found'), { notFound: true });
    return result.degraded ? { [TTL_OVERRIDE]: DEGRADED_TTL_MS, value: result } : result;
  }).catch((error) => {
    if (error.notFound) return { value: null };
    throw error;
  });

  if (!value) return json({ error: `Airport ${icao} was not found` }, { status: 404 });

  // Nearby-station flight categories change hourly, so they are fetched fresh
  // even when the airport itself came from cache.
  const ids = value.nearby.filter((item) => item.has_metar).map((item) => item.icao);
  const metars = ids.length ? await fetchJson(`${API_BASE}/metar?ids=${ids.join(',')}&format=json`).catch(() => []) : [];
  const byId = new Map((Array.isArray(metars) ? metars : []).map((metar) => [metar.icaoId, metar]));
  const nearby = value.nearby.map((item) => {
    const metar = byId.get(item.icao);
    return {
      ...item,
      flight_category: metar?.fltCat || null,
      wind_dir_deg: metar && metar.wdir !== 'VRB' ? Number(metar.wdir) : null,
      wind_speed_kt: metar ? Number(metar.wspd ?? 0) : null,
      wind_gust_kt: metar?.wgst != null ? Number(metar.wgst) : null,
      observed_utc: metar?.reportTime || null,
    };
  });

  return json(
    { fetched_utc: new Date().toISOString(), cached_utc, airport: value.airport, nearby },
    { headers: { 'Cache-Control': 'no-store' } },
  );
});
