import { Wind } from 'lucide-react';
import { useState } from 'react';
import { formatNumber, padHeading } from '../../lib/format';
import { Card, ErrorNote, Segmented, Skeleton } from '../ui';

function freezingLevel(levels) {
  // Linear interpolation between the first two levels that straddle 0°C.
  const withTemp = levels.filter((level) => level.temp_c != null);
  for (let i = 0; i < withTemp.length - 1; i += 1) {
    const a = withTemp[i];
    const b = withTemp[i + 1];
    if (a.temp_c > 0 && b.temp_c <= 0) {
      return Math.round((a.alt_ft + ((b.alt_ft - a.alt_ft) * a.temp_c) / (a.temp_c - b.temp_c)) / 500) * 500;
    }
  }
  if (withTemp.length && withTemp[0].temp_c <= 0) return 'below';
  return null;
}

function Arrow({ dir }) {
  if (dir == null) return <span className="aloft-arrow">·</span>;
  return <span className="aloft-arrow" style={{ transform: `rotate(${dir + 180}deg)` }}>↑</span>;
}

export function WindsAloftCard({ winds }) {
  const [index, setIndex] = useState(0);
  if (winds.isPending) return <Card title="Winds aloft" icon={Wind} className="area-aloft"><Skeleton lines={4} /></Card>;
  if (winds.isError) return <Card title="Winds aloft" icon={Wind} className="area-aloft"><ErrorNote error={winds.error} what="winds aloft" onRetry={winds.refetch} /></Card>;
  const station = winds.data?.station;
  const forecasts = winds.data?.forecasts || [];
  if (!station || !forecasts.length) {
    return <Card title="Winds aloft" icon={Wind} className="area-aloft"><p className="muted small">No winds-aloft forecast point nearby (contiguous US only).</p></Card>;
  }
  const forecast = forecasts[Math.min(index, forecasts.length - 1)];
  const levels = forecast.levels.filter((level) => level.alt_ft <= 18000);
  const fzl = freezingLevel(forecast.levels);

  return (
    <Card
      title="Winds aloft"
      icon={Wind}
      className="area-aloft"
      meta={`${station.id} · ${station.distance_nm} NM`}
      action={forecasts.length > 1 ? (
        <Segmented label="Forecast period" value={index} onChange={setIndex} options={forecasts.map((item, i) => ({ value: i, label: `${item.hours}h` }))} />
      ) : null}
    >
      <table className="aloft-table">
        <thead><tr><th>Altitude</th><th>Wind</th><th>Temp</th></tr></thead>
        <tbody>
          {levels.map((level) => (
            <tr key={level.alt_ft}>
              <th>{formatNumber(level.alt_ft)}</th>
              <td>
                <Arrow dir={level.light_variable ? null : level.dir_deg} />
                {level.light_variable ? 'Light & variable' : `${padHeading(level.dir_deg)}° @ ${level.speed_kt} kt`}
              </td>
              <td>{level.temp_c != null ? `${level.temp_c}°C` : '--'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="fine-print">
        For use {forecast.for_use || '--'} · {station.name || station.id}. Directions true.{' '}
        {fzl === 'below' ? 'Freezing level at or below the lowest level shown.' : fzl ? `Freezing level about ${formatNumber(fzl)} ft MSL.` : ''}
        {' '}The lowest level is omitted when it is within 1,500 ft of the station.
      </p>
    </Card>
  );
}
