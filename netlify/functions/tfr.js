import { cached } from '../lib/cache.js';
import { distanceToPolygonNm, round1, toRing } from '../lib/geo.js';
import { coordinateParams, fetchJson, fetchText, handler, json, badRequest } from '../lib/http.js';

// The FAA's TFR list API (tfrapi/exportTfrList) has no coordinates, so the
// previous distance filter silently matched nothing. The FAA TFR GeoServer
// layer has the actual polygons; detail XML adds effective times/altitudes.
const GEO_URL = 'https://tfr.faa.gov/geoserver/TFR/ows?service=WFS&version=1.1.0&request=GetFeature&typeName=TFR:V_TFR_LOC&maxFeatures=1000&outputFormat=application/json&srsname=EPSG:4326';
const DETAIL_URL = (key) => `https://tfr.faa.gov/download/detail_${key}.xml`;
const PAGE_URL = (key) => `https://tfr.faa.gov/tfr3/?page=detail_${key}`;
const SEARCH_RADIUS_NM = 100;
const DETAIL_RADIUS_NM = 50;

function notamId(feature) {
  // NOTAM_KEY looks like "6/6618-1-FDC-F"; the NOTAM number is "6/6618".
  return String(feature.properties?.NOTAM_KEY || '').split('-')[0] || null;
}

function rings(geometry) {
  if (!geometry) return [];
  if (geometry.type === 'Polygon') return [toRing(geometry.coordinates[0])];
  if (geometry.type === 'MultiPolygon') return geometry.coordinates.map((polygon) => toRing(polygon[0]));
  return [];
}

function tagValues(xml, tag) {
  return [...String(xml).matchAll(new RegExp(`<${tag}>([^<]*)</${tag}>`, 'g'))].map((match) => match[1].trim());
}

export function parseDetail(xml) {
  // Times in the detail XML are UTC. A TFR can have several areas/schedules;
  // report the overall window and the highest ceiling.
  const effective = tagValues(xml, 'dateEffective').map((value) => Date.parse(`${value}Z`)).filter(Number.isFinite);
  const expire = tagValues(xml, 'dateExpire').map((value) => Date.parse(`${value}Z`)).filter(Number.isFinite);
  const uppers = tagValues(xml, 'valDistVerUpper').map(Number).filter(Number.isFinite);
  const upperUnits = tagValues(xml, 'uomDistVerUpper');
  const upperCodes = tagValues(xml, 'codeDistVerUpper');
  const topIndex = uppers.length ? uppers.indexOf(Math.max(...uppers)) : -1;
  let top = topIndex >= 0 ? uppers[topIndex] : null;
  if (top != null && (upperUnits[topIndex] === 'FL' || upperCodes[topIndex] === 'STD')) top *= 100;
  return {
    effective_utc: effective.length ? new Date(Math.min(...effective)).toISOString() : null,
    expire_utc: expire.length ? new Date(Math.max(...expire)).toISOString() : null,
    top_ft: top,
    top_unlimited: top != null && top >= 99999,
  };
}

async function detail(key) {
  return cached(`tfr/v1/detail/${key}`, 60 * 60 * 1000, async () => parseDetail(await fetchText(DETAIL_URL(key), { timeoutMs: 5000 })))
    .then((result) => result.value)
    .catch(() => null);
}

export default handler(async (req) => {
  const center = coordinateParams(new URL(req.url));
  if (!center) return badRequest('lat and lon are required');

  // A TFR list more than an hour old is not served at all (the request fails
  // and the UI says TFRs could not be checked).
  const { value: collection, cached_utc, stale } = await cached('tfr/v1/national', 5 * 60 * 1000, () => fetchJson(GEO_URL, { timeoutMs: 8000 }), { maxStaleMs: 60 * 60 * 1000 });
  const features = Array.isArray(collection?.features) ? collection.features : [];

  // A TFR may be split into several features (one per area); keep the closest.
  const byId = new Map();
  for (const feature of features) {
    const id = notamId(feature);
    if (!id) continue;
    const distance = Math.min(...rings(feature.geometry).filter((ring) => ring.length >= 3).map((ring) => distanceToPolygonNm(center, ring)));
    if (!Number.isFinite(distance) || distance > SEARCH_RADIUS_NM) continue;
    const existing = byId.get(id);
    if (!existing || distance < existing.distance_nm) {
      byId.set(id, {
        id,
        key: id.replace('/', '_'),
        type: feature.properties?.LEGAL || 'TFR',
        title: feature.properties?.TITLE || '',
        state: feature.properties?.STATE || null,
        distance_nm: round1(distance),
        inside: distance === 0,
      });
    }
  }

  const nearby = [...byId.values()].sort((a, b) => a.distance_nm - b.distance_nm);
  const now = Date.now();
  const tfrs = await Promise.all(nearby.map(async (tfr) => {
    const info = tfr.distance_nm <= DETAIL_RADIUS_NM ? await detail(tfr.key) : null;
    const from = info?.effective_utc ? Date.parse(info.effective_utc) : null;
    const to = info?.expire_utc ? Date.parse(info.expire_utc) : null;
    const active = info ? (from == null || from <= now) && (to == null || to > now) : null;
    return {
      ...tfr,
      ...(info || {}),
      active,
      url: PAGE_URL(tfr.key),
    };
  }));

  return json(
    { fetched_utc: new Date().toISOString(), source_cached_utc: cached_utc, stale, radius_nm: SEARCH_RADIUS_NM, tfrs },
    { headers: { 'Cache-Control': 'public, max-age=300' } },
  );
});
