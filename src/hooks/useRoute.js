import { useCallback, useEffect, useState } from 'react';
import { readJson, writeJson } from '../lib/storage';

// The selected airport lives in the URL (preflightapp.netlify.app/KVBT) so a
// briefing can be shared, bookmarked, or added to a phone's home screen, and
// the back button moves between airports.
const LAST_KEY = 'preflight:selectedAirport';

export function normalizeAirportCode(value) {
  const input = String(value || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5);
  if (/^[A-Z]{3}$/.test(input)) return `K${input}`;
  return input;
}

function codeFromLocation() {
  const fromPath = decodeURIComponent(window.location.pathname.replace(/^\/+|\/+$/g, ''));
  if (/^[A-Za-z0-9]{2,5}$/.test(fromPath)) return normalizeAirportCode(fromPath);
  const fromQuery = new URLSearchParams(window.location.search).get('icao');
  return fromQuery ? normalizeAirportCode(fromQuery) : '';
}

// Called once an airport actually loads, so a typo is never "resumed".
export function rememberAirport(code) {
  writeJson(LAST_KEY, code);
}

export function useAirportRoute() {
  const [icao, setIcaoState] = useState(() => {
    const fromUrl = codeFromLocation();
    if (fromUrl) return fromUrl;
    // Returning visitors resume the last airport they looked at.
    const last = readJson(LAST_KEY, null);
    const fallback = typeof last === 'string' ? last : normalizeAirportCode(import.meta.env.VITE_AIRPORT_ICAO);
    if (fallback) window.history.replaceState({ icao: fallback }, '', `/${fallback}`);
    return fallback || '';
  });

  useEffect(() => {
    const onPop = () => setIcaoState(codeFromLocation());
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  useEffect(() => {
    document.title = icao ? `${icao} · Preflight` : 'Preflight · Free preflight briefing for VFR pilots';
  }, [icao]);

  const selectAirport = useCallback((code) => {
    const next = normalizeAirportCode(code);
    if (!next) return;
    if (next !== codeFromLocation()) window.history.pushState({ icao: next }, '', `/${next}`);
    setIcaoState(next);
    window.scrollTo({ top: 0 });
  }, []);

  const goHome = useCallback(() => {
    writeJson(LAST_KEY, null);
    window.history.pushState({}, '', '/');
    setIcaoState('');
  }, []);

  return { icao, selectAirport, goHome };
}
