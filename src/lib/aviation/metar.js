// METAR/TAF present-weather parsing, hazard detection, and plain-English
// decoding. Weather groups look like [intensity][descriptor][phenomena]:
// "-TSRA" (light thunderstorm with rain), "+SHRA", "VCSH", "FZFG", "BR".
// The previous version matched whole tokens only, so any intensity prefix
// ("-TSRA") slipped through as "clear". Parsing the group fixes that class of
// bug for every combination.

import { celsiusToF, formatAltimeter, formatFeet, formatTemp, formatVisibility, padHeading } from '../format.js';
import { densityAltitude } from './density.js';

const DESCRIPTORS = {
  MI: 'shallow', PR: 'partial', BC: 'patches of', DR: 'low drifting', BL: 'blowing', SH: 'showers of', TS: 'thunderstorm', FZ: 'freezing',
};
const PHENOMENA = {
  DZ: 'drizzle', RA: 'rain', SN: 'snow', SG: 'snow grains', IC: 'ice crystals', PL: 'ice pellets', GR: 'hail', GS: 'small hail',
  UP: 'unknown precipitation', BR: 'mist', FG: 'fog', FU: 'smoke', VA: 'volcanic ash', DU: 'dust', SA: 'sand', HZ: 'haze', PY: 'spray',
  PO: 'dust whirls', SQ: 'squalls', FC: 'funnel cloud', SS: 'sandstorm', DS: 'duststorm',
};
const COVER = {
  SKC: 'clear', CLR: 'clear', NSC: 'no significant clouds', NCD: 'no clouds detected', FEW: 'few', SCT: 'scattered', BKN: 'broken', OVC: 'overcast',
  VV: 'sky obscured, vertical visibility', OVX: 'sky obscured, vertical visibility',
};
const CEILING_COVERS = ['BKN', 'OVC', 'VV', 'OVX'];

export function parseWeatherGroup(token) {
  let rest = String(token || '').trim().toUpperCase();
  if (!rest) return null;
  let intensity = 'moderate';
  if (rest.startsWith('+')) {
    intensity = 'heavy';
    rest = rest.slice(1);
  } else if (rest.startsWith('-')) {
    intensity = 'light';
    rest = rest.slice(1);
  }
  let vicinity = false;
  if (rest.startsWith('VC')) {
    vicinity = true;
    rest = rest.slice(2);
  }
  const descriptors = [];
  while (rest.length >= 2 && DESCRIPTORS[rest.slice(0, 2)]) {
    descriptors.push(rest.slice(0, 2));
    rest = rest.slice(2);
  }
  const phenomena = [];
  while (rest.length >= 2 && PHENOMENA[rest.slice(0, 2)]) {
    phenomena.push(rest.slice(0, 2));
    rest = rest.slice(2);
  }
  if (rest.length) return null; // not a weather group (e.g. a remark token)
  if (!descriptors.length && !phenomena.length) return null;
  return { token: String(token).trim(), intensity, vicinity, descriptors, phenomena };
}

export function parseWeather(wx) {
  return String(wx || '').split(/\s+/).map(parseWeatherGroup).filter(Boolean);
}

export function describeWeatherGroup(group) {
  const has = (code) => group.descriptors.includes(code);
  const words = [];
  const intensity = group.intensity === 'moderate' ? '' : group.intensity;
  const precip = group.phenomena.map((code) => PHENOMENA[code]);
  if (has('TS')) {
    words.push(intensity, 'thunderstorm');
    if (precip.length) words.push('with', precip.join(' and '));
  } else if (has('SH')) {
    words.push(intensity, precip.length ? `${precip.join(' and ')} showers` : 'showers');
  } else {
    const descriptors = group.descriptors.map((code) => DESCRIPTORS[code]);
    words.push(intensity, ...descriptors, precip.join(' and '));
  }
  if (group.vicinity) words.push('in the vicinity');
  const text = words.filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * Hazards a training/VFR flight should not take lightly. 'fail' items are
 * outside any reasonable personal minimum; 'caution' items need a closer look.
 */
export function weatherHazards({ wx, clouds, raw, remarks, wind_shear: windShear } = {}) {
  const hazards = [];
  const add = (level, label, code) => {
    if (!hazards.some((item) => item.label === label)) hazards.push({ level, label, code });
  };

  for (const group of parseWeather(wx)) {
    const has = (code) => group.descriptors.includes(code) || group.phenomena.includes(code);
    if (group.descriptors.includes('TS')) add('fail', group.vicinity ? 'Thunderstorm in the vicinity' : 'Thunderstorm', group.token);
    if (group.descriptors.includes('FZ') && (has('RA') || has('DZ'))) add('fail', 'Freezing precipitation (icing)', group.token);
    if (has('GR') || has('GS')) add('fail', 'Hail', group.token);
    if (has('PL')) add('fail', 'Ice pellets', group.token);
    if (has('SQ')) add('fail', 'Squalls', group.token);
    if (has('FC')) add('fail', group.intensity === 'heavy' ? 'Tornado / waterspout' : 'Funnel cloud', group.token);
    if (has('SS') || has('DS')) add('fail', 'Dust or sandstorm', group.token);
    if (has('VA')) add('fail', 'Volcanic ash', group.token);
    if (has('SN') || has('SG')) add(group.intensity === 'heavy' ? 'fail' : 'caution', group.intensity === 'heavy' ? 'Heavy snow' : 'Snow', group.token);
    if (has('IC')) add('caution', 'Ice crystals', group.token);
    if (has('UP')) add(group.descriptors.includes('FZ') ? 'fail' : 'caution', group.descriptors.includes('FZ') ? 'Freezing precipitation (icing)' : 'Unknown precipitation', group.token);
    if (group.descriptors.includes('FZ') && has('FG')) add('caution', 'Freezing fog', group.token);
    if ((has('RA') || has('DZ')) && !group.descriptors.includes('TS') && !group.descriptors.includes('FZ')) {
      add(group.intensity === 'heavy' ? 'fail' : 'caution', group.intensity === 'heavy' ? 'Heavy rain' : 'Rain', group.token);
    }
    if (group.vicinity && group.descriptors.includes('SH') && !group.phenomena.length) add('caution', 'Showers in the vicinity', group.token);
    if (has('FG') && !group.descriptors.includes('FZ') && !group.descriptors.includes('BC') && !group.descriptors.includes('MI') && !group.descriptors.includes('PR')) {
      add('caution', group.vicinity ? 'Fog in the vicinity' : 'Fog', group.token);
    }
    if (has('FU')) add('caution', 'Smoke', group.token);
  }

  for (const layer of clouds || []) {
    if (layer.type === 'CB') add('caution', 'Cumulonimbus clouds', 'CB');
    if (layer.type === 'TCU') add('caution', 'Towering cumulus', 'TCU');
  }

  const remarkText = String(remarks || '').toUpperCase();
  if (/\bLTG/.test(remarkText)) add('caution', 'Lightning observed', 'LTG');
  if (/\bCB\b/.test(remarkText)) add('caution', 'Cumulonimbus reported in remarks', 'CB');
  if (/\bWS\b|\bWND SHEAR|\bLLWS\b/.test(remarkText) || /\bWS\d{3}\//.test(String(raw || ''))) add('caution', 'Wind shear reported', 'WS');
  if (windShear) add('caution', 'Low-level wind shear forecast', 'WS');

  return hazards;
}

function cloudSentence(clouds, ceilingFt) {
  if (clouds == null) return 'Sky condition not reported (the station\'s cloud sensor may be out). Treat the ceiling as unknown.';
  if (!clouds.length || clouds.every((layer) => ['CLR', 'SKC', 'NSC', 'NCD'].includes(layer.cover))) return 'Sky clear below 12,000 ft.';
  const parts = clouds.map((layer) => {
    const type = layer.type === 'CB' ? ' cumulonimbus' : layer.type === 'TCU' ? ' towering cumulus' : '';
    const isCeiling = layer.base_ft === ceilingFt && CEILING_COVERS.includes(layer.cover);
    return `${COVER[layer.cover] || layer.cover}${type} at ${formatFeet(layer.base_ft)}${isCeiling ? ' (ceiling)' : ''}`;
  });
  return `Clouds: ${parts.join(', ')}.`;
}

export function plainEnglishMetar(metar, { elevationFt = null } = {}) {
  if (!metar) return [];
  const lines = [];
  lines.push(metar.auto ? 'Automated observation (no human observer).' : 'Observation includes a human observer.');

  if (metar.wind_calm) lines.push('Wind calm.');
  else if (metar.wind_vrb) lines.push(`Wind variable in direction at ${metar.wind_speed_kt} knots${metar.wind_gust_kt ? `, gusting to ${metar.wind_gust_kt}` : ''}.`);
  else if (metar.wind_dir_deg != null) {
    lines.push(`Wind from ${padHeading(metar.wind_dir_deg)}° true at ${metar.wind_speed_kt} knots${metar.wind_gust_kt ? `, gusting to ${metar.wind_gust_kt} knots` : ''}.`);
  }
  if (metar.wind_var_from_deg != null) lines.push(`Direction varying between ${metar.wind_var_from_deg}° and ${metar.wind_var_to_deg}°.`);

  lines.push(`Visibility ${formatVisibility(metar.visibility_sm, metar.visibility_plus).replace('SM', 'statute miles').replace('+ statute', ' or more statute')}.`);

  const groups = parseWeather(metar.wx);
  if (groups.length) lines.push(`Weather: ${groups.map(describeWeatherGroup).join('; ')}.`);

  lines.push(cloudSentence(metar.clouds, metar.ceiling_ft));

  if (metar.temp_c != null) {
    const spread = metar.dewpoint_c != null ? Math.round((metar.temp_c - metar.dewpoint_c) * 10) / 10 : null;
    let sentence = `Temperature ${formatTemp(metar.temp_c)} (${celsiusToF(metar.temp_c)}°F)`;
    if (metar.dewpoint_c != null) sentence += `, dew point ${formatTemp(metar.dewpoint_c)}`;
    if (spread != null) {
      sentence += `, spread ${Math.round(spread)}°C`;
      if (spread <= 3) sentence += ' (close spread: fog or low clouds can form, especially as it cools)';
    }
    lines.push(`${sentence}.`);
  }
  if (metar.altimeter_inhg != null) lines.push(`Altimeter setting ${formatAltimeter(metar.altimeter_inhg)} inches of mercury.`);
  const da = densityAltitude(elevationFt, metar.temp_c, metar.altimeter_inhg);
  if (da != null && elevationFt != null) {
    const diff = da - elevationFt;
    lines.push(`Density altitude about ${formatFeet(Math.round(da / 10) * 10)}${diff > 1000 ? ` (${formatFeet(Math.round(diff / 100) * 100)} above field elevation: expect longer takeoff rolls and weaker climbs)` : ''}.`);
  }
  return lines;
}
