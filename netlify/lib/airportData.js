// Pure helpers for building the airport payload. Runway headings are TRUE
// headings because METAR/TAF winds are reported relative to true north; mixing
// magnetic runway numbers with true winds skews crosswind math by the local
// magnetic variation (16 degrees in Seattle, 15 in Boston).

const SURFACES = [
  [/^(A|ASP|ASPH|BIT|BITUMINOUS|ASPHALT|PEM|BLACKTOP)/i, 'Asphalt', true],
  [/^(C|CON|CONC|CONCRETE|PCC)/i, 'Concrete', true],
  [/^(T|TURF|GRS|GRASS|GRE|SOD)/i, 'Turf', false],
  [/^(G|GVL|GRAVEL|GRV)/i, 'Gravel', false],
  [/^(D|DIRT|EARTH|E|CLAY|SAND)/i, 'Dirt', false],
  [/^(W|WATER|WAT)/i, 'Water', false],
  [/^(S|SNOW|ICE)/i, 'Snow/ice', false],
];

export function surfaceInfo(code) {
  const text = String(code || '').trim();
  if (!text) return { label: 'Unknown', paved: null };
  for (const [pattern, label, paved] of SURFACES) {
    if (pattern.test(text)) return { label, paved };
  }
  return { label: text.length <= 4 ? text.toUpperCase() : text, paved: null };
}

export function parseMagVar(value) {
  // AviationWeather encodes variation as "16E" / "03W". East is positive.
  const match = /^(\d{1,3})([EW])$/i.exec(String(value || '').trim());
  if (!match) return null;
  const degrees = Number(match[1]);
  return match[2].toUpperCase() === 'E' ? degrees : -degrees;
}

export function normalizeHeading(value) {
  const heading = ((Math.round(Number(value)) % 360) + 360) % 360;
  return heading === 0 ? 360 : heading;
}

function runwayNumber(id) {
  const numeric = Number(String(id || '').replace(/[^\d]/g, ''));
  return Number.isFinite(numeric) && numeric >= 1 && numeric <= 36 ? numeric : null;
}

export function isHelipad(id) {
  return /^H\d/i.test(String(id || '').trim());
}

function makeEnds(ids, trueHeading, magVar, source) {
  const [first, second] = ids;
  const firstTrue = normalizeHeading(trueHeading);
  const secondTrue = normalizeHeading(trueHeading + 180);
  const toMag = (heading) => (magVar == null ? null : normalizeHeading(heading - magVar));
  return [
    { id: first, heading_true: firstTrue, heading_mag: toMag(firstTrue), heading_source: source },
    second ? { id: second, heading_true: secondTrue, heading_mag: toMag(secondTrue), heading_source: source } : null,
  ].filter(Boolean);
}

export function endsFromIds(ids, { trueHeading = null, magVar = null } = {}) {
  if (trueHeading != null && Number.isFinite(Number(trueHeading)) && Number(trueHeading) > 0) {
    return makeEnds(ids, Number(trueHeading), magVar, 'true');
  }
  // No true alignment available: fall back to runway number x 10 (magnetic)
  // and convert to true if we know the variation.
  const number = runwayNumber(ids[0]);
  if (number == null) return [];
  const magnetic = number * 10;
  if (magVar != null) return makeEnds(ids, magnetic + magVar, magVar, 'runway number + variation');
  return makeEnds(ids, magnetic, null, 'runway number (magnetic, approximate)');
}

export function runwaysFromAwc(list, magVar) {
  return (Array.isArray(list) ? list : [])
    .filter((runway) => runway?.id && !isHelipad(runway.id))
    .map((runway) => {
      const ids = String(runway.id).split('/').map((part) => part.trim());
      const [length, width] = String(runway.dimension || '').split('x').map((value) => Number(value));
      const surface = surfaceInfo(runway.surface);
      return {
        id: ids.join('/'),
        ends: endsFromIds(ids, { trueHeading: runway.alignment, magVar }),
        length_ft: Number.isFinite(length) && length > 0 ? length : null,
        width_ft: Number.isFinite(width) && width > 0 ? width : null,
        surface: surface.label,
        paved: surface.paved,
        lighted: null,
      };
    })
    .filter((runway) => runway.ends.length);
}

export function runwaysFromFallback(list, magVar) {
  return (Array.isArray(list) ? list : [])
    .filter(([le]) => le && !isHelipad(le))
    .map(([le, he, length, width, surfaceCode, leTrue, lighted]) => {
      const ids = [le, he].filter(Boolean);
      const surface = surfaceInfo(surfaceCode);
      return {
        id: ids.join('/'),
        ends: endsFromIds(ids, { trueHeading: leTrue, magVar }),
        length_ft: length || null,
        width_ft: width || null,
        surface: surface.label,
        paved: surface.paved,
        lighted: lighted === 1,
      };
    })
    .filter((runway) => runway.ends.length);
}

const FREQUENCY_KINDS = [
  ['ctaf', /\bCTAF\b/],
  ['atis', /\b(D-?ATIS|ATIS)\b/],
  ['awos', /\b(AWOS|ASOS|AWOS-\w+|WX)\b/],
  ['tower', /\b(TWR|TOWER|LCL)\b/],
  ['ground', /\b(GND|GROUND)\b/],
  ['clearance', /\b(CD|CLNC|CLEARANCE|CLD|PRE-?TAXI)\b/],
  ['approach', /\b(APP|APCH|APPROACH|DEP|DEPARTURE|A\/D)\b/],
  ['unicom', /\b(UNICOM|UNIC)\b/],
];

const AWC_LABELS = {
  'LCL/P': 'TOWER',
  'LCL/S': 'TOWER (SECONDARY)',
  'GND/P': 'GROUND',
  'GND/S': 'GROUND (SECONDARY)',
  'CD/P': 'CLEARANCE DELIVERY',
  'CD/S': 'CLEARANCE DELIVERY (SECONDARY)',
  'D-ATIS': 'ATIS',
  CTAF: 'CTAF',
  UNICOM: 'UNICOM',
};

export function frequencyKind(label) {
  const upper = String(label || '').toUpperCase();
  return FREQUENCY_KINDS.find(([, pattern]) => pattern.test(upper))?.[0] || 'other';
}

export function parseAwcFrequencies(freqs) {
  const raw = String(freqs || '').trim();
  if (!raw || raw === '-') return [];
  return raw
    .split(';')
    .map((item) => {
      const [code, ...rest] = item.split(',').map((part) => part.trim());
      if (!code || !rest.length) return null;
      const label = AWC_LABELS[code.toUpperCase()] || code.toUpperCase();
      return { label, value: rest.join(', '), kind: frequencyKind(label) };
    })
    .filter(Boolean);
}

const NAME_WORDS = {
  MUNI: 'Municipal',
  FLD: 'Field',
  RGNL: 'Regional',
  REGL: 'Regional',
  INTL: 'International',
  ARPT: 'Airport',
  NTL: 'National',
  MEM: 'Memorial',
  EXEC: 'Executive',
  CO: 'County',
  CNTY: 'County',
  MTN: 'Mountain',
  AFB: 'AFB',
  ARB: 'ARB',
  NAS: 'NAS',
};

export function titleCaseName(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[a-z0-9']+/g, (word) => NAME_WORDS[word.toUpperCase()] || word.charAt(0).toUpperCase() + word.slice(1));
}

export function splitAwcName(name) {
  // AviationWeather names are "CITY/AIRPORT NAME" (sometimes with extra parts).
  const parts = String(name || '').split('/').map((part) => part.trim()).filter(Boolean);
  if (parts.length <= 1) return { city: '', name: titleCaseName(parts[0] || '') };
  return { city: titleCaseName(parts[0]), name: titleCaseName(parts.slice(1).join(' / ')) };
}
