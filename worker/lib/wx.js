import { flightCategory } from '../../src/lib/aviation/flightCategory.js';

export { flightCategory };

// Normalizes AviationWeather.gov METAR/TAF JSON into the shape the dashboard
// uses. Field names are descriptive (wind_speed_kt rather than wspd) and every
// value is either a number or null, never a string like "10+" or "VRB".

const CEILING_COVERS = new Set(['BKN', 'OVC', 'OVX', 'VV']);

export function toNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function toIso(value) {
  // AviationWeather mixes ISO strings and Unix epoch seconds across products.
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') return new Date(value * 1000).toISOString();
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function parseVisibility(value) {
  // "10+" / "6+" mean "greater than"; numbers may be fractional (0.25).
  if (value === null || value === undefined || value === '') return { sm: null, plus: false };
  if (typeof value === 'string' && value.trim().endsWith('+')) {
    return { sm: toNumber(value.trim().slice(0, -1)), plus: true };
  }
  return { sm: toNumber(value), plus: false };
}

export function parseAltimeterInHg(raw, altimHpa) {
  // Prefer the A#### group from the raw report so 29.90 shows exactly as
  // reported instead of being round-tripped through hectopascals.
  const match = /\bA(\d{4})\b/.exec(String(raw || ''));
  if (match) return Number(match[1]) / 100;
  const hpa = toNumber(altimHpa);
  if (hpa == null) return null;
  // Some feeds already supply inHg; anything under 40 is not hectopascals.
  if (hpa < 40) return Math.round(hpa * 100) / 100;
  return Math.round((hpa / 33.8639) * 100) / 100;
}

export function cloudLayers(clouds, raw) {
  // AviationWeather's JSON drops the CB/TCU suffix, so recover it from the raw
  // report by matching layer cover + height.
  const rawText = String(raw || '');
  return (Array.isArray(clouds) ? clouds : [])
    .filter((cloud) => cloud?.cover)
    .map((cloud) => {
      const base = toNumber(cloud.base);
      const hundreds = base == null ? null : String(Math.round(base / 100)).padStart(3, '0');
      const suffix = hundreds ? new RegExp(`\\b${cloud.cover}${hundreds}(CB|TCU)\\b`).exec(rawText)?.[1] : null;
      return { cover: cloud.cover, base_ft: base, type: suffix || cloud.type || null };
    });
}

export function ceilingFrom(layers, vertVisFt = null) {
  const layer = layers.find((item) => CEILING_COVERS.has(item.cover) && item.base_ft != null);
  if (layer) return layer.base_ft;
  return toNumber(vertVisFt);
}

function windFrom(source, raw) {
  const vrb = source.wdir === 'VRB' || /\bVRB\d{2,3}(G\d{2,3})?KT\b/.test(String(raw || ''));
  const dir = vrb ? null : toNumber(source.wdir);
  const speed = toNumber(source.wspd);
  const gust = toNumber(source.wgst);
  const variable = /\b(\d{3})V(\d{3})\b/.exec(String(raw || ''));
  return {
    wind_dir_deg: dir,
    wind_vrb: vrb,
    wind_speed_kt: speed,
    wind_gust_kt: gust,
    wind_calm: speed === 0 && !gust,
    wind_var_from_deg: variable ? Number(variable[1]) : null,
    wind_var_to_deg: variable ? Number(variable[2]) : null,
  };
}

const SKY_GROUP = /(?:^|\s)(?:CLR|SKC|NSC|NCD|CAVOK|(?:FEW|SCT|BKN|OVC)(?:\d{3}|\/\/\/)|VV(?:\d{3}|\/\/\/))(?=\s|CB|TCU|$)/;

export function normalizeMetar(metar) {
  if (!metar) return null;
  const raw = metar.rawOb || '';
  const remarks = raw.includes(' RMK ') ? raw.slice(raw.indexOf(' RMK ') + 5) : '';
  const body = raw.includes(' RMK ') ? raw.slice(0, raw.indexOf(' RMK ')) : raw;
  // An automated station with a failed ceilometer simply omits the sky group.
  // That means "unknown", never "clear": ceiling and category stay null.
  const skyReported = SKY_GROUP.test(body) || (Array.isArray(metar.clouds) && metar.clouds.length > 0);
  const layers = skyReported ? cloudLayers(metar.clouds, raw) : null;
  const visibility = parseVisibility(metar.visib);
  const vertVis = toNumber(metar.vertVis);
  const ceiling = layers ? ceilingFrom(layers, vertVis) : vertVis;
  return {
    station: metar.icaoId || null,
    name: metar.name || null,
    raw,
    type: metar.metarType || 'METAR',
    observed_utc: toIso(metar.reportTime) || toIso(metar.obsTime),
    auto: /\bAUTO\b/.test(body),
    ...windFrom(metar, body),
    visibility_sm: visibility.sm,
    visibility_plus: visibility.plus,
    wx: (metar.wxString || '').trim(),
    clouds: layers,
    sky_reported: skyReported,
    clear: Boolean(layers) && (layers.length === 0 || layers.every((layer) => ['CLR', 'SKC', 'NSC', 'NCD', 'CAVOK'].includes(layer.cover))),
    ceiling_ft: ceiling,
    vertical_visibility_ft: vertVis,
    temp_c: toNumber(metar.temp),
    dewpoint_c: toNumber(metar.dewp),
    altimeter_inhg: parseAltimeterInHg(body, metar.altim),
    flight_category: metar.fltCat || (skyReported && visibility.sm != null ? flightCategory(ceiling, visibility.sm) : null),
    remarks,
    lat: toNumber(metar.lat),
    lon: toNumber(metar.lon),
  };
}

const CHANGE_TYPES = { FM: 'FM', BECMG: 'BECMG', TEMPO: 'TEMPO', PROB: 'PROB' };

export function normalizeTaf(taf) {
  // Base periods (initial, FM, BECMG) describe prevailing conditions and are
  // made complete by carrying unchanged fields forward from the previous base
  // period. TEMPO/PROB periods are overlays: null means "unchanged".
  if (!taf) return null;
  const fcsts = Array.isArray(taf.fcsts) ? taf.fcsts : [];
  const periods = [];
  let previousBase = null;

  fcsts.forEach((fcst) => {
    const change = CHANGE_TYPES[fcst.fcstChange] || (fcst.probability ? 'PROB' : 'BASE');
    const isOverlay = change === 'TEMPO' || change === 'PROB';
    const layers = cloudLayers(fcst.clouds, '').filter((layer) => layer.cover !== 'CAVOK');
    const visibility = parseVisibility(fcst.visib);
    const hasWind = fcst.wdir != null || fcst.wspd != null;
    const hasClouds = Array.isArray(fcst.clouds) && fcst.clouds.length > 0;

    let period = {
      change,
      probability: toNumber(fcst.probability),
      from_utc: toIso(fcst.timeFrom),
      to_utc: toIso(fcst.timeTo),
      becoming_by_utc: toIso(fcst.timeBec),
      ...(hasWind ? windFrom(fcst, '') : {
        wind_dir_deg: null, wind_vrb: false, wind_speed_kt: null, wind_gust_kt: null, wind_calm: false,
      }),
      visibility_sm: visibility.sm,
      visibility_plus: visibility.plus,
      wx: fcst.wxString ? String(fcst.wxString).trim() : (change === 'FM' ? '' : null),
      clouds: hasClouds ? layers : null,
      vertical_visibility_ft: toNumber(fcst.vertVis),
      wind_shear: fcst.wshearHgt != null
        ? { height_ft: toNumber(fcst.wshearHgt) * (toNumber(fcst.wshearHgt) < 100 ? 100 : 1), dir_deg: toNumber(fcst.wshearDir), speed_kt: toNumber(fcst.wshearSpd) }
        : null,
    };

    if (!isOverlay && previousBase && change === 'BECMG') {
      period = {
        ...period,
        ...(hasWind ? {} : {
          wind_dir_deg: previousBase.wind_dir_deg,
          wind_vrb: previousBase.wind_vrb,
          wind_speed_kt: previousBase.wind_speed_kt,
          wind_gust_kt: previousBase.wind_gust_kt,
          wind_calm: previousBase.wind_calm,
        }),
        visibility_sm: period.visibility_sm ?? previousBase.visibility_sm,
        visibility_plus: period.visibility_sm == null ? previousBase.visibility_plus : period.visibility_plus,
        wx: period.wx ?? previousBase.wx,
        clouds: period.clouds ?? previousBase.clouds,
      };
    }

    if (!isOverlay) {
      if (period.clouds == null) period.clouds = [];
      if (period.wx == null) period.wx = '';
    }

    const ceiling = period.clouds ? ceilingFrom(period.clouds, period.vertical_visibility_ft) : period.vertical_visibility_ft;
    period.ceiling_ft = ceiling;
    period.flight_category = period.clouds == null && period.visibility_sm == null
      ? null
      : flightCategory(ceiling, period.visibility_sm);

    periods.push(period);
    if (!isOverlay) previousBase = period;
  });

  // BECMG periods in the AviationWeather feed end when the next group starts,
  // which matches how pilots read them (the new conditions persist).
  return {
    station: taf.icaoId || null,
    name: taf.name || null,
    raw: taf.rawTAF || '',
    issued_utc: toIso(taf.issueTime),
    valid_from_utc: toIso(taf.validTimeFrom),
    valid_to_utc: toIso(taf.validTimeTo),
    amended: /\bTAF AMD\b/.test(taf.rawTAF || ''),
    periods,
  };
}
