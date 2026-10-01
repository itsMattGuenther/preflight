import { CalendarClock } from 'lucide-react';
import { useState } from 'react';
import { describeWeatherGroup, parseWeather } from '../../lib/aviation/metar';
import { applyOverlay, basePeriodAt, tafSlots } from '../../lib/aviation/taf';
import { cardinal, formatFeet, formatLocal, formatVisibility, formatWindShort, formatZulu, timeAgo } from '../../lib/format';
import { CategoryBadge, Card, ErrorNote, Notice, Segmented, Skeleton } from '../ui';

const HOUR = 3600 * 1000;
const HOURS = 24;

function conditionsText(period) {
  const parts = [];
  if (period.wind_speed_kt != null) parts.push(formatWindShort(period));
  if (period.visibility_sm != null) parts.push(formatVisibility(period.visibility_sm, period.visibility_plus));
  const wx = parseWeather(period.wx);
  if (wx.length) parts.push(wx.map(describeWeatherGroup).join(', '));
  else if (period.wx === '' && period.change !== 'TEMPO' && period.change !== 'PROB') parts.push('No weather');
  if (period.clouds) {
    const layers = period.clouds.filter((layer) => layer.base_ft != null && !['SKC', 'CLR', 'NSC'].includes(layer.cover));
    parts.push(layers.length ? layers.map((layer) => `${layer.cover} ${formatFeet(layer.base_ft)}${layer.type ? ` ${layer.type}` : ''}`).join(', ') : 'Sky clear');
  }
  if (period.wind_shear) parts.push(`Wind shear at ${formatFeet(period.wind_shear.height_ft)}`);
  return parts.join(' · ');
}

// A TEMPO/PROB group lists only what changes, so its category must be worked
// out against the base group it modifies (e.g. TEMPO P6SM over OVC004 is
// still LIFR because the ceiling is unchanged).
function displayCategory(taf, period) {
  if (!['TEMPO', 'PROB'].includes(period.change)) return period.flight_category;
  const base = basePeriodAt(taf, Date.parse(period.from_utc) + 1000);
  return base ? applyOverlay(base, period).flight_category : period.flight_category;
}

function changeLabel(period, tz) {
  const from = `${formatLocal(period.from_utc, tz, 'EEE h a')} (${formatZulu(period.from_utc)})`;
  const to = formatLocal(period.to_utc, tz, 'h a');
  switch (period.change) {
    case 'BASE': return `From ${from}`;
    case 'FM': return `From ${from}`;
    case 'BECMG': return `Becoming, ${from}`;
    case 'TEMPO': return `Temporarily ${formatLocal(period.from_utc, tz, 'EEE h a')}–${to}`;
    case 'PROB': return `${period.probability ?? ''}% chance ${formatLocal(period.from_utc, tz, 'EEE h a')}–${to}`;
    default: return from;
  }
}

export function TafCard({ weather, airport, windowRange, now }) {
  const [view, setView] = useState('timeline');
  const tz = airport?.timezone;
  const taf = weather.data?.taf;
  const source = weather.data?.taf_source;

  if (weather.isPending) return <Card title="Forecast (TAF)" icon={CalendarClock} className="area-taf"><Skeleton lines={4} /></Card>;
  if (weather.isError) return <Card title="Forecast (TAF)" icon={CalendarClock} className="area-taf"><ErrorNote error={weather.error} what="the forecast" onRetry={weather.refetch} /></Card>;
  if (!taf) {
    return (
      <Card title="Forecast (TAF)" icon={CalendarClock} className="area-taf">
        <Notice tone="warning">
          No TAF within 40 NM. Use the{' '}
          <a href="https://aviationweather.gov/gfa/" target="_blank" rel="noreferrer">Graphical Forecasts for Aviation</a> and a standard briefing for the forecast.
        </Notice>
      </Card>
    );
  }

  const start = Math.floor(now / HOUR) * HOUR;
  const slots = tafSlots(taf, start, HOURS);
  const pct = (ms) => Math.min(100, Math.max(0, ((ms - start) / (HOURS * HOUR)) * 100));
  const visiblePeriods = taf.periods.filter((period) => Date.parse(period.to_utc) > now);

  return (
    <Card
      title="Forecast (TAF)"
      icon={CalendarClock}
      className="area-taf"
      meta={`${taf.station}${taf.amended ? ' AMD' : ''} · issued ${formatZulu(taf.issued_utc)} · ${timeAgo(taf.issued_utc, now)}`}
      action={<Segmented label="TAF view" value={view} onChange={setView} options={[{ value: 'timeline', label: 'Timeline' }, { value: 'raw', label: 'Raw' }]} />}
    >
      {source && !source.is_field ? (
        <Notice tone="info">
          {source.reason === 'no_current_report' ? `No current TAF from ${airport?.icao}.` : `No TAF for ${airport?.icao}.`}{' '}
          Showing <strong>{source.icao}</strong> ({source.name}), {source.distance_nm} NM {cardinal(source.bearing_deg)}.
        </Notice>
      ) : null}

      {view === 'raw' ? (
        <pre className="raw-text">{taf.raw.replace(/\s+(FM\d{6}|TEMPO|BECMG|PROB\d{2})/g, '\n  $1')}</pre>
      ) : (
        <>
          <div className="timeline" role="img" aria-label="Forecast flight category for the next 24 hours">
            <div className="timeline-bar">
              {slots.map((slot) => (
                <div
                  key={slot.t}
                  className={`timeline-slot cat-bg-${slot.category?.toLowerCase() || 'none'}`}
                  title={slot.base ? `${formatLocal(slot.t, tz, 'h a')}: ${slot.category}${slot.worst !== slot.category ? ` (temporarily ${slot.worst})` : ''}` : 'Beyond the TAF'}
                >
                  {slot.worst && slot.worst !== slot.category ? <span className={`timeline-overlay cat-bg-${slot.worst.toLowerCase()}`} /> : null}
                </div>
              ))}
              {windowRange ? (
                <div className="timeline-window" style={{ left: `${pct(windowRange.startMs)}%`, width: `${Math.max(1, pct(windowRange.endMs) - pct(windowRange.startMs))}%` }}>
                  <span>Your flight</span>
                </div>
              ) : null}
              <div className="timeline-now" style={{ left: `${pct(now)}%` }} />
            </div>
            <div className="timeline-labels">
              {slots.map((slot, index) => (index % 3 === 0 ? (
                <span key={slot.t} style={{ left: `${(index / HOURS) * 100}%` }}>
                  {formatLocal(slot.t, tz, 'ha').toLowerCase()}
                  <small>{formatZulu(slot.t, 'HH')}</small>
                </span>
              ) : null))}
            </div>
            <div className="timeline-legend">
              {['VFR', 'MVFR', 'IFR', 'LIFR'].map((cat) => (
                <span key={cat}><i className={`cat-bg-${cat.toLowerCase()}`} />{cat}</span>
              ))}
              <span>Lower band: TEMPO / PROB</span>
            </div>
          </div>

          <ol className="taf-periods">
            {visiblePeriods.map((period) => (
              <li key={`${period.change}-${period.from_utc}-${period.probability}`} className={['TEMPO', 'PROB'].includes(period.change) ? 'overlay' : ''}>
                <span className="taf-when">{changeLabel(period, tz)}</span>
                <CategoryBadge category={displayCategory(taf, period)} size="sm" />
                <span className="taf-what">{conditionsText(period)}</span>
              </li>
            ))}
          </ol>
        </>
      )}
    </Card>
  );
}
