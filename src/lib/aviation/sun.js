// Sunrise, sunset and civil twilight using the NOAA solar position algorithm
// (accurate to about a minute for the contiguous US). These drive the
// regulatory day/night definitions student pilots are tested on:
//   - Night (14 CFR 1.1): end of evening civil twilight to beginning of
//     morning civil twilight. Night flight time for the PPL is logged here.
//   - Position lights (91.209): required sunset to sunrise.
//   - Night currency (61.57(b)): takeoffs/landings to a full stop between
//     1 hour after sunset and 1 hour before sunrise.

const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;
const HOUR = 60 * 60 * 1000;

function julianDay(date) {
  return date.getTime() / 86400000 + 2440587.5;
}

function solarParameters(jd) {
  const t = (jd - 2451545) / 36525;
  const meanLong = (280.46646 + t * (36000.76983 + t * 0.0003032)) % 360;
  const meanAnomaly = 357.52911 + t * (35999.05029 - 0.0001537 * t);
  const eccentricity = 0.016708634 - t * (0.000042037 + 0.0000001267 * t);
  const center = Math.sin(meanAnomaly * RAD) * (1.914602 - t * (0.004817 + 0.000014 * t))
    + Math.sin(2 * meanAnomaly * RAD) * (0.019993 - 0.000101 * t)
    + Math.sin(3 * meanAnomaly * RAD) * 0.000289;
  const trueLong = meanLong + center;
  const omega = 125.04 - 1934.136 * t;
  const apparentLong = trueLong - 0.00569 - 0.00478 * Math.sin(omega * RAD);
  const meanObliquity = 23 + (26 + (21.448 - t * (46.815 + t * (0.00059 - t * 0.001813))) / 60) / 60;
  const obliquity = meanObliquity + 0.00256 * Math.cos(omega * RAD);
  const declination = Math.asin(Math.sin(obliquity * RAD) * Math.sin(apparentLong * RAD)) * DEG;
  const y = Math.tan((obliquity / 2) * RAD) ** 2;
  const equationOfTime = 4 * DEG * (
    y * Math.sin(2 * meanLong * RAD)
    - 2 * eccentricity * Math.sin(meanAnomaly * RAD)
    + 4 * eccentricity * y * Math.sin(meanAnomaly * RAD) * Math.cos(2 * meanLong * RAD)
    - 0.5 * y * y * Math.sin(4 * meanLong * RAD)
    - 1.25 * eccentricity * eccentricity * Math.sin(2 * meanAnomaly * RAD)
  );
  return { declination, equationOfTime };
}

// Minutes after 00:00 UTC on `dayUtc` when the sun reaches `zenith`.
function eventMinutes(dayUtc, lat, lon, zenith, rising) {
  const noonGuess = new Date(dayUtc.getTime() + (720 - 4 * lon) * 60000);
  let { declination, equationOfTime } = solarParameters(julianDay(noonGuess));
  let minutes = null;
  // Two iterations refine the time the parameters are evaluated at.
  for (let i = 0; i < 2; i += 1) {
    const cosH = (Math.cos(zenith * RAD) - Math.sin(lat * RAD) * Math.sin(declination * RAD))
      / (Math.cos(lat * RAD) * Math.cos(declination * RAD));
    if (cosH > 1 || cosH < -1) return null; // sun never reaches this zenith today
    const hourAngle = Math.acos(cosH) * DEG;
    minutes = 720 - 4 * (lon + (rising ? hourAngle : -hourAngle)) - equationOfTime;
    ({ declination, equationOfTime } = solarParameters(julianDay(new Date(dayUtc.getTime() + minutes * 60000))));
  }
  return minutes;
}

function eventDate(dayUtc, lat, lon, zenith, rising) {
  const minutes = eventMinutes(dayUtc, lat, lon, zenith, rising);
  return minutes == null ? null : new Date(dayUtc.getTime() + minutes * 60000);
}

/**
 * Sun events for the local solar day containing `at`. Returns Date objects
 * (or null in polar day/night).
 */
export function sunTimes(lat, lon, at = new Date()) {
  if (lat == null || lon == null) return null;
  // Shift by longitude so "today" means the local solar day at the airport.
  // Event times are minutes after 00:00 UTC on that date (a US sunset is
  // often past 24:00 UTC, which simply lands on the next UTC day).
  const solar = new Date(at.getTime() + (lon / 15) * HOUR);
  const day = new Date(Date.UTC(solar.getUTCFullYear(), solar.getUTCMonth(), solar.getUTCDate()));
  const sunrise = eventDate(day, lat, lon, 90.833, true);
  const sunset = eventDate(day, lat, lon, 90.833, false);
  const civilDawn = eventDate(day, lat, lon, 96, true);
  const civilDusk = eventDate(day, lat, lon, 96, false);
  return {
    sunrise,
    sunset,
    civil_dawn: civilDawn,
    civil_dusk: civilDusk,
    night_currency_start: sunset ? new Date(sunset.getTime() + HOUR) : null,
    night_currency_end: sunrise ? new Date(sunrise.getTime() - HOUR) : null,
  };
}

/** 'day' | 'twilight' (lights required, not yet legal night) | 'night' */
export function lightingPhase(times, at = new Date()) {
  if (!times?.sunrise || !times?.sunset) return null;
  const t = at.getTime();
  if (t >= times.sunrise.getTime() && t < times.sunset.getTime()) return 'day';
  if (times.civil_dusk && t >= times.sunset.getTime() && t < times.civil_dusk.getTime()) return 'twilight';
  if (times.civil_dawn && t >= times.civil_dawn.getTime() && t < times.sunrise.getTime()) return 'twilight';
  return 'night';
}
