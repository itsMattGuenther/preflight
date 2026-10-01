import { Cloud } from 'lucide-react';
import { useState } from 'react';
import { densityAltitude } from '../../lib/aviation/density';
import { describeWeatherGroup, parseWeather, plainEnglishMetar } from '../../lib/aviation/metar';
import {
  cardinal,
  celsiusToF,
  formatAltimeter,
  formatFeet,
  formatLocal,
  formatTemp,
  formatVisibility,
  formatWind,
  formatWindShort,
  formatZulu,
  padHeading,
  timeAgo,
} from '../../lib/format';
import { CategoryBadge, Card, ErrorNote, Notice, Segmented, Skeleton } from '../ui';

function WindArrow({ dir, size = 18 }) {
  if (dir == null) return null;
  // The path points south (180); rotating by the wind direction makes it
  // point the way the wind is blowing (toward dir + 180).
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className="wind-arrow-icon" style={{ transform: `rotate(${dir}deg)` }} aria-hidden="true">
      <path d="M12 3v15M12 21l-5-6h10z" fill="currentColor" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  );
}

function Metric({ label, value, sub, tone }) {
  return (
    <div className={`metric ${tone ? `metric-${tone}` : ''}`}>
      <div className="metric-label">{label}</div>
      <div className="metric-value">{value}</div>
      {sub ? <div className="metric-sub">{sub}</div> : null}
    </div>
  );
}

function cloudSummary(metar) {
  if (metar.clouds == null) return 'Sky not reported';
  if (!metar.clouds.length || metar.clear) return 'Clear';
  return metar.clouds.map((layer) => `${layer.cover}${layer.base_ft != null ? String(Math.round(layer.base_ft / 100)).padStart(3, '0') : ''}${layer.type || ''}`).join(' ');
}

export function ConditionsCard({ weather, airport, lastSeen, now }) {
  const [view, setView] = useState('decoded');
  const tz = airport?.timezone;
  const metar = weather.data?.metar;
  const source = weather.data?.metar_source;

  if (weather.isPending) return <Card title="Current conditions" icon={Cloud} className="area-conditions"><Skeleton lines={6} /></Card>;
  if (weather.isError) return <Card title="Current conditions" icon={Cloud} className="area-conditions"><ErrorNote error={weather.error} what="weather" onRetry={weather.refetch} /></Card>;
  if (!metar) {
    return (
      <Card title="Current conditions" icon={Cloud} className="area-conditions">
        <Notice tone="warning">No current weather observation at or within 30 NM of this airport. Check the area forecast and nearby stations before flying.</Notice>
      </Card>
    );
  }

  const ageMin = Math.round((now - Date.parse(metar.observed_utc)) / 60000);
  const spread = metar.temp_c != null && metar.dewpoint_c != null ? metar.temp_c - metar.dewpoint_c : null;
  const da = densityAltitude(airport?.elevation_ft, metar.temp_c, metar.altimeter_inhg);
  const daAbove = da != null && airport?.elevation_ft != null ? da - airport.elevation_ft : null;
  const weatherGroups = parseWeather(metar.wx);
  const recent = (weather.data?.recent || []).slice(1, 4);

  return (
    <Card
      title="Current conditions"
      icon={Cloud}
      className="area-conditions"
      meta={`${formatZulu(metar.observed_utc)} · ${formatLocal(metar.observed_utc, tz)} · ${timeAgo(metar.observed_utc, now)}`}
    >
      {source && !source.is_field ? (
        <Notice tone={source.reason === 'no_current_report' ? 'warning' : 'info'}>
          {source.reason === 'no_current_report' ? `No current report from ${airport?.icao}.` : `${airport?.icao} has no weather reporting.`}{' '}
          Showing <strong>{source.icao}</strong> ({source.name}), {source.distance_nm} NM {cardinal(source.bearing_deg)}.
        </Notice>
      ) : null}
      {ageMin > 75 ? <Notice tone="warning">This observation is {ageMin} minutes old. Conditions may have changed.</Notice> : null}

      <div className="conditions-top">
        <CategoryBadge category={metar.flight_category} size="lg" />
        <div className="conditions-summary">
          <div className="conditions-wind">
            <WindArrow dir={metar.wind_vrb ? null : metar.wind_dir_deg} />
            {formatWind(metar)}
          </div>
          <div className="conditions-sky">
            {weatherGroups.length
              ? weatherGroups.map(describeWeatherGroup).join(', ')
              : metar.ceiling_ft != null ? `Ceiling ${formatFeet(metar.ceiling_ft)}` : metar.clouds == null ? 'Sky not reported' : 'No ceiling'}
            {' · '}
            {formatVisibility(metar.visibility_sm, metar.visibility_plus)}
          </div>
        </div>
      </div>

      <div className="metric-grid">
        <Metric
          label="Ceiling"
          value={metar.ceiling_ft != null ? formatFeet(metar.ceiling_ft) : metar.clouds == null ? 'Unknown' : 'None'}
          sub={cloudSummary(metar)}
          tone={metar.clouds == null ? 'caution' : null}
        />
        <Metric label="Visibility" value={formatVisibility(metar.visibility_sm, metar.visibility_plus)} sub={metar.wx || 'No weather'} />
        <Metric
          label="Wind"
          value={formatWindShort(metar)}
          sub={metar.wind_var_from_deg != null ? `Varying ${padHeading(metar.wind_var_from_deg)}°–${padHeading(metar.wind_var_to_deg)}°` : 'Degrees true'}
        />
        <Metric
          label="Temp / dew point"
          value={`${formatTemp(metar.temp_c)} / ${formatTemp(metar.dewpoint_c)}`}
          sub={spread != null ? `Spread ${Math.round(spread)}°${spread <= 3 ? ' · fog risk' : ''} · ${celsiusToF(metar.temp_c)}°F` : null}
          tone={spread != null && spread <= 3 ? 'caution' : null}
        />
        <Metric label="Altimeter" value={`${formatAltimeter(metar.altimeter_inhg)}`} sub="inHg" />
        <Metric
          label="Density altitude"
          value={da != null ? formatFeet(Math.round(da / 10) * 10) : '--'}
          sub={daAbove != null ? `${daAbove >= 0 ? '+' : ''}${formatFeet(Math.round(daAbove / 10) * 10)} vs field` : 'Needs temperature'}
          tone={daAbove != null && daAbove > 2000 ? 'caution' : null}
        />
      </div>

      <div className="raw-toggle">
        <Segmented
          label="METAR view"
          value={view}
          onChange={setView}
          options={[{ value: 'decoded', label: 'Plain English' }, { value: 'raw', label: 'Raw METAR' }]}
        />
      </div>
      {view === 'raw' ? (
        <pre className="raw-text">{metar.raw}</pre>
      ) : (
        <ul className="plain-english">
          {plainEnglishMetar(metar, { elevationFt: airport?.elevation_ft }).map((line) => <li key={line}>{line}</li>)}
        </ul>
      )}

      {recent.length ? (
        <div className="trend">
          <div className="section-label">Earlier reports</div>
          <table>
            <tbody>
              {recent.map((item) => (
                <tr key={item.observed_utc}>
                  <td className="mono">{formatZulu(item.observed_utc)}</td>
                  <td><CategoryBadge category={item.flight_category} size="sm" /></td>
                  <td className="mono">{formatWindShort(item)}</td>
                  <td>{formatVisibility(item.visibility_sm)}</td>
                  <td>{item.ceiling_ft != null ? `CIG ${formatFeet(item.ceiling_ft)}` : 'No CIG'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {lastSeen ? (
        <div className="last-seen">
          <div className="section-label">Since you last looked ({formatLocal(lastSeen.previous.seen_utc, tz, 'EEE h:mm a')})</div>
          {lastSeen.sameReport ? (
            <p className="muted small">No new observation since then.</p>
          ) : lastSeen.changes.length ? (
            <ul>
              {lastSeen.changes.map((change) => <li key={change.label} className={change.important ? 'important' : ''}>{change.label}</li>)}
            </ul>
          ) : (
            <p className="muted small">New report, no significant changes.</p>
          )}
        </div>
      ) : null}
    </Card>
  );
}
