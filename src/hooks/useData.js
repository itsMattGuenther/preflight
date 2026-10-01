// One React Query hook per Netlify function. Polling intervals match how fast
// each source changes; everything also refreshes when the pilot comes back to
// the tab after the data has gone stale.
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '../lib/api';

const MINUTE = 60 * 1000;

function coords(airport) {
  return airport ? { lat: airport.lat, lon: airport.lon } : null;
}

export function useAirport(icao) {
  return useQuery({
    queryKey: ['airport', icao],
    queryFn: () => apiFetch('airport', { icao }),
    enabled: Boolean(icao),
    staleTime: 30 * MINUTE,
    retry: (count, error) => error?.status !== 404 && count < 2,
  });
}

export function useWeather(icao, airport) {
  const point = coords(airport);
  return useQuery({
    queryKey: ['weather', icao, point?.lat, point?.lon],
    queryFn: () => apiFetch('weather', { icao, ...point }),
    enabled: Boolean(icao && airport),
    staleTime: 4 * MINUTE,
    refetchInterval: 5 * MINUTE,
  });
}

export function useAdvisories(airport) {
  const point = coords(airport);
  return useQuery({
    queryKey: ['advisories', point?.lat, point?.lon],
    queryFn: () => apiFetch('advisories', point),
    enabled: Boolean(point),
    staleTime: 8 * MINUTE,
    refetchInterval: 10 * MINUTE,
  });
}

export function useTfrs(airport) {
  const point = coords(airport);
  return useQuery({
    queryKey: ['tfr', point?.lat, point?.lon],
    queryFn: () => apiFetch('tfr', point),
    enabled: Boolean(point),
    staleTime: 8 * MINUTE,
    refetchInterval: 15 * MINUTE,
  });
}

export function useWindsAloft(airport) {
  const point = coords(airport);
  return useQuery({
    queryKey: ['winds-aloft', point?.lat, point?.lon],
    queryFn: () => apiFetch('winds-aloft', point),
    enabled: Boolean(point),
    staleTime: 30 * MINUTE,
    refetchInterval: 60 * MINUTE,
  });
}

export function useNotams(icao) {
  return useQuery({
    queryKey: ['notams', icao],
    queryFn: () => apiFetch('notams', { icao }),
    enabled: Boolean(icao),
    staleTime: 10 * MINUTE,
    refetchInterval: 15 * MINUTE,
  });
}

export function useTraffic(airport, enabled = true) {
  const point = coords(airport);
  return useQuery({
    queryKey: ['traffic', point?.lat, point?.lon],
    queryFn: () => apiFetch('traffic', { ...point, radius_nm: 25 }),
    enabled: Boolean(point) && enabled,
    staleTime: 10 * 1000,
    refetchInterval: 15 * 1000,
  });
}

export function useFuel(icao, airport, nearby) {
  // Compare against up to five reporting airports within 40 NM.
  const nearbyIds = (nearby || []).filter((item) => item.distance_nm <= 40).slice(0, 5).map((item) => item.icao).join(',');
  return useQuery({
    queryKey: ['fuel', icao, airport?.state, nearbyIds],
    queryFn: () => apiFetch('fuel', { icao, state: airport?.state, nearby: nearbyIds }),
    enabled: Boolean(icao && airport),
    staleTime: 60 * MINUTE,
  });
}

export function useRadar() {
  return useQuery({
    queryKey: ['radar'],
    queryFn: () => apiFetch('radar'),
    staleTime: 4 * MINUTE,
    refetchInterval: 5 * MINUTE,
  });
}

export function useCharts(airport) {
  const faa = airport?.faa_id || airport?.icao?.replace(/^K(?=[A-Z0-9]{3}$)/, '');
  return useQuery({
    queryKey: ['charts', faa],
    queryFn: () => apiFetch('charts', { faa }),
    enabled: Boolean(faa),
    staleTime: 6 * 60 * MINUTE,
  });
}

export function useAirportImage(airport) {
  return useQuery({
    queryKey: ['airport-image', airport?.icao],
    queryFn: () => apiFetch('airport-image', { icao: airport.icao, name: airport.name }),
    enabled: Boolean(airport?.icao),
    staleTime: Infinity,
    retry: false,
  });
}
