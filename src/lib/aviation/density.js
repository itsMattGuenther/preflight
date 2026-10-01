// Pressure and density altitude, using the standard rule-of-thumb
// approximations from the FAA Pilot's Handbook of Aeronautical Knowledge:
//   pressure altitude = field elevation + (29.92 - altimeter) x 1,000
//   density altitude  = pressure altitude + 120 x (OAT - ISA temp at that PA)
// Good to within a few hundred feet; use the POH for performance numbers.

function valid(...values) {
  return values.every((value) => value != null && Number.isFinite(Number(value)));
}

export function pressureAltitude(elevationFt, altimeterInHg) {
  if (!valid(elevationFt, altimeterInHg)) return null;
  return Math.round(Number(elevationFt) + (29.92 - Number(altimeterInHg)) * 1000);
}

export function isaTempC(altitudeFt) {
  return 15 - (2 * altitudeFt) / 1000;
}

export function densityAltitude(elevationFt, oatC, altimeterInHg) {
  if (!valid(elevationFt, oatC, altimeterInHg)) return null;
  const pa = pressureAltitude(elevationFt, altimeterInHg);
  return Math.round(pa + 120 * (Number(oatC) - isaTempC(pa)));
}
