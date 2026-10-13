import { describe, expect, it } from 'vitest';
import { bestRunway, runwayWinds, windComponents } from './wind.js';

const runway = (id, trueHeading, extra = {}) => {
  const [a, b] = id.split('/');
  return {
    id,
    paved: true,
    length_ft: 5000,
    ...extra,
    ends: [
      { id: a, heading_true: trueHeading },
      { id: b, heading_true: (trueHeading + 180) % 360 || 360 },
    ],
  };
};

describe('windComponents', () => {
  it('splits a 45-degree wind evenly', () => {
    expect(windComponents(45, 10, 360)).toEqual({ headwind: 7.1, crosswind: 7.1, from: 'right' });
  });

  it('reports tailwind as negative headwind', () => {
    expect(windComponents(180, 10, 360).headwind).toBe(-10);
  });

  it('identifies a left crosswind', () => {
    expect(windComponents(270, 12, 360).from).toBe('left');
  });
});

describe('runwayWinds', () => {
  it('uses true runway headings (Seattle, 16 degrees east variation)', () => {
    // KSEA 16/34 is aligned 180 true. A 180 true wind is straight down it,
    // where the old magnetic-number math (160) showed a 5 kt crosswind.
    const [best] = runwayWinds([runway('16C/34C', 180)], { wind_dir_deg: 180, wind_speed_kt: 15 });
    expect(best.id).toBe('16C');
    expect(best.steady.crosswind).toBe(0);
  });

  it('includes gusts in the worst-case crosswind', () => {
    const [best] = runwayWinds([runway('18/36', 180)], { wind_dir_deg: 240, wind_speed_kt: 10, wind_gust_kt: 20 });
    expect(best.steady.crosswind).toBe(8.7);
    expect(best.worst_crosswind).toBe(17.3);
  });

  it('assumes the full speed can be crosswind when wind is variable', () => {
    const [best] = runwayWinds([runway('18/36', 180)], { wind_vrb: true, wind_dir_deg: null, wind_speed_kt: 6, wind_gust_kt: 12 });
    expect(best.worst_crosswind).toBe(12);
  });

  it('prefers the paved runway when two are aligned the same (KVBT 17/35 turf vs 18/36)', () => {
    const turf = runway('17/35', 180, { paved: false, length_ft: 2448, surface: 'Turf' });
    const asphalt = runway('18/36', 180, { paved: true, length_ft: 5053 });
    expect(bestRunway([turf, asphalt], { wind_dir_deg: 130, wind_speed_kt: 8 }).id).toBe('18');
  });

  it('excludes runways that fail paved-only / length limits', () => {
    const turf = runway('09/27', 90, { paved: false });
    const asphalt = runway('18/36', 180, { length_ft: 2000 });
    const wind = { wind_dir_deg: 90, wind_speed_kt: 10 };
    expect(bestRunway([turf, asphalt], wind, { pavedOnly: true }).id).toBe('18');
    expect(bestRunway([turf, asphalt], wind, { pavedOnly: true, minLengthFt: 3000 })).toBeNull();
  });

  it('handles calm wind', () => {
    const [best] = runwayWinds([runway('18/36', 180)], { wind_dir_deg: 0, wind_speed_kt: 0, wind_calm: true });
    expect(best.worst_crosswind).toBe(0);
  });
});
