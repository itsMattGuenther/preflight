// Personal minimums: the pilot's own limits (or the limits on a student's solo
// endorsement), checked against current and forecast conditions for a flight
// window. The output is a list of individual checks so the pilot can see
// exactly why the summary says what it says. It is a decision aid that
// supports, and never replaces, a full briefing and pilot judgment.

import { formatFeet, formatVisibility, padHeading } from '../format.js';
import { densityAltitude } from './density.js';
import { weatherHazards } from './metar.js';
import { tafConditionsInWindow, tafCoverage } from './taf.js';
import { runwayWinds } from './wind.js';
import { isActiveDuring, classifyNotam } from './notam.js';

export const MINIMUM_FIELDS = [
  { key: 'ceiling_ft', label: 'Lowest ceiling', unit: 'ft AGL', min: 500, max: 10000, step: 100, type: 'min' },
  { key: 'visibility_sm', label: 'Lowest visibility', unit: 'SM', min: 1, max: 10, step: 0.5, type: 'min' },
  { key: 'wind_kt', label: 'Highest surface wind', unit: 'kt', min: 0, max: 40, step: 1, type: 'max' },
  { key: 'gust_kt', label: 'Highest gust', unit: 'kt', min: 0, max: 50, step: 1, type: 'max' },
  { key: 'gust_spread_kt', label: 'Largest gust spread', unit: 'kt', min: 0, max: 25, step: 1, type: 'max', hint: 'Gust minus steady wind' },
  { key: 'crosswind_kt', label: 'Highest crosswind', unit: 'kt', min: 0, max: 30, step: 1, type: 'max', hint: 'Gusts included' },
  { key: 'density_altitude_ft', label: 'Highest density altitude', unit: 'ft', min: 0, max: 12000, step: 500, type: 'max' },
  { key: 'min_runway_ft', label: 'Shortest runway', unit: 'ft', min: 0, max: 8000, step: 100, type: 'min', hint: '0 = any length' },
];

export const PRESETS = {
  student: {
    label: 'Student solo (example)',
    description: 'Typical of solo endorsement limits. Use the exact limits your CFI wrote in your logbook.',
    values: {
      ceiling_ft: 3000, visibility_sm: 5, wind_kt: 12, gust_kt: 15, gust_spread_kt: 5, crosswind_kt: 6,
      density_altitude_ft: 5000, min_runway_ft: 3000, paved_only: true, day_only: true, margin_pct: 15,
    },
  },
  newPrivate: {
    label: 'New private pilot',
    description: 'Conservative limits for the first 100 hours after the checkride.',
    values: {
      ceiling_ft: 2500, visibility_sm: 5, wind_kt: 18, gust_kt: 22, gust_spread_kt: 8, crosswind_kt: 10,
      density_altitude_ft: 6000, min_runway_ft: 2500, paved_only: false, day_only: false, margin_pct: 15,
    },
  },
  experienced: {
    label: 'Experienced VFR',
    description: 'Current, proficient VFR pilot in a familiar airplane.',
    values: {
      ceiling_ft: 1500, visibility_sm: 3, wind_kt: 25, gust_kt: 30, gust_spread_kt: 12, crosswind_kt: 15,
      density_altitude_ft: 8000, min_runway_ft: 2000, paved_only: false, day_only: false, margin_pct: 10,
    },
  },
};

export const DEFAULT_MINIMUMS = { preset: 'student', ...PRESETS.student.values };

const STATUS_RANK = { pass: 0, info: 0, unknown: 1, caution: 2, fail: 3 };

function worst(a, b) {
  return STATUS_RANK[b.status] > STATUS_RANK[a.status] ? b : a;
}

function limitStatus(value, limit, type, marginPct) {
  if (value == null || limit == null || limit === '') return null;
  const margin = Math.abs(limit) * ((marginPct ?? 0) / 100);
  if (type === 'min') {
    if (value < limit) return 'fail';
    if (value < limit + margin) return 'caution';
    return 'pass';
  }
  if (value > limit) return 'fail';
  if (value > limit - margin) return 'caution';
  return 'pass';
}

// TEMPO conditions are forecast to occur (briefly), so a TEMPO breach is a
// real breach. PROB groups are only possible, so a PROB breach is a caution
// with the reason spelled out.
function softenFor(kind, status) {
  if (kind === 'possible' && status === 'fail') return 'caution';
  return status;
}

function conditionSets({ metar, taf, startMs, endMs, now, formatTime }) {
  const sets = [];
  const startsNow = startMs <= now + 45 * 60 * 1000;
  if (metar && startsNow) {
    sets.push({ kind: 'current', label: 'now (METAR)', conditions: metar });
  }
  for (const item of tafConditionsInWindow(taf, Math.max(startMs, now), endMs)) {
    const period = item.period;
    const range = `${formatTime(period.from_utc)}-${formatTime(period.to_utc)}`;
    const label = item.kind === 'forecast'
      ? `forecast ${range}`
      : item.kind === 'temporary' ? `TEMPO ${range}` : `PROB${period.probability ?? ''} ${range}`;
    sets.push({ kind: item.kind, label, conditions: item.conditions });
  }
  return sets;
}

function check(id, label, limitText) {
  return { id, label, status: 'pass', value: '--', limit: limitText, note: null };
}

function evaluateNumeric({ id, label, sets, getValue, limit, type, marginPct, format, limitText }) {
  let result = { ...check(id, label, limitText), status: 'unknown', value: 'No data' };
  let found = false;
  for (const set of sets) {
    const value = getValue(set.conditions);
    if (value == null) continue;
    const status = softenFor(set.kind, limitStatus(value, limit, type, marginPct));
    const candidate = { ...check(id, label, limitText), status, value: format(value), note: set.label, raw: value };
    if (!found) {
      result = candidate;
      found = true;
    } else {
      const better = type === 'min' ? value < result.raw : value > result.raw;
      if (STATUS_RANK[status] > STATUS_RANK[result.status] || (STATUS_RANK[status] === STATUS_RANK[result.status] && better)) result = candidate;
    }
  }
  return result;
}

function unlimitedCeiling(conditions) {
  // No ceiling is reported as null; treat as "unlimited" for comparisons.
  if (!conditions) return null;
  if (conditions.ceiling_ft != null) return conditions.ceiling_ft;
  return conditions.clouds ? 99999 : null;
}

export function evaluateMinimums({
  minimums,
  airport,
  metar,
  metarSource,
  taf,
  sun,
  tfrs,
  tfrsStale = false,
  advisories,
  notams,
  window,
  now = Date.now(),
  formatTime = (iso) => iso,
}) {
  const m = { ...DEFAULT_MINIMUMS, ...(minimums || {}) };
  const startMs = window?.startMs ?? now;
  const endMs = window?.endMs ?? now + 60 * 60 * 1000;
  const sets = conditionSets({ metar, taf, startMs, endMs, now, formatTime });
  const checks = [];
  const notChecked = [];
  const margin = m.margin_pct;

  if (!sets.length) {
    return {
      verdict: 'unknown',
      checks: [],
      notChecked: ['Weather: no current observation or forecast covers this window'],
    };
  }

  const futureOnly = startMs > now + 45 * 60 * 1000;
  const coverage = tafCoverage(taf, Math.max(startMs, now), endMs);
  if (!taf) notChecked.push('Forecast: no TAF within 40 NM, so only current conditions were checked');
  else if (coverage < 0.99 && endMs > now) notChecked.push('Forecast: the TAF does not cover your whole flight window');

  checks.push(evaluateNumeric({
    id: 'ceiling', label: 'Ceiling', sets, getValue: unlimitedCeiling, limit: m.ceiling_ft, type: 'min', marginPct: margin,
    format: (value) => (value >= 99999 ? 'None' : formatFeet(value)), limitText: `${formatFeet(m.ceiling_ft)}+`,
  }));
  checks.push(evaluateNumeric({
    id: 'visibility', label: 'Visibility', sets, getValue: (c) => c.visibility_sm, limit: m.visibility_sm, type: 'min', marginPct: margin,
    format: (value) => formatVisibility(value), limitText: `${formatVisibility(m.visibility_sm)}+`,
  }));
  checks.push(evaluateNumeric({
    id: 'wind', label: 'Surface wind', sets, getValue: (c) => c.wind_speed_kt, limit: m.wind_kt, type: 'max', marginPct: margin,
    format: (value) => `${value} kt`, limitText: `${m.wind_kt} kt max`,
  }));

  // Gusts: absolute gust and gust spread, reported as one row.
  const gustCheck = evaluateNumeric({
    id: 'gust', label: 'Gusts', sets, getValue: (c) => c.wind_gust_kt ?? (c.wind_speed_kt != null ? 0 : null), limit: m.gust_kt, type: 'max', marginPct: margin,
    format: (value) => (value ? `G${value} kt` : 'None'), limitText: `G${m.gust_kt} max`,
  });
  const spreadCheck = evaluateNumeric({
    id: 'gust_spread', label: 'Gust spread', sets,
    getValue: (c) => (c.wind_gust_kt != null && c.wind_speed_kt != null ? c.wind_gust_kt - c.wind_speed_kt : c.wind_speed_kt != null ? 0 : null),
    limit: m.gust_spread_kt, type: 'max', marginPct: margin, format: (value) => `${value} kt`, limitText: `${m.gust_spread_kt} kt max`,
  });
  const gustRow = worst(gustCheck, spreadCheck);
  checks.push({
    ...gustCheck,
    status: gustRow.status,
    value: gustCheck.value === 'None' ? 'None' : `${gustCheck.value} (spread ${spreadCheck.value})`,
    limit: `G${m.gust_kt}, spread ${m.gust_spread_kt} kt`,
    note: gustRow.note,
  });

  // Runways and crosswind: evaluate the best runway that meets the pilot's
  // surface/length limits, separately for each condition set (the wind may
  // shift during the window), with gusts included.
  const runways = airport?.runways || [];
  const runwayOptions = { pavedOnly: m.paved_only, minLengthFt: m.min_runway_ft || 0 };
  const eligible = runways.filter((runway) => (!m.paved_only || runway.paved !== false) && (!m.min_runway_ft || !runway.length_ft || runway.length_ft >= m.min_runway_ft));
  if (!runways.length) {
    checks.push({ ...check('runway', 'Runway', '--'), status: 'unknown', value: 'No runway data' });
  } else if (!eligible.length) {
    const reasons = [m.paved_only ? 'paved' : null, m.min_runway_ft ? `${formatFeet(m.min_runway_ft)}+` : null].filter(Boolean).join(', ');
    checks.push({ ...check('runway', 'Runway', reasons), status: 'fail', value: 'None suitable', note: `No runway here meets your limits (${reasons})` });
  }

  if (eligible.length) {
    let crosswind = { ...check('crosswind', 'Crosswind', `${m.crosswind_kt} kt max`), status: 'unknown', value: 'No wind data' };
    let crossRaw = -1;
    for (const set of sets) {
      if (set.conditions.wind_speed_kt == null) continue;
      const best = runwayWinds(runways, set.conditions, runwayOptions).find((item) => item.eligible);
      if (!best || best.worst_crosswind == null) continue;
      const value = best.worst_crosswind;
      const status = softenFor(set.kind, limitStatus(value, m.crosswind_kt, 'max', margin));
      const variable = set.conditions.wind_vrb;
      const tail = best.worst_tailwind > 0 ? `, ${Math.round(best.worst_tailwind)} kt tailwind` : '';
      const candidate = {
        ...check('crosswind', 'Crosswind', `${m.crosswind_kt} kt max`),
        status,
        value: `${Math.round(value)} kt · RWY ${best.id}${tail}`,
        note: `${set.label}${variable ? ' · variable wind, worst case assumed' : ''}${best.gust ? ' · gusts included' : ''}`,
      };
      if (STATUS_RANK[status] > STATUS_RANK[crosswind.status] || (STATUS_RANK[status] === STATUS_RANK[crosswind.status] && value > crossRaw) || crosswind.status === 'unknown') {
        crosswind = candidate;
        crossRaw = value;
      }
    }
    checks.push(crosswind);
  }

  // Weather hazards (thunderstorms, freezing precipitation, etc.).
  let hazardRow = { ...check('weather', 'Weather hazards', 'None'), value: 'None reported' };
  const hazardSets = new Map();
  for (const set of sets) {
    for (const hazard of weatherHazards(set.conditions)) {
      const status = set.kind === 'possible' && hazard.level === 'fail' ? 'caution' : hazard.level;
      hazardSets.set(hazard.label, [...new Set([...(hazardSets.get(hazard.label) || []), set.label])]);
      if (STATUS_RANK[status] > STATUS_RANK[hazardRow.status]) hazardRow = { ...hazardRow, status, value: hazard.label };
    }
  }
  if (hazardSets.size) {
    hazardRow.note = [...hazardSets].slice(0, 3).map(([label, when]) => `${label}: ${when.join(', ')}`).join('; ');
  }
  checks.push(hazardRow);

  // Density altitude only exists for current conditions (TAFs carry no temp).
  if (metar && m.density_altitude_ft) {
    const da = densityAltitude(airport?.elevation_ft, metar.temp_c, metar.altimeter_inhg);
    if (da == null) {
      checks.push({ ...check('density_altitude', 'Density altitude', `${formatFeet(m.density_altitude_ft)} max`), status: 'unknown', value: 'No temperature reported' });
    } else {
      const status = limitStatus(da, m.density_altitude_ft, 'max', margin);
      checks.push({
        ...check('density_altitude', 'Density altitude', `${formatFeet(m.density_altitude_ft)} max`),
        status,
        value: formatFeet(Math.round(da / 10) * 10),
        note: futureOnly ? 'current value; temperature at your departure time may differ' : 'now',
      });
    }
  }

  // Daylight.
  if (sun?.sunrise && sun?.sunset) {
    const sunrise = sun.sunrise.getTime();
    const sunset = sun.sunset.getTime();
    if (m.day_only) {
      let status = 'pass';
      let note = `Sunrise ${formatTime(sun.sunrise)}, sunset ${formatTime(sun.sunset)}`;
      if (startMs < sunrise || endMs > sunset) {
        status = 'fail';
        note = endMs > sunset ? `Flight would end after sunset (${formatTime(sun.sunset)})` : `Flight would start before sunrise (${formatTime(sun.sunrise)})`;
      } else if (sunset - endMs < 30 * 60 * 1000) {
        status = 'caution';
        note = `Lands within 30 minutes of sunset (${formatTime(sun.sunset)})`;
      }
      checks.push({ ...check('daylight', 'Daylight', 'Day only'), status, value: status === 'pass' ? 'Daytime' : status === 'caution' ? 'Close to sunset' : 'Outside daylight', note });
    } else {
      const nightAfter = sun.civil_dusk && endMs > sun.civil_dusk.getTime();
      const nightBefore = sun.civil_dawn && startMs < sun.civil_dawn.getTime();
      const lightsNeeded = startMs < sunrise || endMs > sunset;
      let note = `Sunset ${formatTime(sun.sunset)}`;
      if (nightAfter) note = `Night (14 CFR 1.1) begins ${formatTime(sun.civil_dusk)}; position lights from sunset ${formatTime(sun.sunset)}`;
      else if (nightBefore) note = `Night until civil twilight begins ${formatTime(sun.civil_dawn)}; position lights until sunrise ${formatTime(sun.sunrise)}`;
      else if (lightsNeeded) note = `Position lights required between sunset and sunrise (${formatTime(sun.sunset)} / ${formatTime(sun.sunrise)})`;
      checks.push({
        ...check('daylight', 'Daylight', 'Day or night'),
        status: 'info',
        value: nightAfter || nightBefore ? 'Includes night' : lightsNeeded ? 'Includes twilight' : 'Daytime',
        note,
      });
    }
  }

  // TFRs (undefined while loading, null if the feed failed).
  if (tfrs === undefined) {
    checks.push({ ...check('tfr', 'TFRs', 'None within 10 NM'), status: 'unknown', value: 'Loading…' });
  } else if (tfrs && tfrsStale) {
    checks.push({ ...check('tfr', 'TFRs', 'None within 10 NM'), status: 'unknown', value: 'Feed out of date', note: 'The FAA TFR feed did not respond; check tfr.faa.gov' });
  } else if (tfrs) {
    // "In effect during the flight" uses the TFR's own times against the
    // flight window, so a TFR that starts mid-flight counts. Unknown times
    // (detail record unavailable) are treated as possibly in effect.
    const duringFlight = (tfr) => {
      if (tfr.active === true) return true;
      if (tfr.active == null && !tfr.effective_utc) return null;
      const from = tfr.effective_utc ? Date.parse(tfr.effective_utc) : -Infinity;
      const to = tfr.expire_utc ? Date.parse(tfr.expire_utc) : Infinity;
      return from < endMs && to > startMs;
    };
    const relevant = tfrs.filter((tfr) => tfr.distance_nm <= 10);
    const base = check('tfr', 'TFRs', 'None within 10 NM');
    const blocking = relevant.find((tfr) => tfr.inside && duringFlight(tfr) !== false);
    const near = relevant.find((tfr) => duringFlight(tfr) !== false);
    if (blocking) {
      const certain = duringFlight(blocking) === true;
      checks.push({ ...base, status: 'fail', value: `Inside ${blocking.type} TFR`, note: `${blocking.title}${certain ? '' : ' (times unknown: check tfr.faa.gov)'}` });
    } else if (near) {
      const timesKnown = duringFlight(near) === true;
      checks.push({ ...base, status: 'caution', value: `${near.type} TFR ${near.distance_nm} NM away`, note: `${near.title}${timesKnown ? '' : ' (times unknown)'}` });
    } else {
      checks.push({ ...base, value: relevant.length ? 'None in effect during your flight' : 'None within 10 NM' });
    }
  } else {
    notChecked.push('TFRs: feed unavailable, check tfr.faa.gov');
  }

  // Weather advisories over the field.
  if (advisories === undefined) {
    checks.push({ ...check('advisories', 'SIGMETs / AIRMETs', 'None over field'), status: 'unknown', value: 'Loading…' });
  } else if (advisories) {
    const missing = [...(advisories.unavailable || []), ...(advisories.stale || [])].filter((name) => name !== 'PIREPs');
    const over = [...(advisories.sigmets || []), ...(advisories.cwas || []), ...(advisories.gairmets || [])].filter((item) => item.over_field);
    const relevant = over.filter((item) => item.hazard !== 'TURB-HI');
    const severe = relevant.find((item) => item.kind?.includes('SIGMET') || (item.kind === 'Center Weather Advisory' && /TS/.test(item.hazard || '')));
    // Mountain obscuration and icing well above pattern altitude matter for
    // cross-countries but not for a local flight, so they are shown as info.
    const isCaution = (item) => !['MT_OBSC', 'ICE'].includes(item.hazard) || (item.hazard === 'ICE' && (item.base_ft ?? 0) <= 5000);
    const cautions = relevant.filter(isCaution);
    const label = (items) => items.map((item) => item.label || item.hazard).filter((value, index, list) => list.indexOf(value) === index).slice(0, 2).join(', ');
    const base = check('advisories', 'SIGMETs / AIRMETs', 'None over field');
    if (severe) {
      checks.push({ ...base, status: 'fail', value: `${severe.kind} in effect`, note: severe.hazard });
    } else if (cautions.length) {
      checks.push({ ...base, status: 'caution', value: label(cautions), note: 'AIRMET-level hazard forecast over the airport' });
    } else if (missing.length) {
      checks.push({ ...base, status: 'unknown', value: `${missing.join(', ')} unavailable`, note: 'Check aviationweather.gov before flight' });
    } else if (relevant.length) {
      checks.push({ ...base, status: 'info', value: label(relevant), note: 'Forecast over the area; matters most if you leave the pattern' });
    } else {
      checks.push({ ...base, value: 'None over the field' });
    }
  } else {
    notChecked.push('SIGMETs/AIRMETs: feed unavailable');
  }

  // NOTAMs.
  if (!notams || notams.configured === false) {
    notChecked.push('NOTAMs: not available in Preflight, check the FAA NOTAM Search');
  } else {
    const closures = (notams.notams || []).filter((notam) => classifyNotam(notam) === 'closure' && isActiveDuring(notam, startMs, endMs));
    const airportClosed = closures.find((notam) => /\b(AD|AP)\b[^.]*\bCLSD\b|\bAIRPORT CLOSED\b/.test(String(notam.text).toUpperCase()));
    const base = check('notams', 'Closure NOTAMs', 'None');
    if (airportClosed) {
      checks.push({ ...base, status: 'fail', value: 'Airport closure NOTAM', note: airportClosed.text.slice(0, 140) });
    } else if (closures.length) {
      checks.push({ ...base, status: 'caution', value: `${closures.length} runway closure NOTAM${closures.length > 1 ? 's' : ''}`, note: closures[0].text.slice(0, 140) });
    } else {
      checks.push({ ...base, value: 'None during window', note: 'Still read every NOTAM before flight' });
    }
    if (notams.stale) notChecked.push('NOTAMs: FAA feed did not respond; showing an older copy');
  }

  // Observation freshness and source.
  if (metar) {
    const ageMin = Math.round((now - Date.parse(metar.observed_utc)) / 60000);
    if (ageMin > 75) checks.push({ ...check('metar_age', 'Observation age', '75 min'), status: 'caution', value: `${ageMin} min old`, note: 'Weather may have changed since this report' });
  }
  if (metarSource && !metarSource.is_field) {
    checks.push({
      ...check('wx_source', 'Weather source', 'On-field'),
      status: 'info',
      value: `${metarSource.icao}, ${metarSource.distance_nm} NM ${padHeading(metarSource.bearing_deg)}°`,
      note: 'This airport has no weather reporting; nearest station shown',
    });
  }

  // A check that could not be made is never treated as a pass: if any core
  // input is unknown the verdict is "can't fully check" (unless something
  // already fails, which is decisive on its own).
  const CORE = ['ceiling', 'visibility', 'wind', 'gust', 'crosswind', 'runway', 'weather', 'tfr', 'advisories'];
  const statuses = checks.map((item) => item.status);
  const coreUnknown = checks.some((item) => CORE.includes(item.id) && item.status === 'unknown')
    || (runways.length > 0 && eligible.length > 0 && !checks.some((item) => item.id === 'crosswind'));
  let verdict = 'within';
  if (statuses.includes('fail')) verdict = 'outside';
  else if (coreUnknown) verdict = 'unknown';
  else if (statuses.includes('caution')) verdict = 'near';

  return { verdict, checks, notChecked, futureOnly };
}

export const VERDICTS = {
  within: { label: 'Within your minimums', short: 'Within minimums', tone: 'go' },
  near: { label: 'Close to your limits', short: 'Near limits', tone: 'caution' },
  outside: { label: 'Outside your minimums', short: 'Outside minimums', tone: 'nogo' },
  unknown: { label: "Can't fully check", short: 'Incomplete', tone: 'unknown' },
};
