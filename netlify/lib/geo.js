// Great-circle helpers shared by the airport, TFR, advisory and winds-aloft
// functions. Distances are nautical miles; bearings are degrees true.

const EARTH_RADIUS_NM = 3440.065;
const RAD = Math.PI / 180;

export function distanceNm(a, b) {
  const lat1 = a.lat * RAD;
  const lat2 = b.lat * RAD;
  const dLat = (b.lat - a.lat) * RAD;
  const dLon = (b.lon - a.lon) * RAD;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return EARTH_RADIUS_NM * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

export function bearingDeg(a, b) {
  const lat1 = a.lat * RAD;
  const lat2 = b.lat * RAD;
  const dLon = (b.lon - a.lon) * RAD;
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  return Math.round(((Math.atan2(y, x) / RAD) + 360) % 360);
}

export function round1(value) {
  return Math.round(value * 10) / 10;
}

// Ray-casting point-in-polygon. `ring` is an array of { lat, lon }.
export function pointInRing(point, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const a = ring[i];
    const b = ring[j];
    const crosses = (a.lat > point.lat) !== (b.lat > point.lat)
      && point.lon < ((b.lon - a.lon) * (point.lat - a.lat)) / (b.lat - a.lat) + a.lon;
    if (crosses) inside = !inside;
  }
  return inside;
}

// Distance from a point to the nearest edge of a ring, using a local flat-earth
// projection. Accurate to well under a mile at the ranges we care about
// (TFRs and advisories within ~100 NM).
export function distanceToRingNm(point, ring) {
  if (ring.length === 0) return Infinity;
  const kx = Math.cos(point.lat * RAD) * 60;
  const ky = 60;
  const project = (p) => ({ x: (p.lon - point.lon) * kx, y: (p.lat - point.lat) * ky });
  let best = Infinity;
  for (let i = 0; i < ring.length; i += 1) {
    const a = project(ring[i]);
    const b = project(ring[(i + 1) % ring.length]);
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const lengthSq = dx * dx + dy * dy;
    const t = lengthSq ? Math.max(0, Math.min(1, -(a.x * dx + a.y * dy) / lengthSq)) : 0;
    best = Math.min(best, Math.hypot(a.x + t * dx, a.y + t * dy));
  }
  return best;
}

// Returns 0 when the point is inside the polygon, otherwise distance to edge.
export function distanceToPolygonNm(point, ring) {
  if (pointInRing(point, ring)) return 0;
  return distanceToRingNm(point, ring);
}

export function toRing(coords) {
  // Accepts [{lat, lon}] (AviationWeather) or [[lon, lat]] (GeoJSON).
  return (coords || [])
    .map((item) => (Array.isArray(item) ? { lat: Number(item[1]), lon: Number(item[0]) } : { lat: Number(item.lat), lon: Number(item.lon) }))
    .filter((item) => Number.isFinite(item.lat) && Number.isFinite(item.lon));
}

export function boundingBox(center, radiusNm) {
  const dLat = radiusNm / 60;
  const dLon = radiusNm / (60 * Math.max(0.2, Math.cos(center.lat * RAD)));
  return {
    minLat: center.lat - dLat,
    minLon: center.lon - dLon,
    maxLat: center.lat + dLat,
    maxLon: center.lon + dLon,
  };
}
