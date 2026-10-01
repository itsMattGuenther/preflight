import { Wind } from 'lucide-react';
import { runwayWinds } from '../../lib/aviation/wind';
import { formatFeet, formatWind, padHeading } from '../../lib/format';
import { Card, Notice, Skeleton } from '../ui';

const C = 100;
const RAD = Math.PI / 180;
const dir = (deg) => ({ x: Math.sin(deg * RAD), y: -Math.cos(deg * RAD) });

// Parallel runways share a heading; spread them side by side (L, C, R as
// seen from the first end) so they don't draw on top of each other.
function parallelOffsets(runways) {
  const groups = new Map();
  for (const runway of runways) {
    const key = Math.round((runway.ends[0].heading_true % 180) / 5);
    groups.set(key, [...(groups.get(key) || []), runway]);
  }
  const offsets = new Map();
  const side = (id) => ({ L: 0, C: 1, R: 2 }[String(id).slice(-1)] ?? 1);
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const sorted = [...group].sort((a, b) => side(a.ends[0].id) - side(b.ends[0].id) || (b.length_ft || 0) - (a.length_ft || 0));
    sorted.forEach((runway, index) => offsets.set(runway.id, (index - (sorted.length - 1) / 2) * 18));
  }
  return offsets;
}

function RunwayDiagram({ runways, ranked, wind }) {
  const longest = Math.max(...runways.map((runway) => runway.length_ft || 0), 1);
  const best = ranked.find((item) => item.eligible);
  const variable = wind?.wind_vrb || (wind?.wind_dir_deg == null && wind?.wind_speed_kt > 0);
  const calm = wind?.wind_calm || wind?.wind_speed_kt === 0;
  const offsets = parallelOffsets(runways);

  return (
    <svg viewBox="0 0 200 200" className="runway-diagram" role="img" aria-label="Runway layout with wind direction">
      <circle cx={C} cy={C} r={88} className="compass-ring" />
      {Array.from({ length: 36 }).map((_, index) => {
        const deg = index * 10;
        const outer = dir(deg);
        const inner = index % 3 === 0 ? 81 : 85;
        return <line key={deg} x1={C + outer.x * 88} y1={C + outer.y * 88} x2={C + outer.x * inner} y2={C + outer.y * inner} className="compass-tick" />;
      })}
      {[['N', 0], ['E', 90], ['S', 180], ['W', 270]].map(([label, deg]) => {
        const point = dir(deg);
        return <text key={label} x={C + point.x * 73} y={C + point.y * 73 + 3.5} className="compass-label">{label}</text>;
      })}

      {runways.map((runway) => {
        const [first, second] = runway.ends;
        const length = 48 + 58 * ((runway.length_ft || longest * 0.5) / longest);
        const isBest = best && best.runway.id === runway.id;
        const eligible = ranked.some((item) => item.runway.id === runway.id && item.eligible);
        const heading = first.heading_true;
        const u = dir(heading);
        const right = dir(heading + 90);
        const shift = offsets.get(runway.id) || 0;
        const cx = C + right.x * shift;
        const cy = C + right.y * shift;
        const half = length / 2;
        const labelFirst = { x: cx - u.x * (half + 9), y: cy - u.y * (half + 9) };
        const labelSecond = { x: cx + u.x * (half + 9), y: cy + u.y * (half + 9) };
        return (
          <g key={runway.id} className={`rwy ${isBest ? 'rwy-best' : ''} ${eligible ? '' : 'rwy-ineligible'} ${runway.paved === false ? 'rwy-unpaved' : ''}`}>
            <rect x={cx - 4.5} y={cy - half} width={9} height={length} rx={1.5} transform={`rotate(${heading} ${cx} ${cy})`} />
            <line x1={cx} y1={cy - half + 6} x2={cx} y2={cy + half - 6} transform={`rotate(${heading} ${cx} ${cy})`} className="rwy-centerline" />
            <text x={labelFirst.x} y={labelFirst.y + 3} className="rwy-label">{first.id}</text>
            {second ? <text x={labelSecond.x} y={labelSecond.y + 3} className="rwy-label">{second.id}</text> : null}
          </g>
        );
      })}

      {!calm && !variable && wind?.wind_dir_deg != null ? (() => {
        const from = dir(wind.wind_dir_deg);
        const tail = { x: C + from.x * 97, y: C + from.y * 97 };
        const tip = { x: C + from.x * 58, y: C + from.y * 58 };
        const side = { x: -from.y, y: from.x };
        const head1 = { x: tip.x + from.x * 9 + side.x * 5, y: tip.y + from.y * 9 + side.y * 5 };
        const head2 = { x: tip.x + from.x * 9 - side.x * 5, y: tip.y + from.y * 9 - side.y * 5 };
        return (
          <g className="wind-vector">
            <line x1={tail.x} y1={tail.y} x2={tip.x + from.x * 6} y2={tip.y + from.y * 6} />
            <polygon points={`${tip.x},${tip.y} ${head1.x},${head1.y} ${head2.x},${head2.y}`} />
          </g>
        );
      })() : null}
      {variable ? <circle cx={C} cy={C} r={93} className="wind-variable" /> : null}
      <text x={C} y={196} className="diagram-caption">{calm ? 'Calm' : variable ? 'Variable wind' : `Wind ${padHeading(wind?.wind_dir_deg)}° true`}</text>
    </svg>
  );
}

function component(item) {
  if (item.steady.headwind == null) return '--';
  const value = Math.round(item.steady.headwind);
  return value >= 0 ? `${value} head` : `${Math.abs(value)} tail`;
}

function cross(item) {
  if (item.steady.crosswind == null) return '--';
  const steady = Math.round(item.steady.crosswind);
  const gust = item.gust ? Math.round(item.gust.crosswind) : null;
  return `${steady}${gust != null && gust !== steady ? ` (G${gust})` : ''}`;
}

export function RunwayCard({ airport, weather, minimums }) {
  const metar = weather.data?.metar;
  if (!airport || weather.isPending) return <Card title="Runways & wind" icon={Wind} className="area-runway"><Skeleton lines={5} /></Card>;
  const runways = airport.runways || [];
  if (!runways.length) {
    return <Card title="Runways & wind" icon={Wind} className="area-runway"><Notice tone="warning">No runway data for this airport. Check the Chart Supplement.</Notice></Card>;
  }

  const options = { pavedOnly: minimums.paved_only, minLengthFt: minimums.min_runway_ft || 0 };
  const ranked = runwayWinds(runways, metar, options);
  const best = ranked.find((item) => item.eligible);
  const variable = metar?.wind_vrb;
  const approximate = runways.some((runway) => runway.ends.some((end) => end.heading_source !== 'true'));

  return (
    <Card title="Runways & wind" icon={Wind} className="area-runway" meta={metar ? formatWind(metar) : 'No wind data'}>
      <div className="runway-layout">
        <RunwayDiagram runways={runways} ranked={ranked} wind={metar} />
        <div className="runway-best">
          {best && (!metar || metar.wind_speed_kt == null) ? (
            <Notice tone="warning">No wind report available, so crosswind can&apos;t be computed. Check the AWOS/ATIS before you fly.</Notice>
          ) : best ? (
            <>
              <div className="control-label">Best runway for your limits</div>
              <div className="best-id">RWY {best.id}</div>
              <dl className="best-components">
                <div><dt>{(best.steady.headwind ?? 0) >= 0 ? 'Headwind' : 'Tailwind'}</dt><dd>{best.steady.headwind == null ? 'Unknown' : `${Math.abs(Math.round(best.steady.headwind))} kt`}</dd></div>
                <div>
                  <dt>Crosswind</dt>
                  <dd>
                    {Math.round(best.steady.crosswind ?? 0)} kt
                    {best.steady.from ? <small> from {best.steady.from}</small> : null}
                    {best.gust ? <small> · gusts {Math.round(best.gust.crosswind)} kt</small> : null}
                  </dd>
                </div>
                <div><dt>Runway</dt><dd>{formatFeet(best.runway.length_ft)} · {best.runway.surface}</dd></div>
              </dl>
              {variable ? <p className="muted small">Variable wind: assume the full speed could be a direct crosswind.</p> : null}
              {minimums.crosswind_kt != null && best.worst_crosswind > minimums.crosswind_kt ? (
                <p className="limit-warning">Exceeds your {minimums.crosswind_kt} kt crosswind limit.</p>
              ) : null}
            </>
          ) : (
            <Notice tone="warning">No runway here meets your limits ({[minimums.paved_only ? 'paved' : null, minimums.min_runway_ft ? `${formatFeet(minimums.min_runway_ft)}+` : null].filter(Boolean).join(', ')}).</Notice>
          )}
        </div>
      </div>

      <table className="runway-table">
        <thead>
          <tr><th>RWY</th><th>Head/tail</th><th>Cross</th><th>Length</th><th>Surface</th></tr>
        </thead>
        <tbody>
          {ranked.map((item) => (
            <tr key={`${item.runway.id}-${item.id}`} className={`${item === best ? 'best' : ''} ${item.eligible ? '' : 'ineligible'}`}>
              <td className="mono">{item.id}</td>
              <td>{component(item)}</td>
              <td>{cross(item)}</td>
              <td>{formatFeet(item.runway.length_ft)}</td>
              <td>{item.runway.surface}{item.eligible ? '' : ' ·  outside limits'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="fine-print">
        Components in knots, gusts in parentheses. METAR wind and these runway headings are both <strong>true</strong>; ATIS/AWOS broadcasts give
        wind in <strong>magnetic</strong>{airport.magvar_deg != null ? ` (variation here: ${Math.abs(airport.magvar_deg)}°${airport.magvar_deg >= 0 ? 'E' : 'W'})` : ''}.
        {approximate ? ' Some headings are estimated from runway numbers.' : ''} Diagram is schematic, not to scale.
      </p>
    </Card>
  );
}
