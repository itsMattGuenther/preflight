import { Compass } from 'lucide-react';
import { cardinal, formatWindShort } from '../../lib/format';
import { CategoryBadge, Card, Skeleton } from '../ui';

export function NearbyCard({ nearby, loading, onSelect }) {
  return (
    <Card title="Nearby airports" icon={Compass} className="area-nearby">
      {loading ? <Skeleton lines={4} /> : null}
      <ul className="nearby-list">
        {(nearby || []).map((item) => (
          <li key={item.icao}>
            <button type="button" onClick={() => onSelect(item.icao)}>
              <CategoryBadge category={item.flight_category} size="sm" />
              <span className="nearby-id mono">{item.icao}</span>
              <span className="nearby-name">{item.name}</span>
              <span className="nearby-wind mono">{item.wind_speed_kt != null ? formatWindShort({ wind_dir_deg: item.wind_dir_deg, wind_vrb: item.wind_dir_deg == null && item.wind_speed_kt > 0, wind_speed_kt: item.wind_speed_kt, wind_gust_kt: item.wind_gust_kt }) : ''}</span>
              <span className="nearby-dist">{item.distance_nm} NM {cardinal(item.bearing_deg)}</span>
            </button>
          </li>
        ))}
        {!loading && !nearby?.length ? <li className="muted small">No reporting stations nearby.</li> : null}
      </ul>
    </Card>
  );
}
