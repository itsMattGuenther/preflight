import { describe, expect, it } from 'vitest';
import { describeChanges } from '../hooks/useLastSeen.js';
import { applyOverlay, tafSlots, tafConditionsInWindow } from './aviation/taf.js';
import { buildBriefing } from './briefing.js';
import { formatVisibility, formatWind } from './format.js';

describe('describeChanges', () => {
  const base = {
    station: 'KVBT', flight_category: 'VFR', wind_dir_deg: 180, wind_speed_kt: 6, wind_gust_kt: null, wind_vrb: false,
    visibility_sm: 10, visibility_plus: true, ceiling_ft: null, altimeter_inhg: 30.01, temp_c: 18, wx: '',
  };

  it('reports meaningful changes and flags the worsening ones', () => {
    const changes = describeChanges(base, { ...base, flight_category: 'MVFR', ceiling_ft: 2500, wind_speed_kt: 14, wind_gust_kt: 22, wx: '-RA' });
    const labels = changes.map((change) => change.label);
    expect(labels).toContain('Category VFR → MVFR');
    expect(labels).toContain('Ceiling none → 2,500 ft');
    expect(labels.some((label) => label.startsWith('Wind 180@6 → 180@14G22'))).toBe(true);
    expect(changes.every((change) => change.important || change.label.startsWith('Altimeter'))).toBe(true);
  });

  it('ignores noise', () => {
    expect(describeChanges(base, { ...base, wind_dir_deg: 190, wind_speed_kt: 8, altimeter_inhg: 30.0 })).toEqual([]);
  });
});

describe('tafSlots', () => {
  const taf = {
    valid_from_utc: '2026-10-01T18:00:00Z',
    valid_to_utc: '2026-10-02T18:00:00Z',
    periods: [
      { change: 'BASE', from_utc: '2026-10-01T18:00:00Z', to_utc: '2026-10-01T22:00:00Z', visibility_sm: 6, clouds: [], ceiling_ft: null, flight_category: 'VFR', wx: '' },
      { change: 'TEMPO', from_utc: '2026-10-01T19:00:00Z', to_utc: '2026-10-01T21:00:00Z', visibility_sm: 2, clouds: null, wx: 'TSRA', wind_speed_kt: null },
      { change: 'FM', from_utc: '2026-10-01T22:00:00Z', to_utc: '2026-10-02T18:00:00Z', visibility_sm: 6, clouds: [{ cover: 'OVC', base_ft: 800 }], ceiling_ft: 800, flight_category: 'IFR', wx: '' },
    ],
  };

  it('uses base categories with TEMPO overlays as the worst case', () => {
    const slots = tafSlots(taf, Date.parse('2026-10-01T18:00:00Z'), 6);
    expect(slots.map((slot) => slot.category)).toEqual(['VFR', 'VFR', 'VFR', 'VFR', 'IFR', 'IFR']);
    expect(slots[1].worst).toBe('IFR');
  });

  it('lists every condition set inside a flight window', () => {
    const sets = tafConditionsInWindow(taf, Date.parse('2026-10-01T19:30:00Z'), Date.parse('2026-10-01T22:30:00Z'));
    expect(sets.map((set) => set.kind)).toEqual(['forecast', 'temporary', 'forecast']);
    expect(sets[1].conditions.wx).toBe('TSRA');
    expect(sets[1].conditions.visibility_sm).toBe(2);
  });
});

describe('format', () => {
  it('formats visibility fractions and wind', () => {
    expect(formatVisibility(0.5)).toBe('1/2 SM');
    expect(formatVisibility(1.5)).toBe('1 1/2 SM');
    expect(formatVisibility(10, true)).toBe('10+ SM');
    expect(formatWind({ wind_dir_deg: 90, wind_speed_kt: 12, wind_gust_kt: 20 })).toBe('090° at 12 kt, gusting 20');
    expect(formatWind({ wind_vrb: true, wind_dir_deg: null, wind_speed_kt: 4 })).toBe('Variable at 4 kt');
    expect(formatWind({ wind_dir_deg: 0, wind_speed_kt: 0, wind_calm: true })).toBe('Calm');
  });
});

describe('buildBriefing', () => {
  it('produces a plain-text summary', () => {
    const text = buildBriefing({
      airport: { icao: 'KVBT', name: 'Bentonville Municipal', timezone: 'America/Chicago' },
      weather: { metar: { raw: 'METAR KVBT ...', flight_category: 'VFR', wind_dir_deg: 180, wind_speed_kt: 6 }, metar_source: { is_field: true } },
      evaluation: { verdict: 'within', checks: [{ label: 'Ceiling', status: 'pass', value: 'None', limit: '3,000 ft+' }], notChecked: ['NOTAMs'] },
      windowRange: { startMs: Date.parse('2026-10-01T18:00:00Z'), endMs: Date.parse('2026-10-01T19:30:00Z') },
      url: 'https://preflightapp.netlify.app/KVBT',
    });
    expect(text).toContain('Personal minimums: WITHIN YOUR MINIMUMS');
    expect(text).toContain('[OK] Ceiling: None (limit 3,000 ft+)');
    expect(text).toContain('1:00 PM-2:30 PM CDT (1800Z-1930Z)');
    expect(text).toContain('Not checked: NOTAMs');
  });
});

describe('applyOverlay', () => {
  it('keeps the base ceiling when a TEMPO group changes only visibility', () => {
    const base = { change: 'BASE', visibility_sm: 4, clouds: [{ cover: 'OVC', base_ft: 400 }], ceiling_ft: 400, wx: 'BR', wind_dir_deg: 180, wind_speed_kt: 5 };
    const tempo = { change: 'TEMPO', visibility_sm: 6, visibility_plus: true, clouds: null, wx: '', wind_speed_kt: null };
    expect(applyOverlay(base, tempo).flight_category).toBe('LIFR');
  });
});

