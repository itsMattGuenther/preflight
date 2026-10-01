// Display formatting shared by every card. Aviation convention: times in Zulu
// first, with local time (in the airport's time zone) alongside.
import { formatInTimeZone } from 'date-fns-tz';

const browserZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

export function zoneOrBrowser(timeZone) {
  return timeZone || browserZone;
}

function toDate(value) {
  if (value == null) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatZulu(value, pattern = 'HHmm') {
  const date = toDate(value);
  return date ? `${formatInTimeZone(date, 'UTC', pattern)}Z` : '--';
}

export function formatLocal(value, timeZone, pattern = 'h:mm a') {
  const date = toDate(value);
  return date ? formatInTimeZone(date, zoneOrBrowser(timeZone), pattern) : '--';
}

export function formatLocalWithZone(value, timeZone, pattern = 'h:mm a') {
  const date = toDate(value);
  return date ? formatInTimeZone(date, zoneOrBrowser(timeZone), `${pattern} zzz`) : '--';
}

export function formatZuluAndLocal(value, timeZone) {
  const date = toDate(value);
  if (!date) return '--';
  return `${formatZulu(date)} · ${formatLocalWithZone(date, timeZone)}`;
}

export function zoneAbbreviation(timeZone, at = new Date()) {
  return formatInTimeZone(at, zoneOrBrowser(timeZone), 'zzz');
}

export function timeAgo(value, now = Date.now()) {
  const date = toDate(value);
  if (!date) return 'unknown';
  const seconds = Math.max(0, Math.round((now - date.getTime()) / 1000));
  if (seconds < 60) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours < 24) return rest ? `${hours} hr ${rest} min ago` : `${hours} hr ago`;
  return `${Math.round(hours / 24)} days ago`;
}

export function formatDuration(ms) {
  if (ms == null || !Number.isFinite(ms)) return '--';
  const totalMinutes = Math.max(0, Math.round(ms / 60000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (!hours) return `${minutes} min`;
  return minutes ? `${hours} hr ${minutes} min` : `${hours} hr`;
}

export function formatNumber(value, digits = 0) {
  if (value == null || !Number.isFinite(Number(value))) return '--';
  return Number(value).toLocaleString('en-US', { maximumFractionDigits: digits, minimumFractionDigits: digits });
}

export function formatFeet(value) {
  return value == null ? '--' : `${formatNumber(value)} ft`;
}

export function formatTemp(celsius) {
  if (celsius == null) return '--';
  return `${Math.round(celsius)}°C`;
}

export function celsiusToF(celsius) {
  return celsius == null ? null : Math.round((celsius * 9) / 5 + 32);
}

export function formatAltimeter(inHg) {
  return inHg == null ? '--' : Number(inHg).toFixed(2);
}

const FRACTIONS = [
  [0.125, '1/8'], [0.25, '1/4'], [0.375, '3/8'], [0.5, '1/2'], [0.625, '5/8'], [0.75, '3/4'],
];

export function formatVisibility(sm, plus = false) {
  if (sm == null) return '--';
  const whole = Math.floor(sm);
  const fraction = sm - whole;
  const match = FRACTIONS.find(([value]) => Math.abs(value - fraction) < 0.02);
  let text;
  if (fraction < 0.02) text = String(whole);
  else if (match) text = whole ? `${whole} ${match[1]}` : match[1];
  else text = String(Math.round(sm * 10) / 10);
  return `${text}${plus ? '+' : ''} SM`;
}

export function padHeading(deg) {
  if (deg == null) return '---';
  const value = Math.round(deg) % 360 === 0 ? 360 : Math.round(deg) % 360;
  return String(value).padStart(3, '0');
}

export function formatWind({ wind_dir_deg: dir, wind_vrb: vrb, wind_speed_kt: speed, wind_gust_kt: gust, wind_calm: calm } = {}) {
  if (speed == null && !vrb) return '--';
  if (calm || (speed === 0 && !gust)) return 'Calm';
  const direction = vrb || dir == null ? 'Variable' : `${padHeading(dir)}°`;
  return `${direction} at ${speed} kt${gust ? `, gusting ${gust}` : ''}`;
}

export function formatWindShort({ wind_dir_deg: dir, wind_vrb: vrb, wind_speed_kt: speed, wind_gust_kt: gust, wind_calm: calm } = {}) {
  if (speed == null && !vrb) return '--';
  if (calm || (speed === 0 && !gust)) return 'Calm';
  return `${vrb || dir == null ? 'VRB' : padHeading(dir)}@${speed}${gust ? `G${gust}` : ''}`;
}

export function formatKnots(value) {
  if (value == null || !Number.isFinite(Number(value))) return '--';
  const rounded = Math.round(Number(value) * 10) / 10;
  return `${Number.isInteger(rounded) ? rounded : rounded.toFixed(1)} kt`;
}

export function cardinal(deg) {
  if (deg == null) return '';
  const dirs = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  return dirs[Math.round((((Number(deg) % 360) + 360) % 360) / 22.5) % 16];
}

export function money(value) {
  return value == null ? '--' : `$${Number(value).toFixed(2)}`;
}
