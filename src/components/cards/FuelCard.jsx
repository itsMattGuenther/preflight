import { Fuel } from 'lucide-react';
import { money } from '../../lib/format';
import { Card, LinkOut, Skeleton } from '../ui';

function delta(item) {
  if (item.market_delta_pct == null) return null;
  const value = item.market_delta_pct;
  const tone = value <= -5 ? 'good' : value >= 5 ? 'bad' : '';
  return <span className={`fuel-delta ${tone}`}>{value > 0 ? '+' : ''}{value.toFixed(1)}% vs national avg {money(item.market_avg)}</span>;
}

export function FuelCard({ fuel }) {
  if (fuel.isPending) return <Card title="Fuel" icon={Fuel} className="area-fuel"><Skeleton lines={3} /></Card>;
  const local = fuel.data?.local;
  const items = local?.fuels || [];
  return (
    <Card title="Fuel" icon={Fuel} className="area-fuel" meta={local?.updated ? `Reported ${local.updated}` : null}>
      {items.length ? (
        <ul className="fuel-list">
          {items.map((item) => (
            <li key={item.id}>
              <div className="fuel-main">
                <span className="fuel-type">{item.label}</span>
                <span className="fuel-price">{money(item.price_per_gal)}</span>
              </div>
              <div className="fuel-sub">
                <span>{item.fbo} · {item.service}{item.guaranteed ? ' · guaranteed' : ''}</span>
                {delta(item)}
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted small">{fuel.isError ? 'Fuel prices unavailable right now.' : local?.status_message || 'No fuel prices found.'}</p>
      )}
      <div className="link-row">
        {local?.source_url ? <LinkOut href={local.source_url}>Prices on AirNav</LinkOut> : null}
      </div>
    </Card>
  );
}
