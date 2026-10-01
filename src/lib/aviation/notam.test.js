import { describe, expect, it } from 'vitest';
import { classifyNotam } from './notam.js';

describe('classifyNotam', () => {
  it.each([
    ['RWY 18/36 CLSD', 'closure'],
    ['AD AP CLSD TO NON-SKED TRANSIENT GA ACFT', 'closure'],
    // Regressions: substring matches used to make these "critical".
    ['APRON EAST CLSD', 'movement'],
    ['ROAD CONSTRUCTION ADJ RAMP, CLSD TO VEHICLES', 'movement'],
    ['TWY A CLSD', 'movement'],
    ['RWY 18/36 CLSD EXC TAX', 'runway'],
    ['RWY 18 PAPI U/S', 'lighting'],
    ['NAV ILS RWY 18 GS U/S', 'navigation'],
    ['NAV VOR OTS', 'navigation'],
    ['OBST TOWER LGT (ASR 1234) 362000N0941300W UNLGT', 'obstacle'],
    ['OBST CRANE 362000N0941300W 1500FT AGL', 'obstacle'],
    ['AIRSPACE UAS WI AN AREA DEFINED AS 2NM RADIUS', 'airspace'],
    ['SVC FUEL 100LL NOT AVBL', 'services'],
    ['AD AP BCN OUT OF SERVICE', 'lighting'],
  ])('%s -> %s', (text, expected) => {
    expect(classifyNotam({ text })).toBe(expected);
  });
});
