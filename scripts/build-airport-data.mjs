#!/usr/bin/env node
// Builds the two static airport datasets from OurAirports (public domain,
// https://ourairports.com/data/):
//
//   public/data/airports-search.json        name/city search index for the browser
//   netlify/lib/data/airports-fallback.json location + runways for airports that
//                                            AviationWeather.gov does not cover
//
// Frequencies are deliberately NOT taken from OurAirports: they are community
// maintained and can lag FAA changes (e.g. a CTAF change), so frequencies come
// from FAA-sourced data at request time instead.
//
// Run with: npm run build:airports

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BASE = 'https://davidmegginson.github.io/ourairports-data';
const KEEP_TYPES = new Set(['large_airport', 'medium_airport', 'small_airport', 'seaplane_base']);
const TYPE_RANK = { large_airport: 0, medium_airport: 1, small_airport: 2, seaplane_base: 3 };

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (char !== '\r') {
      field += char;
    }
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  const [header, ...body] = rows;
  return body.map((values) => Object.fromEntries(header.map((key, index) => [key, values[index] ?? ''])));
}

async function download(name) {
  const res = await fetch(`${BASE}/${name}.csv`);
  if (!res.ok) throw new Error(`${name}.csv: HTTP ${res.status}`);
  return parseCsv(await res.text());
}

function displayId(airport) {
  // Pilots type the FAA identifier for small fields (7M5) and the ICAO code
  // where one exists (KVBT). OurAirports stores K7M5 as gps_code for the
  // former, which no pilot would type.
  if (airport.icao_code) return airport.icao_code;
  if (/^K[A-Z]{3}$/.test(airport.gps_code)) return airport.gps_code;
  return airport.local_code || airport.gps_code || airport.ident;
}

function num(value, digits = 0) {
  const parsed = Number(value);
  if (!value || !Number.isFinite(parsed)) return null;
  const factor = 10 ** digits;
  return Math.round(parsed * factor) / factor;
}

const [airports, runways] = await Promise.all([download('airports'), download('runways')]);
const us = airports.filter((airport) => airport.iso_country === 'US' && KEEP_TYPES.has(airport.type));
const runwaysByAirport = new Map();
for (const runway of runways) {
  if (runway.closed === '1') continue;
  const list = runwaysByAirport.get(runway.airport_ident) || [];
  list.push(runway);
  runwaysByAirport.set(runway.airport_ident, list);
}

const search = [];
const fallback = {};
for (const airport of us) {
  const id = displayId(airport);
  const local = airport.local_code && airport.local_code !== id ? airport.local_code : '';
  const state = airport.iso_region.replace(/^US-/, '');
  search.push([id, local, airport.name, airport.municipality, state, TYPE_RANK[airport.type]]);
  fallback[id] = {
    n: airport.name,
    c: airport.municipality,
    s: state,
    la: num(airport.latitude_deg, 4),
    lo: num(airport.longitude_deg, 4),
    e: num(airport.elevation_ft),
    r: (runwaysByAirport.get(airport.ident) || []).map((runway) => [
      runway.le_ident,
      runway.he_ident,
      num(runway.length_ft),
      num(runway.width_ft),
      runway.surface,
      num(runway.le_heading_degT),
      runway.lighted === '1' ? 1 : 0,
    ]),
  };
  if (local && !fallback[local]) fallback[local] = { alias: id };
}

search.sort((a, b) => a[5] - b[5] || a[0].localeCompare(b[0]));

await mkdir(resolve(ROOT, 'public/data'), { recursive: true });
await mkdir(resolve(ROOT, 'netlify/lib/data'), { recursive: true });
await writeFile(resolve(ROOT, 'public/data/airports-search.json'), JSON.stringify(search));
await writeFile(resolve(ROOT, 'netlify/lib/data/airports-fallback.json'), JSON.stringify(fallback));
console.log(`Wrote ${search.length} airports (${new Date().toISOString().slice(0, 10)}).`);
