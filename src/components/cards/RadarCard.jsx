import { Pause, Play, Radar } from 'lucide-react';
import { useEffect, useState } from 'react';
import { formatLocal, formatZulu } from '../../lib/format';
import { nmToPixels, osmTileUrl, tilesAround, TILE_SIZE } from '../../lib/tiles';
import { Card } from '../ui';

// RainViewer's free tiles go up to zoom 7 (about 1.2 km/pixel), which shows
// roughly a 150 NM-wide area: right for "what is coming my way".
const ZOOM = 7;

export function RadarCard({ airport, radar }) {
  const [playing, setPlaying] = useState(false);
  const frames = radar.data?.frames || [];
  const [frameIndex, setFrameIndex] = useState(null);
  const current = frameIndex == null ? frames.length - 1 : frameIndex;
  const tz = airport?.timezone;

  useEffect(() => {
    if (!playing || frames.length < 2) return undefined;
    const id = window.setInterval(() => {
      setFrameIndex((index) => ((index ?? frames.length - 1) + 1) % frames.length);
    }, 700);
    return () => window.clearInterval(id);
  }, [playing, frames.length]);

  useEffect(() => {
    setFrameIndex(null);
  }, [radar.data]);

  if (!airport) return null;
  const { tiles } = tilesAround(airport, ZOOM, 5, 3);
  const host = radar.data?.host;
  const frame = frames[current];
  const ring50 = nmToPixels(50, airport.lat, ZOOM);
  // Only mount every frame once the loop has been started, to save requests.
  const mounted = playing || frameIndex != null ? frames : frame ? [frame] : [];

  return (
    <Card
      title="Precipitation radar"
      icon={Radar}
      className="area-radar"
      meta={frame ? `${formatZulu(frame.time_utc)} · ${formatLocal(frame.time_utc, tz)}` : radar.isLoading ? 'Loading' : 'Unavailable'}
      action={frames.length > 1 ? (
        <button type="button" className="icon-button" onClick={() => setPlaying((value) => !value)} aria-label={playing ? 'Pause radar loop' : 'Play radar loop'}>
          {playing ? <Pause size={15} /> : <Play size={15} />}
        </button>
      ) : null}
    >
      <div className="map-frame radar-map">
        {tiles.map((tile) => (
          <img
            key={`base-${tile.x}-${tile.y}`}
            className="map-tile base-tile"
            alt=""
            draggable="false"
            src={osmTileUrl(ZOOM, tile.x, tile.y)}
            style={{ left: `calc(50% + ${tile.left}px)`, top: `calc(50% + ${tile.top}px)`, width: TILE_SIZE, height: TILE_SIZE }}
          />
        ))}
        {host ? mounted.map((item) => tiles.map((tile) => (
          <img
            key={`${item.path}-${tile.x}-${tile.y}`}
            className="map-tile radar-tile"
            alt=""
            draggable="false"
            src={`${host}${item.path}/256/${ZOOM}/${tile.x}/${tile.y}/2/1_1.png`}
            style={{
              left: `calc(50% + ${tile.left}px)`,
              top: `calc(50% + ${tile.top}px)`,
              width: TILE_SIZE,
              height: TILE_SIZE,
              opacity: item === frame ? 0.85 : 0,
            }}
          />
        ))) : null}
        <div className="map-ring" style={{ width: ring50 * 2, height: ring50 * 2 }}><span>50 NM</span></div>
        <div className="map-center" title={airport.icao}><span>{airport.icao}</span></div>
        {frames.length > 1 ? (
          <div className="radar-progress" aria-hidden="true">
            {frames.map((item, index) => <i key={item.path} className={index === current ? 'active' : ''} />)}
          </div>
        ) : null}
        <div className="map-attribution">
          <a href="https://www.rainviewer.com/" target="_blank" rel="noreferrer">RainViewer</a> ·{' '}
          © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a>
        </div>
      </div>
    </Card>
  );
}
