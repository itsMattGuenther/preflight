import { afterEach, describe, expect, it, vi } from 'vitest';
import { nearArea } from '../functions/advisories.js';
import { cached } from './cache.js';
import { endsFromIds, parseAwcFrequencies, parseMagVar, runwaysFromAwc, surfaceInfo, titleCaseName } from './airportData.js';
import { distanceToPolygonNm, pointInRing } from './geo.js';
import { decodeWindGroup, parseFdText } from './windsAloft.js';
import { flightCategory, normalizeMetar, normalizeTaf, parseAltimeterInHg } from './wx.js';
import { normalizeIcao } from './http.js';
import { parseDetail } from '../functions/tfr.js';

describe('wx', () => {
  it('reads the altimeter from the raw A group (29.90, not 29.9 via hPa)', () => {
    expect(parseAltimeterInHg('KVBT 011956Z 13008KT 10SM A2990 RMK', 1012.5)).toBe(29.9);
    expect(parseAltimeterInHg('', 1013.25)).toBe(29.92);
  });

  it('normalizes a METAR with variable wind, CB layer and visibility plus', () => {
    const metar = normalizeMetar({
      icaoId: 'KXYZ',
      rawOb: 'METAR KXYZ 011953Z VRB06G15KT 10SM -TSRA BKN040CB 24/18 A2992 RMK AO2 LTG DSNT',
      reportTime: '2026-10-01T20:00:00.000Z',
      wdir: 'VRB', wspd: 6, wgst: 15, visib: '10+', wxString: '-TSRA',
      clouds: [{ cover: 'BKN', base: 4000 }], temp: 24, dewp: 18, altim: 1013.2, fltCat: 'VFR',
    });
    expect(metar.wind_vrb).toBe(true);
    expect(metar.wind_dir_deg).toBeNull();
    expect(metar.visibility_plus).toBe(true);
    expect(metar.clouds[0].type).toBe('CB');
    expect(metar.ceiling_ft).toBe(4000);
    expect(metar.altimeter_inhg).toBe(29.92);
    expect(metar.remarks).toBe('AO2 LTG DSNT');
  });

  it('computes flight categories at the boundaries', () => {
    expect(flightCategory(3100, 6)).toBe('VFR');
    expect(flightCategory(3000, 10)).toBe('MVFR');
    expect(flightCategory(null, 5)).toBe('MVFR');
    expect(flightCategory(900, 10)).toBe('IFR');
    expect(flightCategory(400, 10)).toBe('LIFR');
  });

  it('carries unchanged fields forward into BECMG groups', () => {
    const taf = normalizeTaf({
      icaoId: 'KXYZ', rawTAF: 'TAF ...', validTimeFrom: 1790877600, validTimeTo: 1790964000,
      fcsts: [
        { timeFrom: 1790877600, timeTo: 1790884800, fcstChange: null, wdir: 180, wspd: 10, visib: '6+', clouds: [{ cover: 'SCT', base: 5000 }] },
        { timeFrom: 1790884800, timeTo: 1790892000, fcstChange: 'BECMG', wdir: 240, wspd: 15, wgst: 25, visib: null, clouds: [] },
        { timeFrom: 1790884800, timeTo: 1790892000, fcstChange: 'TEMPO', visib: 3, wxString: '-SHRA', clouds: [{ cover: 'BKN', base: 1500 }] },
      ],
    });
    const [base, becmg, tempo] = taf.periods;
    expect(base.change).toBe('BASE');
    expect(becmg.visibility_sm).toBe(6);
    expect(becmg.wind_gust_kt).toBe(25);
    expect(becmg.clouds).toEqual(base.clouds);
    expect(tempo.change).toBe('TEMPO');
    expect(tempo.wind_speed_kt).toBeNull();
    expect(tempo.flight_category).toBe('MVFR');
  });
});

describe('airportData', () => {
  it('parses magnetic variation', () => {
    expect(parseMagVar('16E')).toBe(16);
    expect(parseMagVar('03W')).toBe(-3);
    expect(parseMagVar(null)).toBeNull();
  });

  it('builds true-heading runway ends from AviationWeather alignment', () => {
    const [runway] = runwaysFromAwc([{ id: '16C/34C', dimension: '9426x150', surface: 'C', alignment: 180 }], 16);
    expect(runway.ends).toEqual([
      { id: '16C', heading_true: 180, heading_mag: 164, heading_source: 'true' },
      { id: '34C', heading_true: 360, heading_mag: 344, heading_source: 'true' },
    ]);
    expect(runway.paved).toBe(true);
  });

  it('falls back to runway number plus variation when alignment is missing', () => {
    expect(endsFromIds(['04', '22'], { magVar: -15 })[0].heading_true).toBe(25);
  });

  it('skips helipads', () => {
    expect(runwaysFromAwc([{ id: 'H1', dimension: '60x60', surface: 'C', alignment: 0 }], 0)).toEqual([]);
  });

  it('decodes surfaces', () => {
    expect(surfaceInfo('T')).toEqual({ label: 'Turf', paved: false });
    expect(surfaceInfo('ASPH-G')).toEqual({ label: 'Asphalt', paved: true });
    expect(surfaceInfo('WATER')).toEqual({ label: 'Water', paved: false });
  });

  it('labels AviationWeather frequency codes', () => {
    expect(parseAwcFrequencies('LCL/P,124.3;D-ATIS,125.6')).toEqual([
      { label: 'TOWER', value: '124.3', kind: 'tower' },
      { label: 'ATIS', value: '125.6', kind: 'atis' },
    ]);
  });

  it('title-cases FAA names', () => {
    expect(titleCaseName('BENTONVILLE MUNI/LOUISE M THADEN FLD')).toBe('Bentonville Municipal/Louise M Thaden Field');
  });
});

describe('windsAloft', () => {
  it('decodes FD groups', () => {
    expect(decodeWindGroup('3408+04', 6000)).toMatchObject({ dir_deg: 340, speed_kt: 8, temp_c: 4 });
    expect(decodeWindGroup('9900', 3000)).toMatchObject({ light_variable: true, speed_kt: 0 });
    expect(decodeWindGroup('7319-45', 30000)).toMatchObject({ dir_deg: 230, speed_kt: 119, temp_c: -45 });
    expect(decodeWindGroup('285839', 30000)).toMatchObject({ dir_deg: 280, speed_kt: 58, temp_c: -39 });
  });

  it('parses fixed-width columns including a blank 3000 ft group', () => {
    const text = [
      'VALID 020000Z   FOR USE 2000-0300Z. TEMPS NEG ABV 24000',
      'FT  3000    6000    9000   12000   18000   24000  30000  34000  39000',
      'ABI      2806+16 2314+09 2429+08 2426-04 2322-15 224530 225739 225750',
      'ABR 3506 3408+04 3420+00 3334-04 3060-13 2853-23 285839 275749 266855',
    ].join('\n');
    const parsed = parseFdText(text);
    expect(parsed.for_use).toBe('2000-0300Z');
    expect(parsed.stations.ABI[0]).toMatchObject({ alt_ft: 6000, dir_deg: 280, speed_kt: 6, temp_c: 16 });
    expect(parsed.stations.ABR[0]).toMatchObject({ alt_ft: 3000, dir_deg: 350, speed_kt: 6, temp_c: null });
  });
});

describe('geo', () => {
  const square = [{ lat: 0, lon: 0 }, { lat: 0, lon: 1 }, { lat: 1, lon: 1 }, { lat: 1, lon: 0 }];
  it('detects points inside polygons', () => {
    expect(pointInRing({ lat: 0.5, lon: 0.5 }, square)).toBe(true);
    expect(distanceToPolygonNm({ lat: 0.5, lon: 0.5 }, square)).toBe(0);
  });
  it('measures distance to the nearest edge', () => {
    expect(distanceToPolygonNm({ lat: 0.5, lon: 1.5 }, square)).toBeCloseTo(30, 0);
  });
});

describe('http', () => {
  it('normalizes identifiers and strips query-string injection', () => {
    expect(normalizeIcao('vbt')).toBe('KVBT');
    expect(normalizeIcao('7m5')).toBe('7M5');
    expect(normalizeIcao('KVBT&format=xml')).toBe('KVBTF');
  });
});

describe('tfr detail', () => {
  it('reads UTC effective times and the highest ceiling', () => {
    const xml = '<dateEffective>2026-10-03T12:00:00</dateEffective><dateExpire>2026-10-03T23:00:00</dateExpire><codeDistVerUpper>ALT</codeDistVerUpper><valDistVerUpper>17999</valDistVerUpper><uomDistVerUpper>FT</uomDistVerUpper>';
    expect(parseDetail(xml)).toEqual({ effective_utc: '2026-10-03T12:00:00.000Z', expire_utc: '2026-10-03T23:00:00.000Z', top_ft: 17999, top_unlimited: false });
  });
});

describe('review regressions (server)', () => {
  afterEach(() => vi.useRealTimers());

  it('treats a METAR with no sky group as unknown sky, not clear', () => {
    const metar = normalizeMetar({
      icaoId: 'KIRK', rawOb: 'SPECI KIRK 011955Z AUTO 35010KT 3SM -RA BR 18/17 A2990 RMK AO2 $',
      reportTime: '2026-10-01T19:55:00.000Z', wdir: 350, wspd: 10, visib: 3, wxString: '-RA BR', clouds: null, fltCat: null, temp: 18, dewp: 17,
    });
    expect(metar.clouds).toBeNull();
    expect(metar.ceiling_ft).toBeNull();
    expect(metar.flight_category).toBeNull();
    expect(metar.clear).toBe(false);
  });

  it('still reads CLR as clear', () => {
    const metar = normalizeMetar({ icaoId: 'KXYZ', rawOb: 'METAR KXYZ 011953Z 18005KT 10SM CLR 20/10 A3001', clouds: [{ cover: 'CLR' }], visib: '10+', wdir: 180, wspd: 5 });
    expect(metar.clear).toBe(true);
    expect(metar.flight_category).toBe('VFR');
  });

  it('serves a stale cached value only within maxStaleMs', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-01T12:00:00Z'));
    const key = `test/${Math.random()}`;
    await cached(key, 1000, async () => 'fresh');
    vi.setSystemTime(new Date('2026-10-01T12:10:00Z'));
    const stale = await cached(key, 1000, async () => { throw new Error('down'); }, { maxStaleMs: 60 * 60 * 1000 });
    expect(stale).toMatchObject({ value: 'fresh', stale: true });
    vi.setSystemTime(new Date('2026-10-01T14:00:00Z'));
    await expect(cached(key, 1000, async () => { throw new Error('down'); }, { maxStaleMs: 60 * 60 * 1000 })).rejects.toThrow('down');
  });

  it('treats line and point advisories as corridors', () => {
    const center = { lat: 36, lon: -94 };
    // A two-point line passing 5 NM north of the field is "over the field".
    expect(nearArea(center, [{ lat: 36.0833, lon: -95 }, { lat: 36.0833, lon: -93 }])).toBe(0);
    // An isolated cell 40 NM away is not.
    expect(nearArea(center, [{ lat: 36.6667, lon: -94 }])).toBeNull();
  });
});
