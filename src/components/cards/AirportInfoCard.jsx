import { Headphones, Info } from 'lucide-react';
import { formatFeet } from '../../lib/format';
import { liveAtcUrl } from '../../lib/links';
import { Card, Skeleton } from '../ui';

// Keep the VHF frequencies a VFR pilot dials (118-137 MHz); drop UHF
// military frequencies and phone numbers that some sources include.
function vhf(value) {
  const matches = String(value || '').match(/\b1(?:1[89]|2\d|3[0-6])\.\d{1,3}\b/g);
  return matches ? [...new Set(matches)].join(' / ') : value;
}

const KIND_ORDER = ['atis', 'awos', 'tower', 'ctaf', 'unicom', 'ground', 'clearance', 'approach', 'other'];
const KIND_LABEL = {
  atis: 'ATIS', awos: 'Weather', tower: 'Tower', ctaf: 'CTAF', unicom: 'UNICOM', ground: 'Ground', clearance: 'Clearance', approach: 'Approach', other: 'Other',
};

function kindLabel(freq) {
  if (freq.kind === 'approach' && /\bDEP/i.test(freq.label) && !/\bAPP/i.test(freq.label)) return 'Departure';
  return KIND_LABEL[freq.kind];
}

function frequencyName(freq) {
  // "CTAF" labeled "CTAF" says nothing twice; show the facility name only
  // when it adds something (e.g. RAZORBACK APPROACH).
  const label = String(freq.label || '').trim();
  return label.toUpperCase() === kindLabel(freq)?.toUpperCase() ? '' : label;
}

export function AirportInfoCard({ airport }) {
  if (!airport) return <Card title="Airport & frequencies" icon={Info} className="area-info"><Skeleton lines={6} /></Card>;
  const frequencies = [...(airport.frequencies || [])].sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind));

  return (
    <Card
      title="Airport & frequencies"
      icon={Info}
      className="area-info"
      action={(
        <a className="button-link" href={liveAtcUrl(airport.icao)} target="_blank" rel="noreferrer">
          <Headphones size={14} aria-hidden="true" /> Listen live
        </a>
      )}
    >
      {frequencies.length ? (
        <dl className="freq-list">
          {frequencies.map((freq) => (
            <div key={`${freq.label}-${freq.value}`} className={`freq freq-${freq.kind}`}>
              <dt>{kindLabel(freq)}{frequencyName(freq) ? <small>{frequencyName(freq)}</small> : null}</dt>
              <dd className="mono">{vhf(freq.value)}</dd>
            </div>
          ))}
        </dl>
      ) : <p className="muted small">No frequencies found. Check the Chart Supplement.</p>}

      <table className="info-table">
        <tbody>
          {(airport.runways || []).map((runway) => (
            <tr key={runway.id}>
              <th>RWY {runway.id}</th>
              <td>{runway.length_ft ? `${formatFeet(runway.length_ft)}${runway.width_ft ? ` × ${runway.width_ft}` : ''}` : '--'}</td>
              <td>{runway.surface}{runway.lighted ? ', lighted' : ''}</td>
            </tr>
          ))}
          <tr><th>Elevation</th><td colSpan={2}>{formatFeet(airport.elevation_ft)} MSL</td></tr>
          <tr><th>Tower</th><td colSpan={2}>{airport.towered === true ? 'Towered (check hours)' : airport.towered === false ? 'Non-towered, self-announce on CTAF' : 'Unknown'}</td></tr>
          {airport.magvar_deg != null ? <tr><th>Variation</th><td colSpan={2}>{Math.abs(airport.magvar_deg)}° {airport.magvar_deg >= 0 ? 'East' : 'West'}</td></tr> : null}
        </tbody>
      </table>

      <p className="footnote">Verify frequencies in the current Chart Supplement. Source: {airport.frequency_source?.label || airport.data_source}.</p>
    </Card>
  );
}
