// Outbound links pilots use while briefing an airport.

export function liveAtcUrl(icao) {
  return `https://www.liveatc.net/search/?icao=${encodeURIComponent(String(icao || '').toLowerCase())}`;
}

export function skyVectorUrl(airport) {
  const id = airport?.faa_id || airport?.icao || '';
  return `https://skyvector.com/airport/${encodeURIComponent(id)}`;
}

export function airNavUrl(airport) {
  return `https://www.airnav.com/airport/${encodeURIComponent(airport?.icao || airport?.faa_id || '')}`;
}
