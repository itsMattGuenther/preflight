import { ShieldAlert } from 'lucide-react';
import { groupNotams } from '../../lib/aviation/notam';
import { cardinal, formatFeet, formatLocal, formatZulu, timeAgo } from '../../lib/format';
import { Card, ErrorNote, Skeleton } from '../ui';

// Everything that could ground a flight besides the weather itself: TFRs,
// SIGMETs/AIRMETs, what pilots are reporting, and NOTAMs. Rows are plain
// text with a severity dot; full text sits behind a disclosure.

function altitudeRange(base, top) {
  if (base == null && top == null) return null;
  const fmt = (value) => (value === 0 ? 'SFC' : value >= 18000 ? `FL${Math.round(value / 100)}` : formatFeet(value));
  return `${base != null ? fmt(base) : 'SFC'}–${top != null ? fmt(top) : '?'}`;
}

function faaNotamSearchUrl(airport) {
  return `https://notams.aim.faa.gov/notamSearch/nsapp.html#/results?searchType=0&designatorsForLocation=${encodeURIComponent(airport?.icao || '')}`;
}

function Row({ severity = 'neutral', title, meta, children, raw }) {
  return (
    <li className={`hz-row sev-${severity}`}>
      <span className="sev-dot" aria-hidden="true" />
      <div className="hz-body">
        <div className="hz-title">
          <strong>{title}</strong>
          {meta ? <span>{meta}</span> : null}
        </div>
        {children ? <div className="hz-sub">{children}</div> : null}
        {raw ? <details><summary>Full text</summary><pre className="raw-text small">{raw}</pre></details> : null}
      </div>
    </li>
  );
}

function Clear({ children }) {
  return <p className="all-clear">{children}</p>;
}

function Tfrs({ tfrs, tz }) {
  if (tfrs.isPending) return <Skeleton lines={2} />;
  if (tfrs.isError) return <ErrorNote error={tfrs.error} what="TFRs" onRetry={tfrs.refetch} />;
  const list = (tfrs.data?.tfrs || []).filter((tfr) => tfr.distance_nm <= 50);
  return (
    <>
      {tfrs.data?.stale ? <p className="warn-line">FAA TFR feed not responding; this may be out of date.</p> : null}
      {list.length ? (
        <ul className="hz-list">
          {list.slice(0, 5).map((tfr) => (
            <Row
              key={tfr.id}
              severity={tfr.inside ? 'severe' : tfr.active && tfr.distance_nm <= 10 ? 'warn' : 'neutral'}
              title={`${tfr.type} TFR`}
              meta={`${tfr.inside ? 'Airport inside' : `${tfr.distance_nm} NM`} · ${tfr.active ? 'Active' : tfr.active === false ? 'Scheduled' : 'Times unknown'}`}
            >
              {tfr.title}
              {tfr.effective_utc ? ` · ${formatLocal(tfr.effective_utc, tz, 'MMM d h:mm a')}–${tfr.expire_utc ? formatLocal(tfr.expire_utc, tz, 'MMM d h:mm a') : 'until further notice'}` : ''}
              {tfr.top_ft ? ` · SFC–${tfr.top_unlimited ? 'unlimited' : formatFeet(tfr.top_ft)}` : ''}
              {' '}<a href={tfr.url} target="_blank" rel="noreferrer">Details ↗</a>
            </Row>
          ))}
        </ul>
      ) : <Clear>No TFRs within 50 NM</Clear>}
    </>
  );
}

function Advisories({ advisories, tz }) {
  if (advisories.isPending) return <Skeleton lines={2} />;
  if (advisories.isError) return <ErrorNote error={advisories.error} what="advisories" onRetry={advisories.refetch} />;
  const data = advisories.data || {};
  const items = [...(data.sigmets || []), ...(data.cwas || []), ...(data.gairmets || [])]
    .filter((item) => item.hazard !== 'TURB-HI')
    .sort((a, b) => a.distance_nm - b.distance_nm);
  const missing = [...(data.unavailable || []), ...(data.stale || [])].filter((name) => name !== 'PIREPs');
  return (
    <>
      {missing.length ? <p className="warn-line">{missing.join(', ')} unavailable; check aviationweather.gov.</p> : null}
      {items.length ? (
        <ul className="hz-list">
          {items.map((item, index) => (
            <Row
              key={`${item.kind}-${item.hazard}-${index}`}
              severity={item.over_field && item.kind?.includes('SIGMET') ? 'severe' : item.over_field ? 'warn' : 'neutral'}
              title={item.label || item.hazard}
              meta={`${item.kind} · ${item.over_field ? 'over the field' : `${item.distance_nm} NM`}`}
              raw={item.raw?.trim()}
            >
              {[
                item.due_to ? `Due to ${item.due_to.toLowerCase()}` : item.qualifier,
                altitudeRange(item.base_ft, item.top_ft),
                item.valid_to_utc || item.expire_utc ? `until ${formatZulu(item.valid_to_utc || item.expire_utc)} (${formatLocal(item.valid_to_utc || item.expire_utc, tz)})` : null,
              ].filter(Boolean).join(' · ')}
            </Row>
          ))}
        </ul>
      ) : missing.length ? null : <Clear>No SIGMETs, AIRMETs or CWAs within {data.radius_nm || 25} NM</Clear>}
    </>
  );
}

function Pireps({ advisories, now }) {
  if (advisories.isPending) return <Skeleton lines={2} />;
  if (advisories.isError) return null;
  const pireps = advisories.data?.pireps || [];
  if (!pireps.length) return <Clear>No reports below FL180 within {advisories.data?.pirep_radius_nm || 60} NM in 3 hours</Clear>;
  return (
    <ul className="hz-list">
      {pireps.slice(0, 4).map((pirep) => (
        <Row
          key={pirep.raw}
          severity={pirep.urgent ? 'severe' : pirep.turbulence?.includes('moderate') || pirep.icing ? 'warn' : 'neutral'}
          title={`${pirep.urgent ? 'Urgent · ' : ''}${pirep.summary}`}
          meta={`${pirep.aircraft || 'Aircraft'} · ${pirep.altitude_ft ? formatFeet(pirep.altitude_ft) : 'alt n/a'}`}
          raw={pirep.raw}
        >
          {pirep.distance_nm} NM {cardinal(pirep.bearing_deg)} · {timeAgo(pirep.observed_utc, now)}
        </Row>
      ))}
    </ul>
  );
}

function Notams({ airport, notams, tz }) {
  const search = <a href={faaNotamSearchUrl(airport)} target="_blank" rel="noreferrer">FAA NOTAM Search ↗</a>;
  if (notams.isPending) return <Skeleton lines={1} />;
  if (notams.isError || notams.data?.configured === false) {
    return (
      <p className="warn-line">
        Not loaded here. Read the NOTAMs for {airport?.icao} before every flight: {search}
      </p>
    );
  }
  const groups = groupNotams(notams.data?.notams);
  if (!groups.length) return <Clear>No current NOTAMs returned · {search}</Clear>;
  const closures = groups.find((group) => group.id === 'closure');
  const others = groups.filter((group) => group.id !== 'closure');
  return (
    <>
      {notams.data?.stale ? <p className="warn-line">FAA feed not responding; showing an older copy.</p> : null}
      {closures ? (
        <ul className="hz-list">
          {closures.items.map((notam) => (
            <Row key={notam.id} severity="severe" title="Closure" meta={notam.id}>
              <span className="mono">{notam.text}</span>
            </Row>
          ))}
        </ul>
      ) : null}
      {others.length ? (
        <details className="notam-all">
          <summary>{others.reduce((total, group) => total + group.items.length, 0)} other NOTAMs · {others.map((group) => `${group.items.length} ${group.label.toLowerCase()}`).join(', ')}</summary>
          {others.map((group) => (
            <div key={group.id} className="notam-group">
              <div className="section-label">{group.label}</div>
              <ul>
                {group.items.map((notam) => (
                  <li key={`${notam.id}-${notam.text.slice(0, 24)}`}>
                    <span className="mono">{notam.text}</span>
                    <small>{notam.id}{notam.effective_to_utc ? ` · until ${formatLocal(notam.effective_to_utc, tz, 'MMM d h:mm a')}` : ''}</small>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </details>
      ) : null}
      <p className="footnote">{search}</p>
    </>
  );
}

export function HazardsCard({ airport, tfrs, advisories, notams, now }) {
  const tz = airport?.timezone;
  return (
    <Card title="Hazards & NOTAMs" icon={ShieldAlert} className="area-hazards">
      <section className="hz-section">
        <h3 className="section-label">TFRs</h3>
        <Tfrs tfrs={tfrs} tz={tz} />
      </section>
      <section className="hz-section">
        <h3 className="section-label">SIGMETs, AIRMETs &amp; CWAs</h3>
        <Advisories advisories={advisories} tz={tz} />
      </section>
      <section className="hz-section">
        <h3 className="section-label">Pilot reports</h3>
        <Pireps advisories={advisories} now={now} />
      </section>
      <section className="hz-section">
        <h3 className="section-label">NOTAMs</h3>
        <Notams airport={airport} notams={notams} tz={tz} />
      </section>
    </Card>
  );
}
