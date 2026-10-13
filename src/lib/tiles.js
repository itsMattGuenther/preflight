// Web Mercator helpers for drawing slippy-map tiles around an airport without
// a map library: convert lat/lon to world pixels at a zoom level, then place
// 256 px tiles by their offset from the airport.
export const TILE_SIZE = 256;
const METERS_PER_NM = 1852;

export function lonLatToWorld(lat, lon, zoom) {
  const sinLat = Math.sin((lat * Math.PI) / 180);
  const scale = TILE_SIZE * 2 ** zoom;
  return {
    x: ((lon + 180) / 360) * scale,
    y: (0.5 - Math.log((1 + sinLat) / (1 - sinLat)) / (4 * Math.PI)) * scale,
  };
}

export function metersPerPixel(lat, zoom) {
  return (156543.03392 * Math.cos((lat * Math.PI) / 180)) / 2 ** zoom;
}

export function nmToPixels(nm, lat, zoom) {
  return (nm * METERS_PER_NM) / metersPerPixel(lat, zoom);
}

export function tilesAround(center, zoom, cols, rows) {
  const world = lonLatToWorld(center.lat, center.lon, zoom);
  const cx = Math.floor(world.x / TILE_SIZE);
  const cy = Math.floor(world.y / TILE_SIZE);
  const tiles = [];
  for (let x = cx - Math.floor(cols / 2); x <= cx + Math.floor(cols / 2); x += 1) {
    for (let y = cy - Math.floor(rows / 2); y <= cy + Math.floor(rows / 2); y += 1) {
      tiles.push({ x, y, left: x * TILE_SIZE - world.x, top: y * TILE_SIZE - world.y });
    }
  }
  return { world, tiles };
}

export function osmTileUrl(zoom, x, y) {
  return `https://tile.openstreetmap.org/${zoom}/${x}/${y}.png`;
}
