import { Headphones, Info } from 'lucide-react';
import { formatFeet } from '../../lib/format';
import { airNavUrl, liveAtcUrl, skyVectorUrl } from '../../lib/links';
import { Card, LinkOut, Skeleton } from '../ui';

// Keep the VHF frequencies a VFR pilot dials (118-137 MHz); drop UHF
// military frequencies and phone numbers that some sources include.
function vhf(value) {
  const matches = String(value || '').match(/\b1(?:1[89]|2\d|3[0-6])\.\d{1,3}\b/g);
  return matches ? [...new Set(matches)].join(' / ') : value;
}

const KIND_ORDER = ['atis', 'awos', 'tower', 'ctaf', 'unicom', 'ground', 'clearance', 'approach', 'other'];
const KIND_LABEL = {
  atis: 'ATIS', awos: 'Weather', tower: 'Tower', ctaf: 'CTAF', unicom: 'UNICOM', ground: 'Ground', clearance: 'Clearance', approach: 'Approach / departure', other: 'Other',
};

export function AirportInfoCard({ airport, nearby }) {
  if (!airport) return <Card title="Airport & frequencies" icon={Info} className="area-info"><Skeleton lines={6} /></Card>;
  const frequencies = [...(airport.frequencies || [])].sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind));
  // Approach/departure and center are usually streamed from the nearest
  // towered airport's LiveATC feeds, so offer those too.
  const nearbyFeeds = (nearby || []).filter((item) => item.distance_nm <= 40).slice(0, 4);
  const listen = liveAtcUrl(airport.icao);

  return (
    <Card
      title="Airport & frequencies"
      icon={Info}
      className="area-info"
      action={<a className="listen-button" href={listen} target="_blank" rel="noreferrer"><Headphones size={14} /> Listen live</a>}
    >
      <div className="freq-list">
        {frequencies.length ? frequencies.map((freq) => (
          <a
            key={`${freq.label}-${freq.value}`}
            className={`freq freq-${freq.kind}`}
            href={freq.kind === 'approach' && nearbyFeeds[0] ? liveAtcUrl(nearbyFeeds[0].icao) : listen}
            target="_blank"
            rel="noreferrer"
            title="Find a LiveATC stream for this frequency"
          >
            <span className="freq-kind">{KIND_LABEL[freq.kind]}</span>
            <span className="freq-label">{freq.label}</span>
            <span className="freq-value mono">{vhf(freq.value)}</span>
            <Headphones className="freq-listen" size={13} aria-hidden="true" />
          </a>
        )) : <p className="muted small">No frequencies found. Check the Chart Supplement.</p>}
      </div>
      <div className="listen-row">
        <Headphones size={13} aria-hidden="true" />
        <span>LiveATC streams:</span>
        <a href={listen} target="_blank" rel="noreferrer">{airport.icao}</a>
        {nearbyFeeds.map((item) => (
          <a key={item.icao} href={liveAtcUrl(item.icao)} target="_blank" rel="noreferrer" title={`${item.name}, ${item.distance_nm} NM`}>{item.icao}</a>
        ))}
      </div>
      <p className="fine-print">
        Tap a frequency to find its LiveATC stream (volunteer feeds; not every frequency is covered). Approach is usually streamed from the
        nearest towered field. {airport.frequency_source ? `Frequencies: ${airport.frequency_source.label}. ` : ''}Verify in the current Chart Supplement before use.
      </p>

      <table className="info-table">
        <tbody>
          {(airport.runways || []).map((runway) => (
            <tr key={runway.id}>
              <th>RWY {runway.id}</th>
              <td>{runway.length_ft ? `${formatFeet(runway.length_ft)}${runway.width_ft ? ` × ${runway.width_ft}` : ''}` : '--'}</td>
              <td>{runway.surface}{runway.lighted ? ' · lighted' : ''}</td>
              <td className="mono muted">{runway.ends.map((end) => `${end.id} ${String(end.heading_true).padStart(3, '0')}°T`).join(' / ')}</td>
            </tr>
          ))}
          <tr><th>Elevation</th><td colSpan={3}>{formatFeet(airport.elevation_ft)} MSL</td></tr>
          <tr><th>Tower</th><td colSpan={3}>{airport.towered === true ? 'Towered (check hours in the Chart Supplement)' : airport.towered === false ? 'Non-towered: self-announce on CTAF' : 'Unknown'}</td></tr>
          {airport.magvar_deg != null ? <tr><th>Variation</th><td colSpan={3}>{Math.abs(airport.magvar_deg)}° {airport.magvar_deg >= 0 ? 'East' : 'West'}</td></tr> : null}
          <tr><th>Data</th><td colSpan={3} className="muted">{airport.data_source}</td></tr>
        </tbody>
      </table>

      <div className="link-row">
        <LinkOut href={skyVectorUrl(airport)}>SkyVector</LinkOut>
        <LinkOut href={airNavUrl(airport)}>AirNav</LinkOut>
        <LinkOut href={`https://aviationweather.gov/data/metar/?id=${encodeURIComponent(airport.icao)}&hours=3&taf=on`}>AviationWeather</LinkOut>
        <LinkOut href="https://aviationweather.gov/gfa/">GFA</LinkOut>
      </div>
    </Card>
  );
}
