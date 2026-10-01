// Plain-text summary for the "Copy briefing" button, handy for texting a CFI
// or a student before a lesson.
import { VERDICTS } from './aviation/minimums';
import { formatLocal, formatWind, formatZulu, zoneAbbreviation } from './format';

const STATUS_MARK = { pass: 'OK', caution: 'CAUTION', fail: 'NO', unknown: '?', info: 'i' };

export function buildBriefing({ airport, weather, evaluation, windowRange, sun, tfrs, url }) {
  const tz = airport?.timezone;
  const metar = weather?.metar;
  const taf = weather?.taf;
  const lines = [];
  lines.push(`${airport.icao} ${airport.name}: Preflight summary`);
  if (windowRange) {
    lines.push(`Flight window: ${formatLocal(windowRange.startMs, tz)}-${formatLocal(windowRange.endMs, tz)} ${zoneAbbreviation(tz)} (${formatZulu(windowRange.startMs)}-${formatZulu(windowRange.endMs)})`);
  }
  if (evaluation) {
    lines.push(`Personal minimums: ${VERDICTS[evaluation.verdict].label.toUpperCase()}`);
    for (const check of evaluation.checks) {
      lines.push(`  [${STATUS_MARK[check.status]}] ${check.label}: ${check.value} (limit ${check.limit})${check.note && check.status !== 'pass' ? `, ${check.note}` : ''}`);
    }
    for (const item of evaluation.notChecked) lines.push(`  [ ] Not checked: ${item}`);
  }
  if (metar) {
    lines.push('');
    lines.push(`METAR${weather.metar_source && !weather.metar_source.is_field ? ` (${weather.metar_source.icao}, ${weather.metar_source.distance_nm} NM away)` : ''}: ${metar.raw}`);
    lines.push(`  ${metar.flight_category}, wind ${formatWind(metar)}`);
  }
  if (taf) lines.push(`TAF: ${taf.raw}`);
  const nearTfrs = (tfrs || []).filter((tfr) => tfr.distance_nm <= 25);
  if (nearTfrs.length) lines.push(`TFRs within 25 NM: ${nearTfrs.map((tfr) => `${tfr.type} ${tfr.distance_nm} NM${tfr.active ? ' (active)' : ''}`).join('; ')}`);
  if (sun?.sunset) lines.push(`Sunset ${formatLocal(sun.sunset, tz)}, civil twilight ends ${formatLocal(sun.civil_dusk, tz)}`);
  lines.push('');
  lines.push('Situational awareness only. Get an official briefing and read all NOTAMs.');
  if (url) lines.push(url);
  return lines.join('\n');
}
