import { FileWarning } from 'lucide-react';
import { groupNotams } from '../../lib/aviation/notam';
import { formatLocal, timeAgo } from '../../lib/format';
import { Card, ErrorNote, LinkOut, Notice, Skeleton } from '../ui';

function faaSearchUrl(airport) {
  return `https://notams.aim.faa.gov/notamSearch/nsapp.html#/results?searchType=0&designatorsForLocation=${encodeURIComponent(airport?.icao || '')}`;
}

export function NotamCard({ airport, notams, now }) {
  const tz = airport?.timezone;
  const links = (
    <div className="link-row">
      <LinkOut href={faaSearchUrl(airport)}>FAA NOTAM Search</LinkOut>
      <LinkOut href="https://www.1800wxbrief.com">1800wxbrief</LinkOut>
    </div>
  );

  let body;
  if (notams.isPending) body = <Skeleton lines={3} />;
  else if (notams.isError) body = <><ErrorNote error={notams.error} what="NOTAMs" onRetry={notams.refetch} />{links}</>;
  else if (notams.data?.configured === false) {
    body = (
      <>
        <Notice tone="warning">
          <strong>NOTAMs are not loaded in Preflight.</strong> Read the current NOTAMs for {airport?.icao} before every flight. Runway
          closures, inoperative lights and TFRs all show up there.
        </Notice>
        {links}
      </>
    );
  } else {
    const groups = groupNotams(notams.data?.notams);
    body = (
      <>
        {notams.data?.stale ? <Notice tone="warning">FAA feed unavailable; showing NOTAMs from {timeAgo(notams.data.fetched_utc, now)}.</Notice> : null}
        {!groups.length ? <p className="all-clear">No current NOTAMs returned for {airport?.icao}. Double-check with the FAA search.</p> : null}
        {groups.map((group) => (
          <div key={group.id} className={`notam-group notam-${group.id}`}>
            <h3>{group.label} <span className="count">{group.items.length}</span></h3>
            <ul>
              {group.items.slice(0, group.id === 'closure' ? 10 : 4).map((notam) => (
                <li key={`${notam.id}-${notam.text.slice(0, 20)}`}>
                  <span className="notam-text">{notam.text}</span>
                  <span className="notam-meta">
                    {notam.id}
                    {notam.effective_to_utc ? ` · until ${formatLocal(notam.effective_to_utc, tz, 'MMM d h:mm a')}` : notam.permanent ? ' · permanent' : ''}
                  </span>
                </li>
              ))}
              {group.items.length > (group.id === 'closure' ? 10 : 4) ? <li className="muted small">+ {group.items.length - 4} more in the FAA search</li> : null}
            </ul>
          </div>
        ))}
        {links}
      </>
    );
  }

  return (
    <Card title="NOTAMs" icon={FileWarning} className="area-notams" meta={notams.data?.configured ? `${notams.data.notams.length} current` : null}>
      {body}
    </Card>
  );
}
