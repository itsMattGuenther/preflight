// Runway wind components. All headings here are TRUE, matching METAR/TAF wind
// direction. (ATIS/AWOS broadcasts give magnetic wind; the UI notes that.)

const RAD = Math.PI / 180;

function angleBetween(a, b) {
  const diff = Math.abs((((a - b) % 360) + 360) % 360);
  return diff > 180 ? 360 - diff : diff;
}

/**
 * Head/tail and cross components for one runway end.
 * headwind > 0 is a headwind, < 0 a tailwind. `from` says which side the
 * crosswind comes from ('left' | 'right'), as a pilot lined up would feel it.
 */
export function windComponents(windDirTrue, speedKt, runwayHeadingTrue) {
  if (windDirTrue == null || speedKt == null || runwayHeadingTrue == null) {
    return { headwind: null, crosswind: null, from: null };
  }
  const relative = ((((windDirTrue - runwayHeadingTrue) % 360) + 540) % 360) - 180;
  const angle = angleBetween(windDirTrue, runwayHeadingTrue) * RAD;
  const headwind = Math.round(speedKt * Math.cos(angle) * 10) / 10;
  const crosswind = Math.round(Math.abs(speedKt * Math.sin(angle)) * 10) / 10;
  return {
    headwind: Object.is(headwind, -0) ? 0 : headwind,
    crosswind,
    from: crosswind < 0.5 ? null : relative > 0 ? 'right' : 'left',
  };
}

/**
 * Wind on every runway end, best first.
 *
 * - Gusts: components are computed for the gust speed too, and limit checks use
 *   the gust value (the conservative, standard practice).
 * - Variable wind (VRB): direction is unknown, so the worst case applies: the
 *   full speed could be a direct crosswind on any runway.
 * - Ranking: most headwind first; ties (e.g. parallel runways) go to paved,
 *   then longer runways.
 */
export function runwayWinds(runways, wind, { pavedOnly = false, minLengthFt = 0 } = {}) {
  const speed = wind?.wind_speed_kt ?? null;
  const gust = wind?.wind_gust_kt ?? null;
  const variable = Boolean(wind?.wind_vrb) || (wind?.wind_dir_deg == null && speed > 0);
  const calm = wind?.wind_calm || speed === 0;

  const ends = (runways || []).flatMap((runway) => (runway.ends || []).map((end) => {
    const eligible = (!pavedOnly || runway.paved !== false) && (!minLengthFt || !runway.length_ft || runway.length_ft >= minLengthFt);
    let steady;
    let gusting;
    if (calm) {
      steady = { headwind: 0, crosswind: 0, from: null };
      gusting = null;
    } else if (variable) {
      steady = { headwind: null, crosswind: speed, from: null };
      gusting = gust ? { headwind: null, crosswind: gust, from: null } : null;
    } else {
      steady = windComponents(wind?.wind_dir_deg, speed, end.heading_true);
      gusting = gust ? windComponents(wind?.wind_dir_deg, gust, end.heading_true) : null;
    }
    const worstCrosswind = Math.max(steady.crosswind ?? 0, gusting?.crosswind ?? 0);
    const worstTailwind = Math.max(0, -(steady.headwind ?? 0), -(gusting?.headwind ?? 0));
    return {
      runway,
      end,
      id: end.id,
      eligible,
      steady,
      gust: gusting,
      worst_crosswind: steady.crosswind == null ? null : worstCrosswind,
      worst_tailwind: steady.headwind == null ? null : worstTailwind,
    };
  }));

  return ends.sort((a, b) =>
    Number(b.eligible) - Number(a.eligible)
    || (b.steady.headwind ?? 0) - (a.steady.headwind ?? 0)
    || (a.worst_crosswind ?? 0) - (b.worst_crosswind ?? 0)
    || Number(b.runway.paved === true) - Number(a.runway.paved === true)
    || (b.runway.length_ft || 0) - (a.runway.length_ft || 0)
    || String(a.id).localeCompare(String(b.id)));
}

export function bestRunway(runways, wind, options) {
  const ranked = runwayWinds(runways, wind, options);
  return ranked.find((item) => item.eligible) || null;
}

export function magneticFromTrue(trueDeg, magVar) {
  if (trueDeg == null) return null;
  if (magVar == null) return null;
  const value = Math.round((((trueDeg - magVar) % 360) + 360) % 360);
  return value === 0 ? 360 : value;
}
