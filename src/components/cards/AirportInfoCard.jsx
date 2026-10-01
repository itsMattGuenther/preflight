import { Info } from 'lucide-react';
import { formatFeet } from '../../lib/format';
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

export function AirportInfoCard({ airport }) {
  if (!airport) return <Card title="Airport & frequencies" icon={Info} className="area-info"><Skeleton lines={6} /></Card>;
  const faa = airport.faa_id || airport.icao;
  const frequencies = [...(airport.frequencies || [])].sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind));

  return (
    <Card title="Airport & frequencies" icon={Info} className="area-info">
      <div className="freq-list">
        {frequencies.length ? frequencies.map((freq) => (
          <div key={`${freq.label}-${freq.value}`} className={`freq freq-${freq.kind}`}>
            <span className="freq-kind">{KIND_LABEL[freq.kind]}</span>
            <span className="freq-label">{freq.label}</span>
            <span className="freq-value mono">{vhf(freq.value)}</span>
          </div>
        )) : <p className="muted small">No frequencies found. Check the Chart Supplement.</p>}
      </div>
      {airport.frequency_source ? (
        <p className="fine-print">Frequencies: {airport.frequency_source.label}. Verify in the current Chart Supplement before use.</p>
      ) : null}

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
        <LinkOut href={`https://skyvector.com/airport/${encodeURIComponent(faa)}`}>SkyVector (charts & diagram)</LinkOut>
        <LinkOut href={`https://www.airnav.com/airport/${encodeURIComponent(airport.icao)}`}>AirNav</LinkOut>
        <LinkOut href={`https://www.liveatc.net/search/?icao=${encodeURIComponent(airport.icao.toLowerCase())}`}>LiveATC</LinkOut>
        <LinkOut href={`https://aviationweather.gov/data/metar/?id=${encodeURIComponent(airport.icao)}&hours=3&taf=on`}>AviationWeather</LinkOut>
        <LinkOut href="https://aviationweather.gov/gfa/">GFA</LinkOut>
      </div>
    </Card>
  );
}
