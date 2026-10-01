// Recently viewed airports and the pilot's home airport, kept in this browser
// only. Used for one-tap quick picks on the landing page and in search.
import { readJson, writeJson } from './storage';

const RECENTS_KEY = 'preflight:recentAirports';
const HOME_KEY = 'preflight:homeAirport';
const MAX_RECENTS = 6;

export function getRecentAirports() {
  const list = readJson(RECENTS_KEY, []);
  return Array.isArray(list) ? list.filter((item) => typeof item === 'string' && item) : [];
}

export function addRecentAirport(code) {
  const value = String(code || '').trim().toUpperCase();
  if (!value) return getRecentAirports();
  const next = [value, ...getRecentAirports().filter((entry) => entry !== value)].slice(0, MAX_RECENTS);
  writeJson(RECENTS_KEY, next);
  return next;
}

export function getHomeAirport() {
  const value = readJson(HOME_KEY, null);
  return typeof value === 'string' ? value : null;
}

export function setHomeAirport(code) {
  writeJson(HOME_KEY, code || null);
}
