import { describe, expect, it } from 'vitest';
import { parseChartSupplementIndex, parseTppMetafile } from '../functions/charts.js';
import { faaRegion } from '../functions/fuel.js';
import { airacCycle, chartSupplementEdition } from './cycles.js';

describe('chart cycles', () => {
  it('numbers AIRAC cycles within the calendar year, effective at 0901Z', () => {
    expect(airacCycle(Date.parse('2026-10-01T09:00:00Z')).id).toBe('2609');
    expect(airacCycle(Date.parse('2026-10-01T09:02:00Z')).id).toBe('2610');
    expect(airacCycle(Date.parse('2026-01-22T12:00:00Z')).id).toBe('2601');
    expect(airacCycle(Date.parse('2025-12-31T12:00:00Z')).id).toBe('2513');
    expect(airacCycle(Date.parse('2026-10-15T00:00:00Z'), -1).id).toBe('2609');
  });

  it('steps Chart Supplement editions every 56 days', () => {
    expect(chartSupplementEdition(Date.parse('2026-10-01T12:00:00Z')).id).toBe('03SEP2026');
    expect(chartSupplementEdition(Date.parse('2026-10-29T12:00:00Z')).id).toBe('29OCT2026');
  });
});

describe('FAA chart indexes', () => {
  it('extracts airport diagrams, hot spots and procedure counts from the d-TPP metafile', () => {
    const xml = `<airport_name ID="BENTONVILLE MUNI" military="N" apt_ident="VBT" icao_ident="KVBT" alnum="6126">
      <record><chartseq>10100</chartseq><chart_code>MIN</chart_code><chart_name>TAKEOFF MINIMUMS</chart_name><useraction></useraction><pdf_name>SC1TO.PDF</pdf_name></record>
      <record><chartseq>70000</chartseq><chart_code>APD</chart_code><chart_name>AIRPORT DIAGRAM</chart_name><useraction></useraction><pdf_name>06126AD.PDF</pdf_name></record>
      <record><chartseq>50750</chartseq><chart_code>IAP</chart_code><chart_name>RNAV (GPS) RWY 18</chart_name><useraction></useraction><pdf_name>06126R18.PDF</pdf_name></record>
      <record><chartseq>10500</chartseq><chart_code>HOT</chart_code><chart_name>HOT SPOT</chart_name><useraction></useraction><pdf_name>SC1HOTSPOT.PDF</pdf_name></record>
    </airport_name>`;
    expect(parseTppMetafile(xml).VBT).toEqual({
      icao: 'KVBT', diagram: ['AIRPORT DIAGRAM', '06126AD.PDF'], hot_spots: [['HOT SPOT', 'SC1HOTSPOT.PDF']], lahso: [], iap: 1, dp: 0, star: 0,
    });
  });

  it('maps Chart Supplement pages by FAA identifier, skipping navaid-only entries', () => {
    const xml = `<airport><aptname></aptname><aptid></aptid><navidname>ADAK</navidname><pages><pdf>ak_34.pdf</pdf></pages></airport>
      <airport><aptname>OZARK/FRANKLIN CO</aptname><aptid>7M5</aptid><navidname></navidname><pages><pdf>sc_76_03SEP2026.pdf</pdf></pages></airport>`;
    expect(parseChartSupplementIndex(xml)).toEqual({ '7M5': ['sc_76_03SEP2026.pdf'] });
  });
});

describe('fuel regions', () => {
  it('maps states to FAA regions used by the AirNav report', () => {
    expect(faaRegion('AR')).toBe('Southwest');
    expect(faaRegion('wa')).toBe('Northwest Mountain');
    expect(faaRegion('ZZ')).toBeNull();
  });
});
