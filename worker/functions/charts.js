import { cached, TTL_OVERRIDE } from '../lib/cache.js';
import { airacCycle, chartSupplementEdition } from '../lib/cycles.js';
import { badRequest, fetchWithTimeout, handler, json } from '../lib/http.js';

// Official FAA charts for briefing an airport before takeoff:
// - the airport diagram, hot spots and LAHSO charts from the d-TPP, and
// - the airport's page(s) in the Chart Supplement, which includes the
//   runway sketch for fields that have no airport diagram.
// The FAA publishes one metadata index per cycle for each: 16 MB for the
// d-TPP, 1.5 MB for the Chart Supplement. Parsing either whole takes longer
// than the 10 ms of CPU a Worker gets per request on Cloudflare's free plan,
// so each lookup reads the index only until it reaches the one airport it
// needs, and caches that airport's entry for the rest of the cycle.
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

// Returns the first record (from `startTag` through `endTag`) that contains
// `needle`, or null, reading `body` (a stream of bytes) only as far as needed.
// The text kept in memory is just the record being read, never the whole file.
export async function findRecord(body, needle, startTag, endTag) {
  const reader = body.pipeThrough(new TextDecoderStream()).getReader();
  let text = '';
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return null;
      text += value;
      const hit = text.indexOf(needle);
      if (hit >= 0) {
        const end = text.indexOf(endTag, hit);
        if (end >= 0) return text.slice(text.lastIndexOf(startTag, hit), end + endTag.length);
      } else {
        const last = text.lastIndexOf(startTag);
        text = last >= 0 ? text.slice(last) : text.slice(-needle.length);
      }
    }
  } finally {
    // Stops the download once the airport is found.
    reader.cancel().catch(() => {});
  }
}

const INDEXES = {
  tpp: {
    url: (cycle) => `${TPP_BASE}/${cycle}/xml_data/d-tpp_Metafile.xml`,
    record: (ident) => [`apt_ident="${ident}"`, '<airport_name ', '</airport_name>'],
    parse: parseTppMetafile,
  },
  dcs: {
    url: (cycle) => `${DCS_BASE}/${cycle}/afd_${cycle}.xml`,
    record: (ident) => [`<aptid>${ident}</aptid>`, '<airport>', '</airport>'],
    parse: parseChartSupplementIndex,
  },
};

// A fallback to the previous cycle is cached briefly, so the new cycle's
// charts are picked up once the FAA posts them.
const FALLBACK_TTL_MS = 60 * 60 * 1000;

async function lookup(kind, ident, cycleFor) {
  // The new cycle's metadata can lag its effective time slightly, so fall
  // back to the previous cycle if the current one is not published yet.
  const index = INDEXES[kind];
  let lastError;
  for (const offset of [0, -1]) {
    const cycle = cycleFor(offset);
    const url = index.url(cycle.id);
    try {
      const res = await fetchWithTimeout(url, { timeoutMs: 9000, retries: 0 });
      if (!res.ok) throw new Error(`${res.status} from ${new URL(url).host}`);
      const record = await findRecord(res.body, ...index.record(ident));
      const value = { cycle: cycle.id, entry: record ? index.parse(record)[ident] ?? null : null };
      return offset ? { [TTL_OVERRIDE]: FALLBACK_TTL_MS, value } : value;
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
    cached(`charts/tpp/v2/${tppCycle.id}/${ident}`, 28 * 24 * 60 * 60 * 1000, () => lookup('tpp', ident, (offset) => airacCycle(now, offset)), { maxStaleMs: 35 * 24 * 60 * 60 * 1000 }),
    cached(`charts/dcs/v2/${dcsEdition.id}/${ident}`, 56 * 24 * 60 * 60 * 1000, () => lookup('dcs', ident, (offset) => chartSupplementEdition(now, offset)), { maxStaleMs: 63 * 24 * 60 * 60 * 1000 }),
  ]);

  const tppResult = tpp.status === 'fulfilled' ? tpp.value.value : null;
  const dcsResult = dcs.status === 'fulfilled' ? dcs.value.value : null;
  const entry = tppResult?.entry || null;
  const pages = dcsResult?.entry || [];

  return json(
    {
      ident,
      tpp_cycle: tppResult?.cycle || null,
      diagram: entry?.diagram ? { name: entry.diagram[0], url: chartUrl(tppResult.cycle, entry.diagram[1]) } : null,
      hot_spots: (entry?.hot_spots || []).map(([name, pdf]) => ({ name, url: chartUrl(tppResult.cycle, pdf) })),
      lahso: (entry?.lahso || []).map(([name, pdf]) => ({ name, url: chartUrl(tppResult.cycle, pdf) })),
      procedures: entry ? { iap: entry.iap, dp: entry.dp, star: entry.star } : null,
      chart_supplement: pages.length
        ? { edition: dcsResult.cycle, pages: pages.map((pdf) => `${DCS_BASE}/${dcsResult.cycle}/${pdf}`) }
        : null,
      unavailable: [tpp.status === 'rejected' ? 'airport diagrams' : null, dcs.status === 'rejected' ? 'Chart Supplement' : null].filter(Boolean),
    },
    { headers: { 'Cache-Control': 'public, max-age=21600' } },
  );
});
