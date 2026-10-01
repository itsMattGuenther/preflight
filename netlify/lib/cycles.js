// FAA chart publication cycles.
//
// - Terminal procedures (d-TPP: airport diagrams, hot spots, approaches)
//   follow the 28-day AIRAC cycle. Cycle IDs are YYNN, numbered from the
//   first cycle that becomes effective in each calendar year (2610 =
//   10th cycle of 2026). Effective at 0901Z.
// - The Chart Supplement (d-CS) is published every 56 days; its files are
//   named by edition date, e.g. 03SEP2026.

const DAY = 24 * 60 * 60 * 1000;
const AIRAC_REFERENCE = Date.UTC(2025, 0, 23, 9, 1); // cycle 2501
const AIRAC_LENGTH = 28 * DAY;
const DCS_REFERENCE = Date.UTC(2026, 8, 3, 9, 1); // edition 03SEP2026
const DCS_LENGTH = 56 * DAY;
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

export function airacCycle(at = Date.now(), offset = 0) {
  const index = Math.floor((at - AIRAC_REFERENCE) / AIRAC_LENGTH) + offset;
  const effective = AIRAC_REFERENCE + index * AIRAC_LENGTH;
  const year = new Date(effective).getUTCFullYear();
  const firstOfYear = AIRAC_REFERENCE + Math.ceil((Date.UTC(year, 0, 1) - AIRAC_REFERENCE) / AIRAC_LENGTH) * AIRAC_LENGTH;
  const number = Math.round((effective - firstOfYear) / AIRAC_LENGTH) + 1;
  return {
    id: `${String(year).slice(2)}${String(number).padStart(2, '0')}`,
    effective_utc: new Date(effective).toISOString(),
    expires_utc: new Date(effective + AIRAC_LENGTH).toISOString(),
  };
}

export function chartSupplementEdition(at = Date.now(), offset = 0) {
  const index = Math.floor((at - DCS_REFERENCE) / DCS_LENGTH) + offset;
  const effective = new Date(DCS_REFERENCE + index * DCS_LENGTH);
  const id = `${String(effective.getUTCDate()).padStart(2, '0')}${MONTHS[effective.getUTCMonth()]}${effective.getUTCFullYear()}`;
  return { id, effective_utc: effective.toISOString(), expires_utc: new Date(effective.getTime() + DCS_LENGTH).toISOString() };
}
