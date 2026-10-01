import { cached } from '../lib/cache.js';
import { badRequest, fetchText as fetchTextWithTimeout, handler, json, normalizeIcao } from '../lib/http.js';

const AIRNAV_BASE = 'https://www.airnav.com';
const REPORT_URL = `${AIRNAV_BASE}/fuel/report.html`;
const FUEL_STALE_DAYS = 30;

const SERVICE_LABELS = {
  FS: 'Full service',
  SS: 'Self service',
};

const MONTHS = {
  JAN: 0,
  FEB: 1,
  MAR: 2,
  APR: 3,
  MAY: 4,
  JUN: 5,
  JUL: 6,
  AUG: 7,
  SEP: 8,
  OCT: 9,
  NOV: 10,
  DEC: 11,
};

function fuelUrlFor(icao) {
  return `${AIRNAV_BASE}/airport/${encodeURIComponent(icao)}`;
}

async function fetchText(url) {
  return fetchTextWithTimeout(url, { headers: { Accept: 'text/html' }, timeoutMs: 6000 });
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function decodeHtml(value) {
  return String(value || '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&deg;/gi, ' deg ')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(parseInt(code, 16)));
}

function htmlToText(html) {
  return decodeHtml(String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<\/(?:p|tr|td|div|li|h[1-6]|table)>/gi, ' ')
    .replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

function number(value) {
  const parsed = Number(String(value || '').replace(/[$,]/g, ''));
  return Number.isFinite(parsed) ? parsed : null;
}

function parseAirnavDate(value) {
  const match = /^([0-9]{1,2})-([A-Za-z]{3})-([0-9]{4})$/.exec(String(value || '').trim());
  if (!match) return null;
  const month = MONTHS[match[2].toUpperCase()];
  if (month == null) return null;
  return new Date(Date.UTC(Number(match[3]), month, Number(match[1]), 12));
}

function freshnessFor(updated, guaranteed) {
  // Guaranteed AirNav prices may omit a normal update date, so they get their
  // own freshness label instead of being marked unknown/stale.
  if (guaranteed) return 'guaranteed';
  const date = parseAirnavDate(updated);
  if (!date) return 'unknown';
  const ageMs = Date.now() - date.getTime();
  return ageMs > FUEL_STALE_DAYS * 24 * 60 * 60 * 1000 ? 'stale' : 'current';
}

function parseFuelType(value) {
  const label = String(value || '').replace(/\s+/g, ' ').trim();
  const normalized = label.toUpperCase().replace(/JET-A/g, 'JET A');
  if (/^100LL\b/.test(normalized)) return { code: '100LL', label: '100LL Avgas' };
  if (/^JET\s*A\b/.test(normalized)) return { code: 'JET_A', label: 'Jet A' };
  if (/^MOGAS\b/.test(normalized)) return { code: 'MOGAS', label: 'Mogas' };
  return null;
}

function parseFuelHeaders(value) {
  const headers = [];
  const pattern = /\b(100LL(?:\s+Avgas)?|Jet\s*A|Mogas(?:\s+\(auto\))?)\b/gi;
  let match = pattern.exec(String(value || ''));
  while (match) {
    const type = parseFuelType(match[1]);
    if (type) headers.push(type);
    match = pattern.exec(String(value || ''));
  }
  return headers;
}

function serviceLabel(value) {
  const normalized = String(value || '').trim().toUpperCase();
  if (SERVICE_LABELS[normalized]) return SERVICE_LABELS[normalized];
  if (/^FULL/.test(normalized)) return 'Full service';
  if (/^SELF/.test(normalized)) return 'Self service';
  return String(value || '').trim() || 'Service';
}

function createFuelItem({ type, service, price, fbo, updated, guaranteed, sourceUrl }) {
  // Normalize every parser path into the same card-friendly fuel row. Null means
  // the source had a placeholder like "---" rather than a sellable price.
  const fuelType = parseFuelType(type);
  const pricePerGal = number(price);
  if (!fuelType || pricePerGal == null) return null;
  const item = {
    id: [fbo, fuelType.code, serviceLabel(service), pricePerGal, updated || (guaranteed ? 'guaranteed' : '')].filter(Boolean).join('|'),
    code: fuelType.code,
    label: fuelType.label,
    fbo: fbo || 'Airport fuel listing',
    service: serviceLabel(service),
    price_per_gal: pricePerGal,
    updated: updated || null,
    guaranteed: Boolean(guaranteed),
    freshness: freshnessFor(updated, guaranteed),
    source_url: sourceUrl,
  };
  return item;
}

function dedupeFuels(fuels) {
  const byKey = new Map();
  for (const fuel of fuels.filter(Boolean)) {
    const key = [fuel.fbo, fuel.code, fuel.service, fuel.price_per_gal, fuel.updated || '', fuel.guaranteed ? 'g' : ''].join('|');
    if (!byKey.has(key)) byKey.set(key, fuel);
  }
  return [...byKey.values()];
}

function mostRecentUpdated(fuels) {
  const dated = fuels
    .map((fuel) => ({ text: fuel.updated, date: parseAirnavDate(fuel.updated) }))
    .filter((item) => item.date)
    .sort((a, b) => b.date - a.date);
  if (dated.length) return dated[0].text;
  return fuels.some((fuel) => fuel.guaranteed) ? 'Guaranteed' : null;
}

function parseAirportFuelAvailability(html) {
  // First answer the product question: does AirNav say this airport sells fuel
  // at all? This drives the explicit "No fuel for sale" state.
  const servicesHtml = /<A name=["']?svcs["']?><\/A>\s*<H3>Airport Services<\/H3>([\s\S]*?)<\/TABLE>/i.exec(String(html || ''))?.[1] || '';
  const match = /Fuel available:[\s\S]*?<TD[^>]*>([\s\S]*?)<\/TD>/i.exec(servicesHtml);
  if (!match) return { hasFuel: false, summary: null, listedTypes: [] };
  const summary = htmlToText(match[1]);
  const hasFuel = Boolean(summary && !/^none$/i.test(summary));
  return {
    hasFuel,
    summary: summary || null,
    listedTypes: parseFuelHeaders(summary),
  };
}

function detailUrlsFromAirportPage(html, icao) {
  // FBO detail pages usually contain the cleanest price text. Gather same-
  // airport detail links before falling back to the airport summary table.
  const urls = new Set();
  const pattern = new RegExp(`href=["'](/airport/${escapeRegex(icao)}/[A-Za-z0-9_]+)["']`, 'gi');
  let match = pattern.exec(String(html || ''));
  while (match) {
    urls.add(`${AIRNAV_BASE}${match[1]}`);
    match = pattern.exec(String(html || ''));
  }
  return [...urls].slice(0, 6);
}

function parseDetailFboName(html) {
  const title = decodeHtml(/<TITLE>([\s\S]*?)<\/TITLE>/i.exec(String(html || ''))?.[1] || '');
  return /^AirNav:\s*(.*?)\s+at\s+/i.exec(title)?.[1]?.trim() || 'Airport fuel provider';
}

function parseDetailFuel(html, sourceUrl) {
  // Detail pages read like: "100LL Avgas Full service $6.81". This parser is
  // intentionally narrow so unrelated dollar amounts are ignored.
  const text = htmlToText(html);
  const fbo = parseDetailFboName(html);
  const updated = /Fuel prices as last reported on\s+([0-9]{1,2}-[A-Za-z]{3}-[0-9]{4})/i.exec(text)?.[1] || null;
  const guaranteed = /\bGUARANTEED\b|\bGUARANTEE OUR PRICES\b/i.test(text);
  const rows = [];
  const pattern = /\b(100LL(?:\s+Avgas)?|Jet\s*A|Mogas(?:\s+\(auto\))?)\s+(Full service|Self service)\s+\$?([0-9]+(?:\.[0-9]+)?)/gi;
  let match = pattern.exec(text);
  while (match) {
    rows.push(createFuelItem({
      type: match[1],
      service: match[2],
      price: match[3],
      fbo,
      updated,
      guaranteed,
      sourceUrl,
    }));
    match = pattern.exec(text);
  }
  return dedupeFuels(rows);
}

function parseFboNameNear(context) {
  // Airport summary tables do not wrap each FBO in a clean data object, so we
  // look backward from the fuel table to recover the business name cell.
  const businessCells = [...String(context || '').matchAll(/<TD[^>]*width=240[^>]*>([\s\S]*?)<\/TD>/gi)];
  const businessCell = businessCells[businessCells.length - 1]?.[1];
  const cellText = htmlToText(businessCell);
  if (cellText && !/^Business Name$/i.test(cellText)) return cellText;

  const moreInfo = /More info(?:\s+and\s+photos)?\s+of\s+([^<]+)/i.exec(context)?.[1];
  if (moreInfo) return htmlToText(moreInfo);
  const cellAlt = /alt=["']([^"']+)["']/i.exec(businessCell || '')?.[1];
  if (cellAlt) return decodeHtml(cellAlt).trim();

  const altMatches = [...String(context || '').matchAll(/alt=["']([^"']+)["']/gi)]
    .map((match) => decodeHtml(match[1]).trim())
    .filter((value) => value && !/(Image|Update|NATA|Titan|Multi Service|Crew|Cessna|PSI|AirNav)/i.test(value));
  return altMatches[0] || null;
}

function parseFuelTableText(text, { fbo, sourceUrl }) {
  // Summary tables encode columns as fuel types and rows as service types. The
  // parser pairs each price cell with the matching header/service combination.
  const compact = String(text || '').replace(/\s+/g, ' ').trim();
  const firstService = /\b(?:FS|SS)\b/i.exec(compact);
  if (!firstService) return [];

  const headers = parseFuelHeaders(compact.slice(0, firstService.index));
  if (!headers.length) return [];

  const updated = /Updated\s+([0-9]{1,2}-[A-Za-z]{3}-[0-9]{4})/i.exec(compact)?.[1] || null;
  const guaranteed = /\bGUARANTEED\b/i.test(compact);
  const serviceText = compact
    .slice(firstService.index)
    .replace(/\bUpdated\s+[0-9]{1,2}-[A-Za-z]{3}-[0-9]{4}[\s\S]*$/i, ' ')
    .replace(/\bGUARANTEED\b[\s\S]*$/i, ' ');
  const markers = [...serviceText.matchAll(/\b(FS|SS)\b/gi)];
  const rows = [];

  markers.forEach((marker, index) => {
    const start = marker.index + marker[0].length;
    const end = markers[index + 1]?.index ?? serviceText.length;
    const values = serviceText.slice(start, end).match(/\$[0-9]+(?:\.[0-9]+)?|---/g) || [];
    values.slice(0, headers.length).forEach((rawPrice, headerIndex) => {
      rows.push(createFuelItem({
        type: headers[headerIndex].label,
        service: marker[1],
        price: rawPrice,
        fbo,
        updated,
        guaranteed,
        sourceUrl,
      }));
    });
  });

  return dedupeFuels(rows);
}

function parseAirportFuelTables(html, icao, sourceUrl) {
  const section = /FBO, Fuel Providers[\s\S]*?(?:Would you like to see your business listed|Other Pages about|$)/i.exec(String(html || ''))?.[0] || '';
  const localSection = section.split(/Alternatives at nearby airports/i)[0];
  const tablePattern = /<table\b[^>]*>[\s\S]*?<\/table>/gi;
  const fuels = [];
  let match = tablePattern.exec(localSection);

  while (match) {
    const tableHtml = match[0];
    const text = htmlToText(tableHtml);
    const hasFuelHeader = /\b(?:100LL|Jet\s*A|Mogas)\b/i.test(text);
    const hasServiceRow = /\b(?:FS|SS)\b/i.test(text);
    const hasPriceCell = /\$[0-9]+(?:\.[0-9]+)?|---/.test(text);
    if (hasFuelHeader && hasServiceRow && hasPriceCell) {
      const context = localSection.slice(Math.max(0, match.index - 2500), match.index);
      fuels.push(...parseFuelTableText(text, {
        fbo: parseFboNameNear(context) || `${icao} fuel listing`,
        sourceUrl,
      }));
    }
    match = tablePattern.exec(localSection);
  }

  return dedupeFuels(fuels);
}

async function parseLocalFuel(icao, airportHtml, airportUrl) {
  // Local fuel data flow:
  // AirNav airport page -> availability check -> FBO detail pages -> summary
  // table fallback -> explicit available/no_fuel/unavailable status for the UI.
  const availability = parseAirportFuelAvailability(airportHtml);
  const warnings = [];

  if (!availability.hasFuel) {
    return {
      local: {
        airport: icao,
        fbo: null,
        status: 'no_fuel',
        status_message: 'No fuel for sale at this airport.',
        fuel_available: availability.summary,
        updated: null,
        source_url: airportUrl,
        fuels: [],
      },
      warnings,
    };
  }

  const detailUrls = detailUrlsFromAirportPage(airportHtml, icao);
  const detailResults = await Promise.allSettled(detailUrls.map((url) => fetchText(url)));
  const detailFuels = detailResults.flatMap((result, index) => (
    result.status === 'fulfilled' ? parseDetailFuel(result.value, detailUrls[index]) : []
  ));
  const fallbackFuels = detailFuels.length ? [] : parseAirportFuelTables(airportHtml, icao, airportUrl);
  const fuels = dedupeFuels([...detailFuels, ...fallbackFuels]);
  const fboNames = [...new Set(fuels.map((fuel) => fuel.fbo).filter(Boolean))];

  if (!fuels.length) {
    warnings.push(`AirNav lists fuel at ${icao}, but no public fuel prices were found.`);
    return {
      local: {
        airport: icao,
        fbo: null,
        status: 'unavailable',
        status_message: 'Fuel is listed at this airport, but current public prices are unavailable.',
        fuel_available: availability.summary,
        updated: null,
        source_url: airportUrl,
        fuels: [],
      },
      warnings,
    };
  }

  const staleCount = fuels.filter((fuel) => fuel.freshness === 'stale').length;
  if (staleCount) warnings.push(`${staleCount} fuel price ${staleCount === 1 ? 'listing is' : 'listings are'} more than ${FUEL_STALE_DAYS} days old.`);

  return {
    local: {
      airport: icao,
      fbo: fboNames.length === 1 ? fboNames[0] : `${fboNames.length} fuel providers`,
      status: 'available',
      status_message: null,
      fuel_available: availability.summary,
      updated: mostRecentUpdated(fuels),
      source_url: fuels[0]?.source_url || airportUrl,
      fuels,
    },
    warnings,
  };
}

function parseMarketRow(text, label) {
  const match = new RegExp(
    `${escapeRegex(label)}\\s+\\d+\\s+\\d+\\s+\\$([0-9.]+)\\s+\\$([0-9.]+)\\s+\\$([0-9.]+)\\s+\\d+\\s+\\$([0-9.]+)\\s+\\$([0-9.]+)\\s+\\$([0-9.]+)`,
    'i',
  ).exec(text);

  if (!match) return null;
  return {
    '100LL': { avg: number(match[1]), min: number(match[2]), max: number(match[3]) },
    JET_A: { avg: number(match[4]), min: number(match[5]), max: number(match[6]) },
  };
}

function parseMarket(html) {
  // The market report provides national/regional comparison values. Local price
  // rows remain visible even if this parser fails; they just lose comparison UI.
  const text = htmlToText(html);
  const labels = ['Alaska', 'Central', 'Eastern', 'Great Lakes', 'New England', 'Northwest Mountain', 'Southern', 'Southwest', 'Western-Pacific'];
  const regions = labels.reduce((acc, label) => {
    const row = parseMarketRow(text, label);
    if (row) acc[label] = row;
    return acc;
  }, {});

  return {
    prepared: /This report prepared by AirNav on\s+([0-9]{1,2}-[A-Za-z]{3}-[0-9]{4})/i.exec(text)?.[1] || null,
    report_window: /Report includes prices reported between\s+([^.]+?)(?:\s+At least|\s+Copyright|$)/i.exec(text)?.[1] || null,
    freshness_note: /At least 50% of prices are no more than\s+([^.]*)/i.exec(text)?.[1] || null,
    nationwide: parseMarketRow(text, 'Nationwide'),
    regions,
    source_url: REPORT_URL,
  };
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function comparison(price, reference) {
  if (price == null || !reference?.avg) {
    return {
      avg: null,
      delta_pct: null,
      status: null,
      index_position_pct: 50,
    };
  }

  const deltaPct = ((price - reference.avg) / reference.avg) * 100;
  return {
    avg: reference.avg,
    delta_pct: Math.round(deltaPct * 10) / 10,
    status: deltaPct <= -5 ? 'below average' : deltaPct >= 5 ? 'above average' : 'near average',
    index_position_pct: clamp(50 + deltaPct * 2, 4, 96),
  };
}

function addIndex(fuel, market) {
  // Attach market comparison fields directly to each local row so the React
  // component can stay presentation-focused.
  const national = comparison(fuel.price_per_gal, market?.nationwide?.[fuel.code]);

  return {
    ...fuel,
    market_avg: national.avg,
    market_reference_label: 'AirNav national avg',
    regional_avg: national.avg,
    market_delta_pct: national.delta_pct,
    market_status: national.status,
    index_position_pct: national.index_position_pct,
    national_avg: national.avg,
    national_delta_pct: national.delta_pct,
    national_market_status: national.status,
    national_index_position_pct: national.index_position_pct,
  };
}

// AirNav prices change at most daily, so each airport is scraped at most every
// six hours and the national report every twelve. Without this, every page
// view triggered up to eight AirNav requests.
const LOCAL_TTL_MS = 6 * 60 * 60 * 1000;
const REPORT_TTL_MS = 12 * 60 * 60 * 1000;

export default handler(async (req) => {
  const url = new URL(req.url);
  const icao = normalizeIcao(url.searchParams.get('icao'));
  if (!icao) return badRequest('icao is required');
  const airportUrl = fuelUrlFor(icao);
  const warnings = [];
  let local = {
    airport: icao,
    fbo: null,
    status: 'unavailable',
    status_message: 'Fuel source unavailable.',
    fuel_available: null,
    updated: null,
    source_url: airportUrl,
    fuels: [],
  };
  let market = null;

  // Local and market feeds are independent, so a failure in one should not hide
  // the other. allSettled lets us return warnings with whatever data survived.
  const [localResult, reportResult] = await Promise.allSettled([
    cached(`fuel/v1/local/${icao}`, LOCAL_TTL_MS, async () => parseLocalFuel(icao, await fetchText(airportUrl), airportUrl), { maxStaleMs: 7 * 24 * 60 * 60 * 1000 }),
    cached('fuel/v1/report', REPORT_TTL_MS, async () => parseMarket(await fetchText(REPORT_URL)), { maxStaleMs: 14 * 24 * 60 * 60 * 1000 }),
  ]);

  if (localResult.status === 'fulfilled') {
    local = localResult.value.value.local;
    warnings.push(...localResult.value.value.warnings);
  } else {
    warnings.push(`AirNav airport fuel page unavailable for ${icao}; local prices are not displayed.`);
  }

  if (reportResult.status === 'fulfilled') {
    market = reportResult.value.value;
  } else {
    warnings.push('AirNav fuel price report unavailable; market comparisons are hidden.');
  }

  const localSourceUrl = local.source_url || airportUrl;

  return json(
    {
      fetched_utc: localResult.status === 'fulfilled' ? localResult.value.cached_utc : new Date().toISOString(),
      local: {
        ...local,
        fuels: local.fuels.map((fuel) => addIndex(fuel, market)),
      },
      market,
      sources: [
        { label: 'AirNav airport/FBO fuel prices', url: localSourceUrl },
        { label: 'AirNav fuel price report', url: REPORT_URL },
      ],
      warnings,
    },
    { headers: { 'Cache-Control': 'public, max-age=900' } },
  );
});
