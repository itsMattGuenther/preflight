import { cached } from '../lib/cache.js';
import { fetchWithTimeout, handler, json, normalizeIcao, badRequest } from '../lib/http.js';

const NOTAM_URL = 'https://external-api.faa.gov/notamapi/v1/notams';
const PAGE_SIZE = 250;

export function normalizeNotam(item) {
  // The FAA API returns GeoJSON features with the NOTAM nested under
  // properties.coreNOTAMData.notam; older/alternate shapes are flat.
  const notam = item?.properties?.coreNOTAMData?.notam || item || {};
  const translations = item?.properties?.coreNOTAMData?.notamTranslation || [];
  const domestic = translations.find((entry) => entry.type === 'LOCAL_FORMAT')?.simpleText;
  const text = String(notam.text || domestic || notam.icaoMessage || notam.traditionalMessage || notam.summary || '').trim();
  return {
    id: notam.number || notam.id || notam.notamNumber || null,
    type: notam.type || null,
    classification: notam.classification || null,
    location: notam.location || notam.icaoLocation || null,
    text,
    domestic: domestic ? String(domestic).trim() : null,
    issued_utc: notam.issued || null,
    effective_from_utc: notam.effectiveStart || null,
    effective_to_utc: notam.effectiveEnd && notam.effectiveEnd !== 'PERM' ? notam.effectiveEnd : null,
    permanent: notam.effectiveEnd === 'PERM',
  };
}

async function loadNotams(icao, clientId, clientSecret) {
  const res = await fetchWithTimeout(`${NOTAM_URL}?icaoLocation=${icao}&pageSize=${PAGE_SIZE}&sortBy=effectiveStartDate&sortOrder=Desc`, {
    headers: { client_id: clientId, client_secret: clientSecret, Accept: 'application/json' },
    timeoutMs: 9000,
  });
  if (!res.ok) throw new Error(`FAA NOTAM API returned ${res.status}`);
  const body = await res.json();
  const records = body.items || body.notams || body.content || (Array.isArray(body) ? body : []);
  const now = Date.now();
  const notams = records
    .map(normalizeNotam)
    .filter((notam) => notam.text)
    .filter((notam) => !notam.effective_to_utc || Date.parse(notam.effective_to_utc) > now);
  return { notams, total: body.totalCount ?? notams.length };
}

export default handler(async (req) => {
  const icao = normalizeIcao(new URL(req.url).searchParams.get('icao'));
  if (!icao) return badRequest('icao is required');

  const clientId = process.env.FAA_NOTAM_CLIENT_ID;
  const clientSecret = process.env.FAA_NOTAM_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    // Say so explicitly. The UI must never present "no data" as "no NOTAMs".
    return json({ configured: false, fetched_utc: new Date().toISOString(), notams: [] });
  }

  const { value, cached_utc, stale, error } = await cached(`notams/v2/${icao}`, 10 * 60 * 1000, () => loadNotams(icao, clientId, clientSecret));
  return json({
    configured: true,
    fetched_utc: cached_utc,
    stale,
    error: error || null,
    total: value.total,
    notams: value.notams,
  });
});
