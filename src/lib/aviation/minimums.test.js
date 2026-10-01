import { describe, expect, it } from 'vitest';
import { DEFAULT_MINIMUMS, evaluateMinimums } from './minimums.js';
import { sunTimes } from './sun.js';

const NOW = Date.parse('2026-10-01T18:00:00Z'); // 1 PM CDT
const HOUR = 3600 * 1000;

const airport = {
  elevation_ft: 1296,
  runways: [
    { id: '18/36', paved: true, length_ft: 5053, ends: [{ id: '18', heading_true: 180 }, { id: '36', heading_true: 360 }] },
  ],
};

const metar = (overrides = {}) => ({
  observed_utc: '2026-10-01T17:53:00Z',
  wind_dir_deg: 180, wind_speed_kt: 6, wind_gust_kt: null, wind_vrb: false, wind_calm: false,
  visibility_sm: 10, visibility_plus: true, wx: '', clouds: [{ cover: 'FEW', base_ft: 6000 }], ceiling_ft: null,
  temp_c: 20, dewpoint_c: 10, altimeter_inhg: 30.0, remarks: '',
  ...overrides,
});

const evaluate = (overrides = {}) => evaluateMinimums({
  minimums: DEFAULT_MINIMUMS,
  airport,
  metar: metar(),
  taf: null,
  sun: sunTimes(36.3448, -94.2195, new Date(NOW)),
  tfrs: [],
  advisories: { sigmets: [], gairmets: [], cwas: [] },
  notams: { configured: false },
  window: { startMs: NOW, endMs: NOW + 1.5 * HOUR },
  now: NOW,
  ...overrides,
});

const statusOf = (result, id) => result.checks.find((item) => item.id === id)?.status;

describe('evaluateMinimums', () => {
  it('is within minimums on a calm clear day', () => {
    const result = evaluate();
    expect(result.verdict).toBe('within');
    expect(result.notChecked.join(' ')).toMatch(/NOTAMs/);
  });

  it('is outside minimums with a light thunderstorm (the old regex said clear)', () => {
    const result = evaluate({ metar: metar({ wx: '-TSRA', clouds: [{ cover: 'BKN', base_ft: 4000, type: 'CB' }], ceiling_ft: 4000 }) });
    expect(result.verdict).toBe('outside');
    expect(statusOf(result, 'weather')).toBe('fail');
  });

  it('counts gusts toward the crosswind limit', () => {
    // 8 kt steady from 240 is 6.9 kt across RWY 18; the 16 kt gust is 13.9.
    const result = evaluate({ metar: metar({ wind_dir_deg: 240, wind_speed_kt: 8, wind_gust_kt: 16 }) });
    expect(statusOf(result, 'crosswind')).toBe('fail');
  });

  it('treats variable wind as a possible direct crosswind', () => {
    const result = evaluate({ metar: metar({ wind_vrb: true, wind_dir_deg: null, wind_speed_kt: 9 }) });
    expect(statusOf(result, 'crosswind')).toBe('fail');
  });

  it('flags ceilings close to the limit as a caution', () => {
    const result = evaluate({ metar: metar({ clouds: [{ cover: 'BKN', base_ft: 3200 }], ceiling_ft: 3200 }) });
    expect(statusOf(result, 'ceiling')).toBe('caution');
    expect(result.verdict).toBe('near');
  });

  it('fails day-only pilots whose flight ends after sunset', () => {
    const late = Date.parse('2026-10-01T23:30:00Z'); // 6:30 PM CDT, sunset ~7:02 PM
    const result = evaluate({ window: { startMs: late, endMs: late + HOUR }, now: late });
    expect(statusOf(result, 'daylight')).toBe('fail');
  });

  it('uses TAF groups for a later departure and softens TEMPO breaches to caution', () => {
    const taf = {
      valid_from_utc: '2026-10-01T18:00:00Z',
      valid_to_utc: '2026-10-02T18:00:00Z',
      periods: [
        { change: 'BASE', from_utc: '2026-10-01T18:00:00Z', to_utc: '2026-10-02T00:00:00Z', wind_dir_deg: 180, wind_speed_kt: 6, visibility_sm: 6, wx: '', clouds: [{ cover: 'SCT', base_ft: 5000 }], ceiling_ft: null },
        { change: 'TEMPO', from_utc: '2026-10-01T20:00:00Z', to_utc: '2026-10-01T23:00:00Z', wind_dir_deg: null, wind_speed_kt: null, visibility_sm: 4, wx: '-SHRA', clouds: [{ cover: 'BKN', base_ft: 2500 }], ceiling_ft: 2500 },
      ],
    };
    const start = NOW + 2 * HOUR;
    const result = evaluate({ taf, window: { startMs: start, endMs: start + HOUR } });
    expect(result.futureOnly).toBe(true);
    expect(statusOf(result, 'ceiling')).toBe('caution');
    expect(result.checks.find((item) => item.id === 'ceiling').note).toMatch(/TEMPO/);
  });

  it('fails when no runway meets paved/length limits', () => {
    const turfOnly = { ...airport, runways: [{ id: '04/22', paved: false, length_ft: 2400, ends: [{ id: '04', heading_true: 40 }, { id: '22', heading_true: 220 }] }] };
    const result = evaluate({ airport: turfOnly });
    expect(statusOf(result, 'runway')).toBe('fail');
  });

  it('fails when the airport is inside an active TFR', () => {
    const result = evaluate({ tfrs: [{ id: '4/9383', type: 'SECURITY', title: 'Washington DC', distance_nm: 0, inside: true, active: true }] });
    expect(statusOf(result, 'tfr')).toBe('fail');
  });

  it('notes when weather comes from a nearby station', () => {
    const result = evaluate({ metarSource: { icao: 'KFSM', distance_nm: 27.8, bearing_deg: 248, is_field: false } });
    expect(result.checks.find((item) => item.id === 'wx_source').value).toMatch(/KFSM/);
  });

  it('is unknown with no weather at all', () => {
    expect(evaluate({ metar: null }).verdict).toBe('unknown');
  });
});
