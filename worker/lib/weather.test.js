import { afterEach, describe, expect, it, vi } from 'vitest';
import advisories from '../functions/advisories.js';
import weather from '../functions/weather.js';
import { bboxParam } from './geo.js';

const env = { API_AUTH_TOKEN: 'test-token' };
// Bentonville (KVBT): a METAR but no TAF, with Rogers (KROG) 5 NM away.
const KVBT = { lat: 36.345, lon: -94.219 };

// Station lists are cached per area, so each test asks from its own spot.
function weatherAt(lat, lon) {
  return request(`weather?icao=KVBT&lat=${lat}&lon=${lon}`);
}

function request(path) {
  return new Request(`https://preflight.test/api/${path}`, { headers: { Authorization: 'Bearer test-token' } });
}

function respond(status, body) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

const metar = {
  icaoId: 'KVBT', reportTime: '2026-11-01T15:00:00.000Z', rawOb: 'METAR KVBT 011456Z AUTO 13004KT 5SM BR OVC003 17/17 A3022',
  wdir: 130, wspd: 4, visib: 5, wxString: 'BR', clouds: [{ cover: 'OVC', base: 300 }], temp: 16.7, dewp: 16.7, altim: 1023.5,
};
const taf = {
  icaoId: 'KROG', name: 'Rogers Muni/Carter Fld', rawTAF: 'TAF KROG 011400Z 0114/0212 09005KT 3SM BR OVC003',
  issueTime: '2026-11-01T14:00:00.000Z', validTimeFrom: 1793541600, validTimeTo: 1793620800,
  fcsts: [{ timeFrom: 1793541600, timeTo: 1793620800, fcstChange: null, wdir: 90, wspd: 5, visib: 3, wxString: 'BR', clouds: [{ cover: 'OVC', base: 300 }] }],
};
const stations = [
  { icaoId: 'KVBT', site: 'Bentonville Muni', lat: 36.3456, lon: -94.2194, siteType: ['METAR'] },
  { icaoId: 'KROG', site: 'Rogers Muni/Carter Fld', lat: 36.3749, lon: -94.1078, siteType: ['METAR', 'TAF'] },
];

// Stands in for aviationweather.gov, which answers 400 to a bbox with long
// decimals (35.57833333333333) but 200 to a rounded one.
function aviationWeather(overrides = {}) {
  const urls = [];
  const fetch = vi.fn(async (url) => {
    urls.push(String(url));
    const { pathname, searchParams } = new URL(url);
    const product = pathname.split('/').pop();
    if (overrides[product]) return overrides[product](searchParams);
    const bbox = searchParams.get('bbox');
    if (bbox && bbox.split(',').some((value) => (value.split('.')[1] || '').length > 6)) {
      return respond(400, { status: 'error', error: 'Must specify station IDs or bounding box, zoom, and density' });
    }
    if (product === 'metar') return respond(200, searchParams.get('ids') === 'KVBT' ? [metar] : []);
    if (product === 'taf') return respond(200, searchParams.get('ids') === 'KROG' ? [taf] : []);
    if (product === 'stationinfo') return respond(200, stations);
    return respond(200, []);
  });
  vi.stubGlobal('fetch', fetch);
  return urls;
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('weather', () => {
  it('rounds bounding boxes to 4 decimal places', () => {
    expect(bboxParam({ minLat: 35.57833333333333, minLon: -94.98566666666666, maxLat: 37.111666666666665, maxLon: -93.45233333333333 }))
      .toBe('35.5783,-94.9857,37.1117,-93.4523');
  });

  it("uses the nearest station's TAF for a field without one", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-01T15:39:00Z'));
    const urls = aviationWeather();
    const body = await (await weather(weatherAt(36.3456, -94.2194), env)).json();
    expect(urls.find((url) => url.includes('stationinfo'))).toMatch(/bbox=35\.5833,-94\.9867,37\.1167,-93\.4533&/);
    expect(body.metar_source).toMatchObject({ icao: 'KVBT', is_field: true });
    expect(body.taf_source).toMatchObject({ icao: 'KROG', distance_nm: 5.7, is_field: false, reason: 'no_reporting' });
    expect(body.unavailable).toEqual([]);
  });

  it('looks up the stations near an airport once, not on every request', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-01T15:39:00Z'));
    const urls = aviationWeather();
    await weather(weatherAt(36.2, -94.1), env);
    const body = await (await weather(weatherAt(36.2001, -94.1001), env)).json();
    expect(urls.filter((url) => url.includes('stationinfo'))).toHaveLength(1);
    expect(body.taf_source).toMatchObject({ icao: 'KROG' });
  });

  it('says the TAF is unavailable, not missing, when the station lookup fails', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-01T15:39:00Z'));
    aviationWeather({ stationinfo: () => respond(400, { status: 'error' }) });
    const body = await (await weather(weatherAt(36.5, -94.5), env)).json();
    expect(body.metar_source).toMatchObject({ icao: 'KVBT' });
    expect(body.taf).toBeNull();
    expect(body.unavailable).toEqual(['TAF']);
  });

  it('reports no TAF, without an error, when no station nearby has one', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-01T15:39:00Z'));
    aviationWeather({ stationinfo: () => respond(200, [stations[0]]) });
    const body = await (await weather(weatherAt(36.6, -94.6), env)).json();
    expect(body.taf).toBeNull();
    expect(body.unavailable).toEqual([]);
  });

  it('lists PIREPs as unavailable when they fail, and asks with a rounded box', async () => {
    const urls = aviationWeather({ pirep: () => respond(500, {}) });
    const body = await (await advisories(request(`advisories?lat=${KVBT.lat}&lon=${KVBT.lon}`), env)).json();
    expect(urls.find((url) => url.includes('/pirep?'))).toMatch(/bbox=35\.3450,-95\.4605,37\.3450,-92\.9775&/);
    expect(body.unavailable).toEqual(['PIREPs']);
  });
});
