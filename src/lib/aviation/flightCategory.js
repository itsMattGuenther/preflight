// FAA/NWS flight category definitions:
//   LIFR  ceiling < 500 ft  or visibility < 1 SM
//   IFR   ceiling < 1,000   or visibility < 3 SM
//   MVFR  ceiling 1,000-3,000 or visibility 3-5 SM
//   VFR   ceiling > 3,000 and visibility > 5 SM

export function flightCategory(ceilingFt, visibilitySm) {
  const ceiling = ceilingFt == null ? Infinity : ceilingFt;
  const vis = visibilitySm == null ? Infinity : visibilitySm;
  if (ceiling < 500 || vis < 1) return 'LIFR';
  if (ceiling < 1000 || vis < 3) return 'IFR';
  if (ceiling <= 3000 || vis <= 5) return 'MVFR';
  return 'VFR';
}

export const CATEGORY_INFO = {
  VFR: { label: 'VFR', description: 'Visual flight rules: ceiling above 3,000 ft and visibility over 5 SM' },
  MVFR: { label: 'MVFR', description: 'Marginal VFR: ceiling 1,000-3,000 ft and/or visibility 3-5 SM' },
  IFR: { label: 'IFR', description: 'Instrument flight rules: ceiling 500-999 ft and/or visibility 1-3 SM' },
  LIFR: { label: 'LIFR', description: 'Low IFR: ceiling below 500 ft and/or visibility below 1 SM' },
};
