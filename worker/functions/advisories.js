import { cached } from '../lib/cache.js';
import { bearingDeg, boundingBox, distanceNm, distanceToPolygonNm, distanceToRingNm, round1, toRing } from '../lib/geo.js';
import { coordinateParams, fetchJson, handler, json, badRequest } from '../lib/http.js';
import { toIso, toNumber } from '../lib/wx.js';

const API_BASE = 'https://aviationweather.gov/api/data';
const AREA_RADIUS_NM = 25;
const PIREP_RADIUS_NM = 60;
const PIREP_MAX_FL = 180;

const GAIRMET_LABELS = {
  IFR: 'IFR conditions',
  MT_OBSC: 'Mountain obscuration',
  'TURB-LO': 'Turbulence below FL180',
  'TURB-HI': 'Turbulence above FL180',
  LLWS: 'Low-level wind shear',
  SFC_WND: 'Strong surface winds (30+ kt)',
  ICE: 'Icing',
  FZLVL: 'Freezing level',
  'M_FZLVL': 'Multiple freezing levels',
};

function altitude(value) {
  // G-AIRMET altitudes are hundreds of feet ("270" = FL270); "SFC" = surface.
  if (value == null || value === '') return null;
  if (String(value).toUpperCase() === 'SFC') return 0;
  const parsed = toNumber(value);
  if (parsed == null) return null;
  return parsed < 1000 ? parsed * 100 : parsed;
}

// Line and isolated-cell advisories (e.g. a convective SIGMET "LINE 20NM
// WIDE") can arrive as one or two points rather than a polygon; treat them as
// a corridor/circle of LINE_HALF_WIDTH_NM around the points.
const LINE_HALF_WIDTH_NM = 10;

export function nearArea(center, coords) {
  const points = toRing(coords);
  if (!points.length) return null;
  let distance;
  if (points.length < 3) {
    const path = points.length === 1 ? [points[0], points[0]] : points;
    distance = Math.max(0, distanceToRingNm(center, path) - LINE_HALF_WIDTH_NM);
  } else {
    distance = distanceToPolygonNm(center, points);
  }
  return distance <= AREA_RADIUS_NM ? round1(distance) : null;
}

// Hazard feeds older than this are not trusted, even as a fallback.
const MAX_STALE = { maxStaleMs: 45 * 60 * 1000 };
function track(staleFeeds, name, result) {
  if (result.stale) staleFeeds.add(name);
  return result;
}

async function sigmets(center, staleFeeds) {
  const { value } = track(staleFeeds, 'SIGMETs', await cached('advisories/v1/airsigmet', 3 * 60 * 1000, () => fetchJson(`${API_BASE}/airsigmet?format=json`), MAX_STALE));
  const now = Date.now();
  return (Array.isArray(value) ? value : [])
    .filter((item) => !item.validTimeTo || item.validTimeTo * 1000 > now)
    .map((item) => {
      const distance = nearArea(center, item.coords);
      if (distance == null) return null;
      return {
        kind: item.hazard === 'CONVECTIVE' ? 'Convective SIGMET' : item.airSigmetType || 'SIGMET',
        hazard: item.hazard,
        severity: item.severity ?? null,
        distance_nm: distance,
        over_field: distance === 0,
        valid_from_utc: toIso(item.validTimeFrom),
        valid_to_utc: toIso(item.validTimeTo),
        base_ft: toNumber(item.altitudeLow1),
        top_ft: toNumber(item.altitudeHi1),
        raw: item.rawAirSigmet,
      };
    })
    .filter(Boolean);
}

async function gairmets(center, staleFeeds) {
  const { value } = track(staleFeeds, 'G-AIRMETs', await cached('advisories/v1/gairmet', 10 * 60 * 1000, () => fetchJson(`${API_BASE}/gairmet?format=json`), { maxStaleMs: 3 * 60 * 60 * 1000 }));
  const items = (Array.isArray(value) ? value : []).filter((item) => item.geometryType === 'AREA' || item.geom === 'AREA');
  // G-AIRMETs are snapshots every 3 hours; use the one valid closest to now.
  const now = Date.now();
  const times = [...new Set(items.map((item) => item.validTime))];
  const current = times.sort((a, b) => Math.abs(Date.parse(a) - now) - Math.abs(Date.parse(b) - now))[0];
  return items
    .filter((item) => item.validTime === current && item.hazard !== 'FZLVL' && item.hazard !== 'M_FZLVL')
    .map((item) => {
      const distance = nearArea(center, item.coords);
      if (distance == null) return null;
      return {
        kind: `G-AIRMET ${String(item.product || '').charAt(0)}${String(item.product || '').slice(1).toLowerCase()}`,
        product: item.product,
        hazard: item.hazard,
        label: GAIRMET_LABELS[item.hazard] || item.hazard,
        severity: item.severity || null,
        due_to: item.due_to || null,
        distance_nm: distance,
        over_field: distance === 0,
        valid_utc: toIso(item.validTime),
        expire_utc: toIso(item.expireTime),
        base_ft: altitude(item.base),
        top_ft: altitude(item.top),
      };
    })
    .filter(Boolean)
    .filter((item, index, list) => list.findIndex((other) => other.hazard === item.hazard && other.distance_nm === item.distance_nm) === index);
}

async function cwas(center, staleFeeds) {
  const { value } = track(staleFeeds, 'CWAs', await cached('advisories/v1/cwa', 3 * 60 * 1000, () => fetchJson(`${API_BASE}/cwa?format=json`), MAX_STALE));
  const now = Date.now();
  return (Array.isArray(value) ? value : [])
    .filter((item) => !item.validTimeTo || item.validTimeTo * 1000 > now)
    .map((item) => {
      const distance = nearArea(center, item.coords);
      if (distance == null) return null;
      return {
        kind: 'Center Weather Advisory',
        hazard: item.hazard,
        qualifier: item.qualifier || null,
        distance_nm: distance,
        over_field: distance === 0,
        valid_from_utc: toIso(item.validTimeFrom),
        valid_to_utc: toIso(item.validTimeTo),
        base_ft: toNumber(item.base),
        top_ft: toNumber(item.top),
        raw: item.rawText,
      };
    })
    .filter(Boolean);
}

const INTENSITY = {
  NEG: 'none', SMTH: 'smooth', LGT: 'light', 'SMTH-LGT': 'smooth to light', 'LGT-MOD': 'light to moderate',
  MOD: 'moderate', 'MOD-SEV': 'moderate to severe', SEV: 'severe', 'SEV-EXTM': 'severe to extreme', EXTM: 'extreme', TRC: 'trace',
  'TRC-LGT': 'trace to light',
};

function intensity(value) {
  const key = String(value || '').toUpperCase().trim();
  return key ? INTENSITY[key] || key.toLowerCase() : null;
}

function pirepSummary(item) {
  const parts = [];
  const turbulence = intensity(item.tbInt1);
  if (turbulence === 'none' || turbulence === 'smooth') parts.push('smooth air');
  else if (turbulence) parts.push(`${turbulence} turbulence${item.tbType1 ? ` (${item.tbType1})` : ''}`);
  const icing = intensity(item.icgInt1);
  if (icing === 'none') parts.push('no icing');
  else if (icing) parts.push(`${icing} icing${item.icgType1 ? ` (${String(item.icgType1).toLowerCase()})` : ''}`);
  const clouds = Array.isArray(item.clouds) ? item.clouds : [];
  clouds.slice(0, 2).forEach((cloud) => {
    if (!cloud?.cover) return;
    const base = cloud.base != null ? `${Number(cloud.base).toLocaleString('en-US')}` : '?';
    const top = cloud.top != null && Number(cloud.top) > Number(cloud.base || 0) ? `${Number(cloud.top).toLocaleString('en-US')}` : null;
    parts.push(`${cloud.cover} ${base}${top ? `-${top}` : ''} ft`);
  });
  if (item.wxString) parts.push(item.wxString);
  if (item.temp != null) parts.push(`${item.temp}°C`);
  if (item.wdir != null && item.wspd != null) parts.push(`wind ${String(item.wdir).padStart(3, '0')}° ${item.wspd} kt`);
  return parts.join(' · ');
}

async function pireps(center) {
  const box = boundingBox(center, PIREP_RADIUS_NM);
  const list = await fetchJson(`${API_BASE}/pirep?bbox=${box.minLat},${box.minLon},${box.maxLat},${box.maxLon}&age=3&format=json`).catch(() => []);
  return (Array.isArray(list) ? list : [])
    .filter((item) => Number.isFinite(Number(item.lat)) && Number.isFinite(Number(item.lon)))
    .filter((item) => item.fltLvl == null || Number(item.fltLvl) <= PIREP_MAX_FL)
    .map((item) => {
      const point = { lat: Number(item.lat), lon: Number(item.lon) };
      const level = toNumber(item.fltLvl);
      return {
        observed_utc: toIso(item.obsTime),
        aircraft: item.acType || null,
        altitude_ft: level == null ? null : level * 100,
        distance_nm: round1(distanceNm(center, point)),
        bearing_deg: bearingDeg(center, point),
        urgent: item.pirepType === 'Urgent PIREP' || /\bUUA\b/.test(item.rawOb || ''),
        turbulence: ['none', 'smooth'].includes(intensity(item.tbInt1)) ? null : intensity(item.tbInt1),
        icing: intensity(item.icgInt1) === 'none' ? null : intensity(item.icgInt1),
        summary: pirepSummary(item) || 'No significant weather reported',
        raw: item.rawOb,
      };
    })
    .filter((item) => item.distance_nm <= PIREP_RADIUS_NM)
    .sort((a, b) => Date.parse(b.observed_utc) - Date.parse(a.observed_utc))
    .slice(0, 12);
}

export default handler(async (req) => {
  const center = coordinateParams(new URL(req.url));
  if (!center) return badRequest('lat and lon are required');

  const staleFeeds = new Set();
  const settled = await Promise.allSettled([sigmets(center, staleFeeds), gairmets(center, staleFeeds), cwas(center, staleFeeds), pireps(center)]);
  const [sigmetList, gairmetList, cwaList, pirepList] = settled.map((result) => (result.status === 'fulfilled' ? result.value : null));
  const failed = ['SIGMETs', 'G-AIRMETs', 'CWAs', 'PIREPs'].filter((_, index) => settled[index].status === 'rejected');
  const stale = [...staleFeeds];

  return json(
    {
      fetched_utc: new Date().toISOString(),
      radius_nm: AREA_RADIUS_NM,
      sigmets: sigmetList || [],
      gairmets: gairmetList || [],
      cwas: cwaList || [],
      pireps: pirepList || [],
      pirep_radius_nm: PIREP_RADIUS_NM,
      // Feeds that failed outright, and feeds served from an older cached copy.
      // The minimums check reports both instead of treating them as "none".
      unavailable: failed,
      stale,
    },
    { headers: { 'Cache-Control': 'public, max-age=180' } },
  );
});
