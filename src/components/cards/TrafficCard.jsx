import { Navigation, RadioTower } from 'lucide-react';
import { useState } from 'react';
import { cardinal, formatLocal, formatNumber, timeAgo } from '../../lib/format';
import { lonLatToWorld, nmToPixels, osmTileUrl, tilesAround, TILE_SIZE } from '../../lib/tiles';
import { Card, ErrorNote, Segmented, Skeleton } from '../ui';

const RANGES = [
  { value: 5, label: '5 NM', zoom: 11, rings: [1, 2.5, 5] },
  { value: 10, label: '10 NM', zoom: 10, rings: [2.5, 5, 10] },
  { value: 25, label: '25 NM', zoom: 9, rings: [5, 10, 25] },
];
const PATTERN_NM = 5;
const PATTERN_AGL = 2500;

function trend(rate) {
  if (rate == null) return '';
  if (rate > 300) return '↑';
  if (rate < -300) return '↓';
  return '';
}

export function TrafficCard({ airport, traffic, now }) {
  const [range, setRange] = useState(10);
  const [hover, setHover] = useState(null);
  const config = RANGES.find((item) => item.value === range);

  if (!airport || traffic.isPending) return <Card title="Traffic (ADS-B)" icon={RadioTower} className="area-traffic"><Skeleton lines={6} /></Card>;
  if (traffic.isError) return <Card title="Traffic (ADS-B)" icon={RadioTower} className="area-traffic"><ErrorNote error={traffic.error} what="ADS-B traffic" onRetry={traffic.refetch} /></Card>;

  const elevation = airport.elevation_ft || 0;
  const all = (traffic.data?.aircraft || []).map((ac) => ({
    ...ac,
    agl: ac.on_ground ? 0 : ac.altitude_ft != null ? Math.max(0, ac.altitude_ft - elevation) : null,
  }));
  const visible = all.filter((ac) => ac.distance_nm == null || ac.distance_nm <= range);
  const pattern = all.filter((ac) => !ac.on_ground && ac.distance_nm <= PATTERN_NM && ac.agl != null && ac.agl <= PATTERN_AGL);
  const onGround = all.filter((ac) => ac.on_ground && ac.distance_nm <= 2);
  const center = { lat: airport.lat, lon: airport.lon };
  const { world, tiles } = tilesAround(center, config.zoom, 5, 3);

  return (
    <Card
      title="Traffic (ADS-B)"
      icon={RadioTower}
      className="area-traffic"
      meta={traffic.data ? `Updated ${timeAgo(traffic.data.fetched_utc, now)}` : null}
      action={<Segmented label="Traffic range" options={RANGES} value={range} onChange={setRange} />}
    >
      <div className="traffic-stats">
        <div><span>{pattern.length}</span>near the pattern<small>within {PATTERN_NM} NM, below {formatNumber(PATTERN_AGL)} ft AGL</small></div>
        <div><span>{onGround.length}</span>on the ground<small>within 2 NM</small></div>
        <div><span>{visible.length}</span>within {range} NM<small>all altitudes</small></div>
      </div>

      <div className="traffic-layout">
        <div className="map-frame traffic-map">
          {tiles.map((tile) => (
            <img
              key={`${config.zoom}-${tile.x}-${tile.y}`}
              className="map-tile base-tile"
              alt=""
              draggable="false"
              src={osmTileUrl(config.zoom, tile.x, tile.y)}
              style={{ left: `calc(50% + ${tile.left}px)`, top: `calc(50% + ${tile.top}px)`, width: TILE_SIZE, height: TILE_SIZE }}
            />
          ))}
          {config.rings.map((ring) => {
            const px = nmToPixels(ring, airport.lat, config.zoom);
            return <div key={ring} className="map-ring" style={{ width: px * 2, height: px * 2 }}><span>{ring} NM</span></div>;
          })}
          <div className="map-center"><span>{airport.icao}</span></div>
          {visible.slice(0, 40).map((ac) => {
            const point = lonLatToWorld(ac.lat, ac.lon, config.zoom);
            const id = ac.hex || ac.callsign;
            const inPattern = pattern.includes(ac);
            return (
              <a
                key={id}
                className={`aircraft ${inPattern ? 'in-pattern' : ''} ${ac.on_ground ? 'on-ground' : ''} ${ac.emergency ? 'emergency' : ''} ${hover === id ? 'hover' : ''}`}
                href={`https://globe.adsb.fi/?icao=${encodeURIComponent(ac.hex || '')}`}
                target="_blank"
                rel="noreferrer"
                style={{ left: `calc(50% + ${point.x - world.x}px)`, top: `calc(50% + ${point.y - world.y}px)` }}
                onMouseEnter={() => setHover(id)}
                onMouseLeave={() => setHover(null)}
                title={`${ac.callsign}${ac.type ? ` · ${ac.type}` : ''}`}
              >
                <Navigation size={15} style={{ transform: `rotate(${(ac.track_deg || 0) - 45}deg)` }} />
                {ac.on_ground ? null : (
                  <span className="aircraft-tag">
                    {ac.callsign}
                    <small>{ac.altitude_ft != null ? `${String(Math.round(ac.altitude_ft / 100)).padStart(3, '0')} ${trend(ac.vertical_rate_fpm)}`.trim() : '---'}</small>
                  </span>
                )}
              </a>
            );
          })}
          {!visible.length ? <div className="map-empty">No ADS-B aircraft within {range} NM</div> : null}
          <div className="map-attribution">
            <a href="https://adsb.fi" target="_blank" rel="noreferrer">adsb.fi</a> · © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a>
          </div>
        </div>

        <div className="traffic-table-wrap">
          <table className="traffic-table">
            <thead>
              <tr><th>Aircraft</th><th>Type</th><th>AGL</th><th>Range</th><th>GS</th></tr>
            </thead>
            <tbody>
              {visible.slice(0, 15).map((ac) => {
                const id = ac.hex || ac.callsign;
                return (
                  <tr key={id} className={`${hover === id ? 'hover' : ''} ${pattern.includes(ac) ? 'in-pattern' : ''}`} onMouseEnter={() => setHover(id)} onMouseLeave={() => setHover(null)}>
                    <td className="mono">{ac.callsign}</td>
                    <td>{ac.type || '--'}</td>
                    <td>{ac.on_ground ? 'GND' : ac.agl != null ? `${formatNumber(Math.round(ac.agl / 100) * 100)}${trend(ac.vertical_rate_fpm)}` : '--'}</td>
                    <td>{ac.distance_nm != null ? `${ac.distance_nm} ${cardinal(ac.bearing_deg)}` : '--'}</td>
                    <td>{ac.ground_speed_kt ?? '--'}</td>
                  </tr>
                );
              })}
              {!visible.length ? <tr><td colSpan={5} className="muted">Nothing showing. Not everyone broadcasts ADS-B; keep looking outside.</td></tr> : null}
            </tbody>
          </table>
          <p className="fine-print">
            Map tags show altitude in hundreds of feet MSL; the table shows height above the field. ADS-B coverage near the ground is
            incomplete and positions can lag. {traffic.data ? `Last update ${formatLocal(traffic.data.fetched_utc, airport.timezone, 'h:mm:ss a')}.` : ''}
          </p>
        </div>
      </div>
    </Card>
  );
}
