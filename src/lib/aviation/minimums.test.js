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

  it('uses TAF groups for a later departure and treats a TEMPO breach as a breach', () => {
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
    expect(statusOf(result, 'ceiling')).toBe('fail');
    expect(result.checks.find((item) => item.id === 'ceiling').note).toMatch(/TEMPO/);
  });

  it('softens PROB breaches to caution', () => {
    const taf = {
      valid_from_utc: '2026-10-01T18:00:00Z',
      valid_to_utc: '2026-10-02T18:00:00Z',
      periods: [
        { change: 'BASE', from_utc: '2026-10-01T18:00:00Z', to_utc: '2026-10-02T00:00:00Z', wind_dir_deg: 180, wind_speed_kt: 6, visibility_sm: 6, wx: '', clouds: [{ cover: 'SCT', base_ft: 5000 }], ceiling_ft: null },
        { change: 'PROB', probability: 30, from_utc: '2026-10-01T20:00:00Z', to_utc: '2026-10-01T23:00:00Z', wind_speed_kt: null, visibility_sm: 3, wx: '-TSRA', clouds: [{ cover: 'BKN', base_ft: 2500, type: 'CB' }], ceiling_ft: 2500 },
      ],
    };
    const start = NOW + 2 * HOUR;
    const result = evaluate({ taf, window: { startMs: start, endMs: start + HOUR } });
    expect(statusOf(result, 'ceiling')).toBe('caution');
    expect(statusOf(result, 'weather')).toBe('caution');
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

  // Regressions from the independent review.
  it('is not "within" when wind or visibility is missing', () => {
    expect(evaluate({ metar: metar({ wind_speed_kt: null, wind_dir_deg: null }) }).verdict).toBe('unknown');
    expect(evaluate({ metar: metar({ visibility_sm: null }) }).verdict).toBe('unknown');
  });

  it('treats a METAR without a sky group as an unknown ceiling, not clear', () => {
    const result = evaluate({ metar: metar({ clouds: null, ceiling_ft: null }) });
    expect(statusOf(result, 'ceiling')).toBe('unknown');
    expect(result.verdict).toBe('unknown');
  });

  it('fails when the airport is inside a TFR that starts during the flight', () => {
    const tfr = {
      id: '6/6618', type: 'VIP', title: 'Sterling, VA', distance_nm: 0, inside: true, active: false,
      effective_utc: new Date(NOW + 0.5 * HOUR).toISOString(), expire_utc: new Date(NOW + 8 * HOUR).toISOString(),
    };
    expect(statusOf(evaluate({ tfrs: [tfr] }), 'tfr')).toBe('fail');
    const later = { ...tfr, effective_utc: new Date(NOW + 5 * HOUR).toISOString() };
    expect(statusOf(evaluate({ tfrs: [later] }), 'tfr')).toBe('pass');
  });

  it('flags a nearby TFR with unknown times and a stale TFR feed', () => {
    const unknownTimes = { id: '6/1', type: 'HAZARDS', title: 'Fire', distance_nm: 4, inside: false, active: null };
    expect(statusOf(evaluate({ tfrs: [unknownTimes] }), 'tfr')).toBe('caution');
    expect(statusOf(evaluate({ tfrs: [], tfrsStale: true }), 'tfr')).toBe('unknown');
  });

  it('does not report "none over the field" when an advisory feed failed', () => {
    const result = evaluate({ advisories: { sigmets: [], gairmets: [], cwas: [], unavailable: ['SIGMETs'], stale: [] } });
    expect(statusOf(result, 'advisories')).toBe('unknown');
    expect(result.verdict).toBe('unknown');
  });

  it('uses the worst direction of a variable-direction wind (27015G25KT 220V320)', () => {
    const rwy27 = { ...airport, runways: [{ id: '09/27', paved: true, length_ft: 5000, ends: [{ id: '09', heading_true: 90 }, { id: '27', heading_true: 270 }] }] };
    const result = evaluate({ airport: rwy27, metar: metar({ wind_dir_deg: 270, wind_speed_kt: 15, wind_gust_kt: 25, wind_var_from_deg: 220, wind_var_to_deg: 320 }) });
    expect(statusOf(result, 'crosswind')).toBe('fail');
    expect(result.checks.find((item) => item.id === 'crosswind').value).toMatch(/^19.2 kt/);
  });

  it('flags low-level wind shear in the TAF', () => {
    const taf = {
      valid_from_utc: '2026-10-01T18:00:00Z',
      valid_to_utc: '2026-10-02T18:00:00Z',
      periods: [{ change: 'BASE', from_utc: '2026-10-01T18:00:00Z', to_utc: '2026-10-02T18:00:00Z', wind_dir_deg: 180, wind_speed_kt: 6, visibility_sm: 6, wx: '', clouds: [], ceiling_ft: null, wind_shear: { height_ft: 2000, dir_deg: 240, speed_kt: 35 } }],
    };
    const start = NOW + 2 * HOUR;
    expect(evaluate({ taf, window: { startMs: start, endMs: start + HOUR } }).checks.find((item) => item.id === 'weather').value).toBe('Low-level wind shear forecast');
  });

  it('keeps the old conditions in play during a BECMG transition', () => {
    const taf = {
      valid_from_utc: '2026-10-01T12:00:00Z',
      valid_to_utc: '2026-10-02T12:00:00Z',
      periods: [
        { change: 'BASE', from_utc: '2026-10-01T12:00:00Z', to_utc: '2026-10-01T18:00:00Z', wind_dir_deg: 180, wind_speed_kt: 6, visibility_sm: 2, wx: 'BR', clouds: [{ cover: 'OVC', base_ft: 600 }], ceiling_ft: 600 },
        { change: 'BECMG', from_utc: '2026-10-01T18:00:00Z', becoming_by_utc: '2026-10-01T20:00:00Z', to_utc: '2026-10-02T12:00:00Z', wind_dir_deg: 180, wind_speed_kt: 6, visibility_sm: 6, wx: '', clouds: [{ cover: 'SCT', base_ft: 4000 }], ceiling_ft: null },
      ],
    };
    const start = Date.parse('2026-10-01T18:15:00Z');
    const result = evaluate({ taf, now: Date.parse('2026-10-01T16:00:00Z'), metar: null, window: { startMs: start, endMs: start + HOUR } });
    expect(statusOf(result, 'ceiling')).toBe('fail');
  });

  it('says "includes night" for an early-morning flight before civil twilight', () => {
    const early = Date.parse('2026-10-01T11:00:00Z'); // 6:00 AM CDT; civil dawn ~6:47
    const result = evaluate({ minimums: { ...DEFAULT_MINIMUMS, day_only: false }, now: early, window: { startMs: early, endMs: early + HOUR }, sun: sunTimes(36.3448, -94.2195, new Date(early)) });
    expect(result.checks.find((item) => item.id === 'daylight').value).toBe('Includes night');
  });

  it('fails on an airport closure NOTAM but only cautions on a runway closure', () => {
    const notams = (text) => ({ configured: true, notams: [{ id: '1', text, effective_from_utc: null, effective_to_utc: null }] });
    expect(statusOf(evaluate({ notams: notams('AD AP CLSD') }), 'notams')).toBe('fail');
    const twoRunways = { ...airport, runways: [...airport.runways, { id: '09/27', paved: true, length_ft: 4000, ends: [{ id: '09', heading_true: 90 }, { id: '27', heading_true: 270 }] }] };
    expect(statusOf(evaluate({ airport: twoRunways, notams: notams('RWY 18/36 CLSD') }), 'notams')).toBe('caution');
  });

  it('is not "within" when the TFR or advisory feed fails outright', () => {
    expect(evaluate({ tfrs: null }).verdict).toBe('unknown');
    expect(evaluate({ advisories: null }).verdict).toBe('unknown');
  });

  it('fails when every runway is closed by NOTAM', () => {
    const notams = { configured: true, notams: [{ id: '1', text: 'RWY 18/36 CLSD', effective_from_utc: null, effective_to_utc: null }] };
    expect(statusOf(evaluate({ notams }), 'notams')).toBe('fail');
  });

  it('cautions on a convective SIGMET just outside the field', () => {
    const advisories = { sigmets: [{ kind: 'Convective SIGMET', hazard: 'CONVECTIVE', distance_nm: 8, over_field: false }], gairmets: [], cwas: [], unavailable: [], stale: [] };
    expect(statusOf(evaluate({ advisories }), 'advisories')).toBe('caution');
  });
});
