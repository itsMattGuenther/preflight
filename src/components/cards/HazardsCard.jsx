import { ShieldAlert } from 'lucide-react';
import { cardinal, formatFeet, formatLocal, formatZulu, timeAgo } from '../../lib/format';
import { Card, ErrorNote, LinkOut, Skeleton } from '../ui';

function altitudeRange(base, top) {
  if (base == null && top == null) return null;
  const fmt = (value) => (value === 0 ? 'SFC' : value >= 18000 ? `FL${Math.round(value / 100)}` : formatFeet(value));
  return `${base != null ? fmt(base) : 'SFC'}–${top != null ? fmt(top) : '?'}`;
}

function TfrList({ tfrs, tz }) {
  if (tfrs.isLoading) return <Skeleton lines={2} />;
  if (tfrs.isError) return <ErrorNote error={tfrs.error} what="TFRs" onRetry={tfrs.refetch} />;
  const list = (tfrs.data?.tfrs || []).filter((tfr) => tfr.distance_nm <= 50);
  if (!list.length) return <p className="all-clear">No TFRs within 50 NM.</p>;
  return (
    <ul className="hazard-list">
      {list.slice(0, 6).map((tfr) => (
        <li key={tfr.id} className={tfr.inside ? 'severe' : tfr.active && tfr.distance_nm <= 10 ? 'warn' : ''}>
          <div className="hazard-head">
            <span className="hazard-kind">{tfr.type} TFR</span>
            <span className={`pill ${tfr.active ? 'pill-active' : tfr.active === false ? 'pill-later' : ''}`}>
              {tfr.active ? 'Active' : tfr.active === false ? 'Scheduled' : 'Check times'}
            </span>
            <span className="hazard-distance">{tfr.inside ? 'Airport is inside' : `${tfr.distance_nm} NM`}</span>
          </div>
          <div className="hazard-body">{tfr.title}</div>
          <div className="hazard-meta">
            {tfr.effective_utc ? `${formatLocal(tfr.effective_utc, tz, 'MMM d h:mm a')}–${tfr.expire_utc ? formatLocal(tfr.expire_utc, tz, 'MMM d h:mm a') : 'until further notice'}` : null}
            {tfr.top_ft ? ` · surface to ${tfr.top_unlimited ? 'unlimited' : formatFeet(tfr.top_ft)}` : null}
            {' · '}<LinkOut href={tfr.url}>FAA details {tfr.id}</LinkOut>
          </div>
        </li>
      ))}
    </ul>
  );
}

function AdvisoryList({ advisories, tz }) {
  if (advisories.isLoading) return <Skeleton lines={2} />;
  if (advisories.isError) return <ErrorNote error={advisories.error} what="advisories" onRetry={advisories.refetch} />;
  const data = advisories.data || {};
  const items = [...(data.sigmets || []), ...(data.cwas || []), ...(data.gairmets || [])]
    .filter((item) => item.hazard !== 'TURB-HI')
    .sort((a, b) => a.distance_nm - b.distance_nm);
  if (!items.length) return <p className="all-clear">No SIGMETs, AIRMETs or Center Weather Advisories within {data.radius_nm || 25} NM.</p>;
  return (
    <ul className="hazard-list">
      {items.map((item, index) => (
        <li key={`${item.kind}-${item.hazard}-${index}`} className={item.over_field && item.kind?.includes('SIGMET') ? 'severe' : item.over_field ? 'warn' : ''}>
          <div className="hazard-head">
            <span className="hazard-kind">{item.kind}</span>
            <span className="pill">{item.label || item.hazard}</span>
            <span className="hazard-distance">{item.over_field ? 'Over the field' : `${item.distance_nm} NM`}</span>
          </div>
          <div className="hazard-meta">
            {[
              item.severity && typeof item.severity === 'string' ? item.severity : null,
              item.due_to ? `due to ${item.due_to}` : null,
              item.qualifier,
              altitudeRange(item.base_ft, item.top_ft),
              item.valid_to_utc || item.expire_utc ? `until ${formatZulu(item.valid_to_utc || item.expire_utc)} (${formatLocal(item.valid_to_utc || item.expire_utc, tz)})` : null,
            ].filter(Boolean).join(' · ')}
          </div>
          {item.raw ? <details><summary>Full text</summary><pre className="raw-text small">{item.raw.trim()}</pre></details> : null}
        </li>
      ))}
    </ul>
  );
}

function PirepList({ advisories, now }) {
  if (advisories.isLoading) return <Skeleton lines={2} />;
  if (advisories.isError) return null;
  const pireps = advisories.data?.pireps || [];
  if (!pireps.length) return <p className="all-clear muted">No pilot reports below FL180 within {advisories.data?.pirep_radius_nm || 60} NM in the last 3 hours.</p>;
  return (
    <ul className="pirep-list">
      {pireps.slice(0, 6).map((pirep) => (
        <li key={pirep.raw} className={pirep.urgent ? 'severe' : pirep.turbulence?.includes('moderate') || pirep.icing ? 'warn' : ''}>
          <div className="hazard-head">
            <span className="hazard-kind">{pirep.urgent ? 'URGENT ' : ''}{pirep.aircraft || 'Aircraft'}</span>
            <span className="pill">{pirep.altitude_ft ? formatFeet(pirep.altitude_ft) : 'Alt n/a'}</span>
            <span className="hazard-distance">{pirep.distance_nm} NM {cardinal(pirep.bearing_deg)} · {timeAgo(pirep.observed_utc, now)}</span>
          </div>
          <div className="hazard-body">{pirep.summary}</div>
          <details><summary>Raw</summary><pre className="raw-text small">{pirep.raw}</pre></details>
        </li>
      ))}
    </ul>
  );
}

export function HazardsCard({ airport, tfrs, advisories, now }) {
  const tz = airport?.timezone;
  return (
    <Card title="TFRs, advisories & PIREPs" icon={ShieldAlert} className="area-hazards">
      <div className="hazard-section">
        <h3>Temporary flight restrictions</h3>
        <TfrList tfrs={tfrs} tz={tz} />
      </div>
      <div className="hazard-section">
        <h3>SIGMETs, AIRMETs &amp; CWAs</h3>
        <AdvisoryList advisories={advisories} tz={tz} />
      </div>
      <div className="hazard-section">
        <h3>Pilot reports nearby</h3>
        <PirepList advisories={advisories} now={now} />
      </div>
      <p className="fine-print">
        Always confirm TFRs at <a href="https://tfr.faa.gov" target="_blank" rel="noreferrer">tfr.faa.gov</a> and in your briefing. Not shown: Special Use
        Airspace (MOAs, restricted areas) and other airspace on your sectional.
      </p>
    </Card>
  );
}
