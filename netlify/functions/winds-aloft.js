import { cached } from '../lib/cache.js';
import stations from '../lib/data/fd-stations.json';
import { distanceNm, round1 } from '../lib/geo.js';
import { coordinateParams, fetchText, handler, json, badRequest } from '../lib/http.js';
import { parseFdText } from '../lib/windsAloft.js';

// The NWS FD forecast covers ~175 points across the contiguous US. We pick the
// nearest one to the selected airport. Station coordinates are a static table
// (netlify/lib/data/fd-stations.json) because the points never move.
const FD_URL = (hours) => `https://aviationweather.gov/api/data/windtemp?region=us&level=low&fcst=${hours}`;
const MAX_DISTANCE_NM = 150;

export default handler(async (req) => {
  const url = new URL(req.url);
  const center = coordinateParams(url);
  if (!center) return badRequest('lat and lon are required');

  const nearest = Object.entries(stations)
    .map(([id, [lat, lon, name]]) => ({ id, name, distance_nm: round1(distanceNm(center, { lat, lon })) }))
    .sort((a, b) => a.distance_nm - b.distance_nm)[0];
  if (!nearest || nearest.distance_nm > MAX_DISTANCE_NM) {
    return json({ fetched_utc: new Date().toISOString(), station: null, forecasts: [] });
  }

  const forecasts = await Promise.all(['06', '12'].map(async (hours) => {
    try {
      const { value } = await cached(`winds/v1/${hours}`, 30 * 60 * 1000, async () => parseFdText(await fetchText(FD_URL(hours))));
      return {
        hours,
        based_on: value.based_on,
        valid: value.valid,
        for_use: value.for_use,
        levels: value.stations[nearest.id] || [],
      };
    } catch {
      return null;
    }
  }));

  return json(
    { fetched_utc: new Date().toISOString(), station: nearest, forecasts: forecasts.filter(Boolean) },
    { headers: { 'Cache-Control': 'public, max-age=900' } },
  );
});
