import { useEffect, useMemo, useState } from 'react';
import { formatFeet, formatVisibility, formatWindShort } from '../lib/format';
import { readJson, writeJson } from '../lib/storage';

// "What changed since you last looked?" compares the current observation to
// the one this browser saw on the previous visit. The baseline is captured
// once per airport per page session and only replaced on the next visit, so
// background refreshes never reset it (the previous version overwrote its
// baseline every 15 seconds and so always compared against moments ago).

const MAX_AGE_MS = 3 * 24 * 60 * 60 * 1000;
const keyFor = (icao) => `preflight:lastSeen:${icao}`;

function snapshot(metar) {
  return {
    seen_utc: new Date().toISOString(),
    observed_utc: metar.observed_utc,
    station: metar.station,
    flight_category: metar.flight_category,
    wind_dir_deg: metar.wind_dir_deg,
    wind_vrb: metar.wind_vrb,
    wind_speed_kt: metar.wind_speed_kt,
    wind_gust_kt: metar.wind_gust_kt,
    wind_calm: metar.wind_calm,
    visibility_sm: metar.visibility_sm,
    visibility_plus: metar.visibility_plus,
    ceiling_ft: metar.ceiling_ft,
    altimeter_inhg: metar.altimeter_inhg,
    temp_c: metar.temp_c,
    wx: metar.wx,
  };
}

function angleDiff(a, b) {
  const diff = Math.abs(a - b) % 360;
  return diff > 180 ? 360 - diff : diff;
}

export function describeChanges(previous, current) {
  if (!previous || !current) return [];
  if (previous.station !== current.station) return [];
  const changes = [];
  if (previous.flight_category !== current.flight_category) {
    changes.push({ label: `Category ${previous.flight_category} → ${current.flight_category}`, important: true });
  }
  const windChanged = (previous.wind_dir_deg != null && current.wind_dir_deg != null && angleDiff(previous.wind_dir_deg, current.wind_dir_deg) >= 30)
    || Math.abs((previous.wind_speed_kt ?? 0) - (current.wind_speed_kt ?? 0)) >= 5
    || Boolean(previous.wind_gust_kt) !== Boolean(current.wind_gust_kt)
    || previous.wind_vrb !== current.wind_vrb;
  if (windChanged) changes.push({ label: `Wind ${formatWindShort(previous)} → ${formatWindShort(current)}`, important: (current.wind_speed_kt ?? 0) > (previous.wind_speed_kt ?? 0) });
  if (previous.ceiling_ft !== current.ceiling_ft && Math.abs((previous.ceiling_ft ?? 99999) - (current.ceiling_ft ?? 99999)) >= 500) {
    changes.push({
      label: `Ceiling ${previous.ceiling_ft != null ? formatFeet(previous.ceiling_ft) : 'none'} → ${current.ceiling_ft != null ? formatFeet(current.ceiling_ft) : 'none'}`,
      important: (current.ceiling_ft ?? 99999) < (previous.ceiling_ft ?? 99999),
    });
  }
  if (previous.visibility_sm !== current.visibility_sm) {
    changes.push({
      label: `Visibility ${formatVisibility(previous.visibility_sm, previous.visibility_plus)} → ${formatVisibility(current.visibility_sm, current.visibility_plus)}`,
      important: (current.visibility_sm ?? 10) < (previous.visibility_sm ?? 10),
    });
  }
  if ((previous.wx || '') !== (current.wx || '')) {
    changes.push({ label: current.wx ? `Weather now: ${current.wx}` : `${previous.wx} has ended`, important: Boolean(current.wx) });
  }
  if (previous.altimeter_inhg != null && current.altimeter_inhg != null && Math.abs(previous.altimeter_inhg - current.altimeter_inhg) >= 0.03) {
    changes.push({ label: `Altimeter ${previous.altimeter_inhg.toFixed(2)} → ${current.altimeter_inhg.toFixed(2)}`, important: false });
  }
  if (previous.temp_c != null && current.temp_c != null && Math.abs(previous.temp_c - current.temp_c) >= 3) {
    changes.push({ label: `Temperature ${Math.round(previous.temp_c)}° → ${Math.round(current.temp_c)}°C`, important: false });
  }
  return changes;
}

export function useLastSeen(icao, metar) {
  const [baseline, setBaseline] = useState({ icao: null, value: null });

  useEffect(() => {
    if (!icao || !metar || baseline.icao === icao) return;
    const stored = readJson(keyFor(icao), null);
    const fresh = stored && Date.now() - Date.parse(stored.seen_utc) < MAX_AGE_MS ? stored : null;
    setBaseline({ icao, value: fresh });
  }, [icao, metar, baseline.icao]);

  useEffect(() => {
    if (icao && metar) writeJson(keyFor(icao), snapshot(metar));
  }, [icao, metar]);

  return useMemo(() => {
    if (!metar || baseline.icao !== icao || !baseline.value) return null;
    const previous = baseline.value;
    const sameReport = previous.observed_utc === metar.observed_utc;
    return { previous, sameReport, changes: sameReport ? [] : describeChanges(previous, snapshot(metar)) };
  }, [baseline, icao, metar]);
}
