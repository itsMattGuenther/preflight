import { Sunrise } from 'lucide-react';
import { formatDuration, formatLocal, formatZulu } from '../../lib/format';
import { Card } from '../ui';

const DAY_MS = 24 * 3600 * 1000;

export function DaylightCard({ airport, sun, now }) {
  if (!sun?.sunrise || !sun?.sunset) {
    return <Card title="Daylight" icon={Sunrise} className="area-daylight"><p className="muted small">Sun times unavailable for this location.</p></Card>;
  }
  const tz = airport?.timezone;
  // Bar spans local midnight to midnight around the civil-twilight window.
  const dayStart = sun.civil_dawn ? sun.civil_dawn.getTime() - 4 * 3600 * 1000 : sun.sunrise.getTime() - 5 * 3600 * 1000;
  const pct = (date) => Math.min(100, Math.max(0, ((new Date(date).getTime() - dayStart) / DAY_MS) * 100));
  const rows = [
    ['Civil twilight begins', sun.civil_dawn, 'Earliest the regulations call it day (14 CFR 1.1)'],
    ['Sunrise', sun.sunrise, 'Position lights no longer required'],
    ['Sunset', sun.sunset, 'Position lights required (91.209)'],
    ['Civil twilight ends', sun.civil_dusk, 'Night begins: log night time from here'],
    ['Night currency window', sun.night_currency_start, '1 hr after sunset: full-stop landings count for 61.57(b)'],
  ];
  const remaining = sun.sunset.getTime() - now;

  return (
    <Card title="Daylight" icon={Sunrise} className="area-daylight" meta={remaining > 0 ? `${formatDuration(remaining)} until sunset` : 'After sunset'}>
      <div className="day-bar" aria-hidden="true">
        {sun.civil_dawn && sun.civil_dusk ? <span className="day-twilight" style={{ left: `${pct(sun.civil_dawn)}%`, width: `${pct(sun.civil_dusk) - pct(sun.civil_dawn)}%` }} /> : null}
        <span className="day-sun" style={{ left: `${pct(sun.sunrise)}%`, width: `${pct(sun.sunset) - pct(sun.sunrise)}%` }} />
        {now >= dayStart && now <= dayStart + DAY_MS ? <span className="day-now" style={{ left: `${pct(now)}%` }} /> : null}
      </div>
      <dl className="sun-list">
        {rows.filter(([, time]) => time).map(([label, time, note]) => (
          <div key={label}>
            <dt>{label}<small>{note}</small></dt>
            <dd>{formatLocal(time, tz)}<small>{formatZulu(time)}</small></dd>
          </div>
        ))}
      </dl>
    </Card>
  );
}
