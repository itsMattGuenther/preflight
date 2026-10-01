// Turns a normalized TAF into "what is forecast at time t". Prevailing
// conditions come from the latest base group (initial, FM or BECMG) that has
// started; TEMPO and PROB groups are overlays describing temporary or possible
// worse conditions on top of the base, and are kept separate so the UI can
// distinguish "forecast" from "possible".

import { flightCategory } from './flightCategory.js';

const HOUR = 60 * 60 * 1000;
const OVERLAY_FIELDS = [
  'wind_dir_deg', 'wind_vrb', 'wind_speed_kt', 'wind_gust_kt', 'wind_calm', 'visibility_sm', 'visibility_plus', 'wx', 'clouds',
];

function ms(value) {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function tafValid(taf, t) {
  if (!taf) return false;
  const from = ms(taf.valid_from_utc);
  const to = ms(taf.valid_to_utc);
  return (from == null || t >= from) && (to == null || t < to);
}

export function basePeriodAt(taf, t) {
  if (!tafValid(taf, t)) return null;
  const bases = (taf.periods || []).filter((period) => !['TEMPO', 'PROB'].includes(period.change));
  let current = null;
  for (const period of bases) {
    const from = ms(period.from_utc);
    if (from == null || from <= t) current = period;
  }
  return current || bases[0] || null;
}

export function overlaysAt(taf, t) {
  if (!tafValid(taf, t)) return [];
  return (taf.periods || []).filter((period) => {
    if (!['TEMPO', 'PROB'].includes(period.change)) return false;
    const from = ms(period.from_utc);
    const to = ms(period.to_utc);
    return (from == null || from <= t) && (to == null || t < to);
  });
}

// Apply a TEMPO/PROB group on top of its base: null fields mean "unchanged".
export function applyOverlay(base, overlay) {
  if (!base) return overlay;
  const merged = { ...base, change: overlay.change, probability: overlay.probability, from_utc: overlay.from_utc, to_utc: overlay.to_utc };
  for (const field of OVERLAY_FIELDS) {
    if (overlay[field] !== null && overlay[field] !== undefined) merged[field] = overlay[field];
  }
  if (overlay.wind_speed_kt == null) {
    // A TEMPO group without a wind group keeps the base wind.
    merged.wind_dir_deg = base.wind_dir_deg;
    merged.wind_speed_kt = base.wind_speed_kt;
    merged.wind_gust_kt = base.wind_gust_kt;
    merged.wind_vrb = base.wind_vrb;
  }
  merged.ceiling_ft = overlay.clouds ? overlay.ceiling_ft : base.ceiling_ft;
  merged.flight_category = flightCategory(merged.ceiling_ft, merged.visibility_sm);
  return merged;
}

const CATEGORY_RANK = { VFR: 0, MVFR: 1, IFR: 2, LIFR: 3 };

export function worseCategory(a, b) {
  if (!a) return b;
  if (!b) return a;
  return CATEGORY_RANK[b] > CATEGORY_RANK[a] ? b : a;
}

/** Hourly slots for the timeline strip. */
export function tafSlots(taf, startMs, hours = 24) {
  if (!taf) return [];
  const first = Math.floor(startMs / HOUR) * HOUR;
  const slots = [];
  for (let i = 0; i < hours; i += 1) {
    const t = first + i * HOUR;
    const mid = t + HOUR / 2;
    const base = basePeriodAt(taf, mid);
    if (!base) {
      slots.push({ t, base: null, overlays: [], category: null, worst: null });
      continue;
    }
    const overlays = overlaysAt(taf, mid).map((overlay) => applyOverlay(base, overlay));
    const worst = overlays.reduce((acc, item) => worseCategory(acc, item.flight_category), base.flight_category);
    slots.push({ t, base, overlays, category: base.flight_category, worst });
  }
  return slots;
}

/**
 * Every forecast condition set that applies at some point in [startMs, endMs]:
 * base groups as kind 'forecast', TEMPO/PROB merged onto their base as kind
 * 'temporary' / 'possible'. Used by the personal-minimums check.
 */
export function tafConditionsInWindow(taf, startMs, endMs) {
  if (!taf) return [];
  const results = [];
  const seen = new Set();
  for (let t = startMs; t <= endMs; t += HOUR / 2) {
    const base = basePeriodAt(taf, t);
    if (!base) continue;
    const baseKey = `B${base.from_utc}`;
    if (!seen.has(baseKey)) {
      seen.add(baseKey);
      results.push({ kind: 'forecast', period: base, conditions: base });
    }
    for (const overlay of overlaysAt(taf, t)) {
      const key = `O${overlay.change}${overlay.from_utc}${overlay.probability}`;
      if (seen.has(key)) continue;
      seen.add(key);
      results.push({
        kind: overlay.change === 'TEMPO' ? 'temporary' : 'possible',
        period: overlay,
        conditions: applyOverlay(base, overlay),
      });
    }
  }
  return results;
}

export function tafCoverage(taf, startMs, endMs) {
  // How much of the window the TAF covers (TAFs are typically 24-30 hours).
  if (!taf) return 0;
  const from = ms(taf.valid_from_utc) ?? startMs;
  const to = ms(taf.valid_to_utc) ?? endMs;
  const covered = Math.max(0, Math.min(endMs, to) - Math.max(startMs, from));
  return endMs > startMs ? covered / (endMs - startMs) : tafValid(taf, startMs) ? 1 : 0;
}
