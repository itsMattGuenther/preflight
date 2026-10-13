// NOTAM triage. Every pattern uses word boundaries: the previous version
// matched "AP" inside "APRON" and "AD" inside "ROAD", so an apron closure (or a
// road closed to vehicles) was labeled critical and flipped the airport to
// "Not recommended". Categories are ordered by how much they matter to a
// pilot planning to use the airport.

export const NOTAM_CATEGORIES = [
  { id: 'closure', label: 'Airport / runway closures', priority: 0 },
  { id: 'airspace', label: 'Airspace & TFRs', priority: 1 },
  { id: 'runway', label: 'Runways', priority: 2 },
  { id: 'lighting', label: 'Lighting', priority: 3 },
  { id: 'navigation', label: 'Nav aids & procedures', priority: 4 },
  { id: 'movement', label: 'Taxiways & ramp', priority: 5 },
  { id: 'obstacle', label: 'Obstacles', priority: 6 },
  { id: 'services', label: 'Services', priority: 7 },
  { id: 'other', label: 'Other', priority: 8 },
];

const RULES = [
  ['closure', /\b(AD|AP)\b[^.]*\bCLSD\b|\bAIRPORT CLOSED\b|\bRWY\s+[0-9]{1,2}[LCR]?(\/[0-9]{1,2}[LCR]?)?\s+CLSD\b(?![^.]*\bEXC\b)/],
  ['airspace', /\bAIRSPACE\b|\bTFR\b|\bFLIGHT RESTRICTIONS?\b|\bUAS\b|\bPJE\b|\bPARACHUTE\b|\bAEROBATIC\b/],
  ['obstacle', /\b(OBST|CRANE)\b/],
  ['lighting', /\b(LGT|LIGHTS?|LIGHTING|PAPI|VASI|REIL|MIRL|HIRL|LIRL|ALS|MALSR|MALSF|ODALS|BCN|PCL|ABN|RCLL|TDZ)\b/],
  ['navigation', /\b(ILS|LOC|GS|GP|VOR|VORTAC|NDB|DME|TACAN|GPS|RNAV|LPV|IAP|SID|STAR|DP|APCH|INSTRUMENT|NAV|WAAS|GBAS)\b/],
  ['runway', /\bRWY\b/],
  ['movement', /\b(TWY|TAXIWAY|APRON|RAMP|TAXILANE)\b/],
  ['services', /\b(SVC|FUEL|ATIS|AWOS|ASOS|FBO|UNICOM|CTAF|FREQ)\b/],
];

export function classifyNotam(notam) {
  const text = String(notam?.text || '').toUpperCase();
  return RULES.find(([, pattern]) => pattern.test(text))?.[0] || 'other';
}

export function isActiveDuring(notam, startMs, endMs) {
  const from = notam.effective_from_utc ? Date.parse(notam.effective_from_utc) : null;
  const to = notam.effective_to_utc ? Date.parse(notam.effective_to_utc) : null;
  return (from == null || from <= endMs) && (to == null || to >= startMs);
}

export function groupNotams(notams) {
  const groups = NOTAM_CATEGORIES.map((category) => ({ ...category, items: [] }));
  for (const notam of notams || []) {
    const id = classifyNotam(notam);
    groups.find((group) => group.id === id).items.push({ ...notam, category: id });
  }
  return groups.filter((group) => group.items.length);
}
