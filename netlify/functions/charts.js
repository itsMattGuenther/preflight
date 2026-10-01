import { cached } from '../lib/cache.js';
import { airacCycle, chartSupplementEdition } from '../lib/cycles.js';
import { badRequest, fetchText, handler, json } from '../lib/http.js';

// Official FAA charts for briefing an airport before takeoff:
// - the airport diagram, hot spots and LAHSO charts from the d-TPP, and
// - the airport's page(s) in the Chart Supplement, which includes the
//   runway sketch for fields that have no airport diagram.
// The FAA publishes a metadata index per cycle; we reduce it to a small
// lookup and cache it for the life of the cycle.
const TPP_BASE = 'https://aeronav.faa.gov/d-tpp';
const DCS_BASE = 'https://aeronav.faa.gov/afd';
const VFR_CHARTS = { APD: 'diagram', HOT: 'hot_spots', LAH: 'lahso' };

export function parseTppMetafile(xml) {
  const airports = {};
  const airportPattern = /<airport_name ID="([^"]*)" military="[YN]" apt_ident="([^"]*)" icao_ident="([^"]*)"[^>]*>([\s\S]*?)<\/airport_name>/g;
  const recordPattern = /<chart_code>([A-Z]+)<\/chart_code>\s*<chart_name>([^<]*)<\/chart_name>[\s\S]*?<pdf_name>([^<]*)<\/pdf_name>/g;
  let airport = airportPattern.exec(xml);
  while (airport) {
    const [, , ident, icao, body] = airport;
    const entry = { icao: icao || null, diagram: null, hot_spots: [], lahso: [], iap: 0, dp: 0, star: 0 };
    let record = recordPattern.exec(body);
    while (record) {
      const [, code, name, pdf] = record;
      const kind = VFR_CHARTS[code];
      if (kind === 'diagram') entry.diagram = [name, pdf];
      else if (kind) entry[kind].push([name, pdf]);
      else if (code === 'IAP') entry.iap += 1;
      else if (code === 'DP' || code === 'ODP') entry.dp += 1;
      else if (code === 'STR') entry.star += 1;
      record = recordPattern.exec(body);
    }
    recordPattern.lastIndex = 0;
    if (entry.diagram || entry.hot_spots.length || entry.lahso.length || entry.iap) airports[ident] = entry;
    airport = airportPattern.exec(xml);
  }
  return airports;
}

export function parseChartSupplementIndex(xml) {
  const airports = {};
  const pattern = /<aptid>([^<]+)<\/aptid>[\s\S]*?<pages>([\s\S]*?)<\/pages>/g;
  let match = pattern.exec(xml);
  while (match) {
    const pdfs = [...match[2].matchAll(/<pdf>([^<]+)<\/pdf>/g)].map((item) => item[1]);
    if (pdfs.length) airports[match[1].trim()] = pdfs;
    match = pattern.exec(xml);
  }
  return airports;
}

async function loadIndex(kind, cycleFor) {
  // The new cycle's metadata can lag its effective time slightly, so fall
  // back to the previous cycle if the current one is not published yet.
  let lastError;
  for (const offset of [0, -1]) {
    const cycle = cycleFor(offset);
    const url = kind === 'tpp' ? `${TPP_BASE}/${cycle.id}/xml_data/d-tpp_Metafile.xml` : `${DCS_BASE}/${cycle.id}/afd_${cycle.id}.xml`;
    try {
      const xml = await fetchText(url, { timeoutMs: 9000, retries: 0 });
      return { cycle: cycle.id, airports: kind === 'tpp' ? parseTppMetafile(xml) : parseChartSupplementIndex(xml) };
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

function chartUrl(cycle, pdf) {
  return `${TPP_BASE}/${cycle}/${pdf}`;
}

export default handler(async (req) => {
  const url = new URL(req.url);
  // Both indexes are keyed by FAA identifier (VBT, 7M5), not ICAO.
  const ident = String(url.searchParams.get('faa') || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5);
  if (!ident) return badRequest('faa identifier is required');
  const now = Date.now();
  const tppCycle = airacCycle(now);
  const dcsEdition = chartSupplementEdition(now);

  const [tpp, dcs] = await Promise.allSettled([
    cached(`charts/tpp/v1/${tppCycle.id}`, 28 * 24 * 60 * 60 * 1000, () => loadIndex('tpp', (offset) => airacCycle(now, offset)), { maxStaleMs: 35 * 24 * 60 * 60 * 1000 }),
    cached(`charts/dcs/v1/${dcsEdition.id}`, 56 * 24 * 60 * 60 * 1000, () => loadIndex('dcs', (offset) => chartSupplementEdition(now, offset)), { maxStaleMs: 63 * 24 * 60 * 60 * 1000 }),
  ]);

  const tppIndex = tpp.status === 'fulfilled' ? tpp.value.value : null;
  const dcsIndex = dcs.status === 'fulfilled' ? dcs.value.value : null;
  const entry = tppIndex?.airports?.[ident] || null;
  const pages = dcsIndex?.airports?.[ident] || [];

  return json(
    {
      ident,
      tpp_cycle: tppIndex?.cycle || null,
      diagram: entry?.diagram ? { name: entry.diagram[0], url: chartUrl(tppIndex.cycle, entry.diagram[1]) } : null,
      hot_spots: (entry?.hot_spots || []).map(([name, pdf]) => ({ name, url: chartUrl(tppIndex.cycle, pdf) })),
      lahso: (entry?.lahso || []).map(([name, pdf]) => ({ name, url: chartUrl(tppIndex.cycle, pdf) })),
      procedures: entry ? { iap: entry.iap, dp: entry.dp, star: entry.star } : null,
      chart_supplement: pages.length
        ? { edition: dcsIndex.cycle, pages: pages.map((pdf) => `${DCS_BASE}/${dcsIndex.cycle}/${pdf}`) }
        : null,
      unavailable: [tpp.status === 'rejected' ? 'airport diagrams' : null, dcs.status === 'rejected' ? 'Chart Supplement' : null].filter(Boolean),
    },
    { headers: { 'Cache-Control': 'public, max-age=21600' } },
  );
});
