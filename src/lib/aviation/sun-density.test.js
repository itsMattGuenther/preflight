import { describe, expect, it } from 'vitest';
import { densityAltitude, pressureAltitude } from './density.js';
import { lightingPhase, sunTimes } from './sun.js';

const minutesApart = (a, b) => Math.abs(new Date(a).getTime() - new Date(b).getTime()) / 60000;

describe('sunTimes', () => {
  // Reference values from api.sunrise-sunset.org.
  it('matches reference times for KVBT on 2026-10-01', () => {
    const times = sunTimes(36.3448, -94.2195, new Date('2026-10-01T18:00:00Z'));
    expect(minutesApart(times.sunrise, '2026-10-01T12:11:00Z')).toBeLessThan(2);
    expect(minutesApart(times.sunset, '2026-10-02T00:01:52Z')).toBeLessThan(2);
    expect(minutesApart(times.civil_dawn, '2026-10-01T11:46:39Z')).toBeLessThan(2);
    expect(minutesApart(times.civil_dusk, '2026-10-02T00:26:13Z')).toBeLessThan(2);
  });

  it('matches reference times for KSEA at the summer solstice', () => {
    const times = sunTimes(47.4499, -122.3118, new Date('2026-06-21T20:00:00Z'));
    expect(minutesApart(times.sunrise, '2026-06-21T12:10:20Z')).toBeLessThan(2);
    expect(minutesApart(times.sunset, '2026-06-22T04:11:57Z')).toBeLessThan(2);
  });

  it('returns the same local day late in the evening (after 00Z)', () => {
    const times = sunTimes(36.3448, -94.2195, new Date('2026-10-02T02:00:00Z')); // 9 PM CDT Oct 1
    expect(minutesApart(times.sunset, '2026-10-02T00:01:52Z')).toBeLessThan(2);
  });

  it('classifies day, twilight and night', () => {
    const times = sunTimes(36.3448, -94.2195, new Date('2026-10-01T18:00:00Z'));
    expect(lightingPhase(times, new Date('2026-10-01T18:00:00Z'))).toBe('day');
    expect(lightingPhase(times, new Date('2026-10-02T00:10:00Z'))).toBe('twilight');
    expect(lightingPhase(times, new Date('2026-10-02T01:00:00Z'))).toBe('night');
  });
});

describe('density altitude', () => {
  it('computes pressure altitude from the altimeter setting', () => {
    expect(pressureAltitude(1296, 29.9)).toBe(1316);
  });

  it('is far above field elevation on a hot day', () => {
    // Denver, 33C, 30.10: roughly 9,000 ft density altitude.
    const da = densityAltitude(5434, 33, 30.1);
    expect(da).toBeGreaterThan(8500);
    expect(da).toBeLessThan(9500);
  });

  it('returns null without temperature', () => {
    expect(densityAltitude(1296, null, 29.92)).toBeNull();
  });
});
