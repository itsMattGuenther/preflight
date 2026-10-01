import { Fuel } from 'lucide-react';
import { cardinal, money } from '../../lib/format';
import { Card, LinkOut, Skeleton } from '../ui';

function pct(value, min, max) {
  if (value == null || min == null || max == null || max <= min) return null;
  return Math.min(98, Math.max(2, ((value - min) / (max - min)) * 100));
}

function deltaText(ref) {
  if (ref?.delta_pct == null) return null;
  const value = ref.delta_pct;
  return `${value > 0 ? '+' : ''}${value.toFixed(1)}% vs ${ref.label.toLowerCase()}`;
}

// Where this price sits between the cheapest and priciest fuel reported in
// the FAA region (national range if the region is unknown), with the
// regional and national averages marked.
function PriceBar({ item }) {
  const range = item.regional?.min != null ? item.regional : item.national;
  if (!range) return null;
  const position = pct(item.price_per_gal, range.min, range.max);
  const regionalTick = item.regional ? pct(item.regional.avg, range.min, range.max) : null;
  const nationalTick = item.national ? pct(item.national.avg, range.min, range.max) : null;
  const reference = item.regional || item.national;
  const tone = reference?.delta_pct == null ? '' : reference.delta_pct <= -5 ? 'good' : reference.delta_pct >= 5 ? 'bad' : '';
  return (
    <div className="price-bar-wrap">
      <div className="price-bar" role="img" aria-label={`${money(item.price_per_gal)} compared with ${range.label.toLowerCase()} prices from ${money(range.min)} to ${money(range.max)}`}>
        {regionalTick != null ? <span className="price-tick regional" style={{ left: `${regionalTick}%` }} title={`${item.regional.label} average ${money(item.regional.avg)}`} /> : null}
        {nationalTick != null && item.regional ? <span className="price-tick national" style={{ left: `${nationalTick}%` }} title={`National average ${money(item.national.avg)}`} /> : null}
        {position != null ? <span className="price-dot" style={{ left: `${position}%` }} /> : null}
      </div>
      <div className="price-scale">
        <span>{money(range.min)} low</span>
        <span>{item.regional ? `${item.regional.label} avg ${money(item.regional.avg)}` : `National avg ${money(item.national.avg)}`}</span>
        <span>{money(range.max)} high</span>
      </div>
      <div className={`price-deltas ${tone}`}>
        {[deltaText(item.regional), deltaText(item.national)].filter(Boolean).join(' · ')}
      </div>
    </div>
  );
}

function cheapestLocal(items, code) {
  const prices = items.filter((item) => item.code === code).map((item) => item.price_per_gal);
  return prices.length ? Math.min(...prices) : null;
}

function NearbyPrice({ fuel, local }) {
  if (!fuel) return <span className="muted">--</span>;
  const diff = local != null ? fuel.price_per_gal - local : null;
  const tone = diff == null ? '' : diff <= -0.1 ? 'good' : diff >= 0.1 ? 'bad' : '';
  return (
    <span className="nearby-price">
      <strong>{money(fuel.price_per_gal)}</strong>
      {fuel.service === 'Self service' ? <small>self</small> : null}
      {diff != null && Math.abs(diff) >= 0.01 ? <em className={tone}>{diff > 0 ? '+' : '−'}{money(Math.abs(diff)).slice(1)}</em> : null}
    </span>
  );
}

export function FuelCard({ fuel, nearby, onSelect }) {
  if (fuel.isPending) return <Card title="Fuel" icon={Fuel} className="area-fuel"><Skeleton lines={4} /></Card>;
  const local = fuel.data?.local;
  const items = local?.fuels || [];
  const local100 = cheapestLocal(items, '100LL');
  const localJet = cheapestLocal(items, 'JET_A');
  const byId = new Map((nearby || []).map((item) => [item.icao, item]));
  const nearbyRows = (fuel.data?.nearby || [])
    .filter((item) => item.fuels.length)
    .map((item) => ({ ...item, place: byId.get(item.icao), avgas: item.fuels.find((f) => f.code === '100LL'), jet: item.fuels.find((f) => f.code === 'JET_A') }))
    .sort((a, b) => (a.avgas?.price_per_gal ?? 99) - (b.avgas?.price_per_gal ?? 99));
  const cheapest = nearbyRows[0]?.avgas && (local100 == null || nearbyRows[0].avgas.price_per_gal < local100) ? nearbyRows[0] : null;

  return (
    <Card title="Fuel" icon={Fuel} className="area-fuel" meta={local?.updated ? `Reported ${local.updated}` : null}>
      <div className="fuel-layout">
        <div className="fuel-local">
          {items.length ? (
            <ul className="fuel-list">
              {items.map((item) => (
                <li key={item.id}>
                  <div className="fuel-main">
                    <span className="fuel-type">{item.label}<small>{item.service}</small></span>
                    <span className="fuel-price">{money(item.price_per_gal)}<small>/gal</small></span>
                  </div>
                  <div className="fuel-sub">{item.fbo}{item.guaranteed ? ' · guaranteed' : ''}{item.updated ? ` · ${item.updated}` : ''}</div>
                  <PriceBar item={item} />
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted small">{fuel.isError ? 'Fuel prices unavailable right now.' : local?.status_message || 'No fuel prices found.'}</p>
          )}
        </div>

        <div className="fuel-nearby">
          <div className="control-label">Nearby fuel</div>
          {nearbyRows.length ? (
            <>
              {cheapest ? (
                <p className="fuel-tip">
                  Cheapest 100LL nearby: <strong>{cheapest.icao} {money(cheapest.avgas.price_per_gal)}</strong>
                  {cheapest.avgas.service === 'Self service' ? ' self-serve' : ''}
                  {cheapest.place ? `, ${cheapest.place.distance_nm} NM ${cardinal(cheapest.place.bearing_deg)}` : ''}
                </p>
              ) : null}
              <table className="nearby-fuel">
                <thead><tr><th>Airport</th><th>100LL</th><th>Jet A</th></tr></thead>
                <tbody>
                  {nearbyRows.map((row) => (
                    <tr key={row.icao} onClick={() => onSelect(row.icao)} tabIndex={0} onKeyDown={(event) => event.key === 'Enter' && onSelect(row.icao)}>
                      <td>
                        <span className="mono">{row.icao}</span>
                        {row.place ? <small>{row.place.distance_nm} NM {cardinal(row.place.bearing_deg)}</small> : null}
                      </td>
                      <td><NearbyPrice fuel={row.avgas} local={local100} /></td>
                      <td><NearbyPrice fuel={row.jet} local={localJet} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          ) : (
            <p className="muted small">{fuel.data?.nearby ? 'No posted prices at nearby reporting airports.' : 'Loading nearby prices…'}</p>
          )}
        </div>
      </div>
      <p className="fine-print">
        Prices are self-reported by FBOs to AirNav and can be days old; call ahead. Ranges and averages come from AirNav&apos;s national fuel report
        {fuel.data?.region ? ` (FAA ${fuel.data.region} region)` : ''}. Differences in the nearby table are against the cheapest price here.{' '}
        {local?.source_url ? <LinkOut href={local.source_url}>Prices on AirNav</LinkOut> : null}
      </p>
    </Card>
  );
}
