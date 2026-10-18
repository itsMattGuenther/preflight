// Parses the NWS "FD" winds and temperatures aloft text product.
//
//   FT  3000    6000    9000   12000   18000   24000  30000  34000  39000
//   ABR 3506 3408+04 3420+00 3334-04 3060-13 2853-23 285839 275749 266855
//
// Columns are right-aligned under the altitude headings. Each group is DDSS±TT
// where DD is direction in tens of degrees and SS is speed in knots. A
// direction of 51-86 means "add 50 to direction digits / 100 to speed" (for
// winds over 99 kt), 9900 means light and variable, and temperatures above
// 24,000 ft are always negative so the sign is omitted.

export function decodeWindGroup(group, altitudeFt) {
  const text = String(group || '').trim();
  if (!text) return null;
  const match = /^(\d{2})(\d{2})([+-]?\d{2})?$/.exec(text);
  if (!match) return null;
  let dir = Number(match[1]);
  let speed = Number(match[2]);
  let temp = match[3] == null ? null : Number(match[3]);
  if (temp != null && !match[3].startsWith('+') && !match[3].startsWith('-') && altitudeFt > 24000) temp = -temp;

  if (dir === 99 && speed === 0) {
    return { alt_ft: altitudeFt, dir_deg: null, speed_kt: 0, light_variable: true, temp_c: temp };
  }
  if (dir >= 51 && dir <= 86) {
    dir -= 50;
    speed += 100;
  }
  return { alt_ft: altitudeFt, dir_deg: dir === 36 ? 360 : dir * 10, speed_kt: speed, light_variable: false, temp_c: temp };
}

export function parseFdText(text) {
  const lines = String(text || '').split(/\r?\n/);
  const headerIndex = lines.findIndex((line) => /^FT\s+\d/.test(line));
  if (headerIndex < 0) return { stations: {}, valid: null, for_use: null, based_on: null };
  const header = lines[headerIndex];

  // Column i spans from just after the end of heading i-1 to the end of heading i.
  const columns = [];
  const headingPattern = /\d{4,5}/g;
  let heading = headingPattern.exec(header);
  while (heading) {
    columns.push({ alt_ft: Number(heading[0]), end: heading.index + heading[0].length });
    heading = headingPattern.exec(header);
  }

  const stations = {};
  for (const line of lines.slice(headerIndex + 1)) {
    const id = /^([A-Z0-9]{3})\s/.exec(line)?.[1];
    if (!id) continue;
    stations[id] = columns
      .map((column, index) => {
        const start = index === 0 ? 4 : columns[index - 1].end;
        return decodeWindGroup(line.slice(start, column.end), column.alt_ft);
      })
      .filter(Boolean);
  }

  const meta = lines.slice(0, headerIndex).join('\n');
  return {
    stations,
    based_on: /DATA BASED ON (\d{6}Z)/.exec(meta)?.[1] || null,
    valid: /VALID (\d{6}Z)/.exec(meta)?.[1] || null,
    for_use: /FOR USE (\d{4}-\d{4}Z)/.exec(meta)?.[1] || null,
  };
}
