import { describe, expect, it } from 'vitest';
import { parseWeatherGroup, plainEnglishMetar, weatherHazards } from './metar.js';

const levels = (input) => weatherHazards(input).map((hazard) => `${hazard.level}:${hazard.label}`);

describe('weatherHazards', () => {
  // Regression: the old token regex required whitespace directly before "TS",
  // so intensity prefixes made thunderstorms and freezing rain read as clear.
  it.each([
    ['-TSRA', 'fail:Thunderstorm'],
    ['+TSRA', 'fail:Thunderstorm'],
    ['TSRA', 'fail:Thunderstorm'],
    ['VCTS', 'fail:Thunderstorm in the vicinity'],
    ['-FZRA', 'fail:Freezing precipitation (icing)'],
    ['FZDZ', 'fail:Freezing precipitation (icing)'],
    ['+RA', 'fail:Heavy rain'],
    ['+SHRA', 'fail:Heavy rain'],
    ['-RA', 'caution:Rain'],
    ['-SHRA BR', 'caution:Rain'],
    ['-SN', 'caution:Snow'],
    ['+SN', 'fail:Heavy snow'],
    ['VCSH', 'caution:Showers in the vicinity'],
    ['GR', 'fail:Hail'],
    ['FZFG', 'caution:Freezing fog'],
    ['FG', 'caution:Fog'],
  ])('%s -> %s', (wx, expected) => {
    expect(levels({ wx })).toContain(expected);
  });

  it('treats mist and haze as non-hazards (visibility covers them)', () => {
    expect(levels({ wx: 'BR HZ' })).toEqual([]);
  });

  it('flags CB and TCU cloud layers', () => {
    expect(levels({ wx: '', clouds: [{ cover: 'BKN', base_ft: 4000, type: 'CB' }] })).toContain('caution:Cumulonimbus clouds');
  });

  it('flags lightning in remarks', () => {
    expect(levels({ wx: '', remarks: 'AO2 LTG DSNT NE' })).toContain('caution:Lightning observed');
  });

  it('ignores non-weather tokens', () => {
    expect(parseWeatherGroup('RMK')).toBeNull();
    expect(parseWeatherGroup('AO2')).toBeNull();
  });
});

describe('plainEnglishMetar', () => {
  it('decodes a typical observation', () => {
    const lines = plainEnglishMetar({
      auto: true,
      wind_dir_deg: 130, wind_speed_kt: 8, wind_gust_kt: 15, wind_vrb: false, wind_calm: false,
      visibility_sm: 10, visibility_plus: true,
      wx: '-RA',
      clouds: [{ cover: 'SCT', base_ft: 4300 }, { cover: 'BKN', base_ft: 5500 }],
      ceiling_ft: 5500,
      temp_c: 22, dewpoint_c: 21, altimeter_inhg: 29.9,
    }, { elevationFt: 1296 });
    const text = lines.join(' ');
    expect(text).toContain('Wind from 130° true at 8 knots, gusting to 15 knots.');
    expect(text).toContain('Visibility 10 or more statute miles.');
    expect(text).toContain('Weather: Light rain.');
    expect(text).toContain('broken at 5,500 ft (ceiling)');
    expect(text).toContain('fog or low clouds can form');
    expect(text).toContain('Altimeter setting 29.90');
  });
});
