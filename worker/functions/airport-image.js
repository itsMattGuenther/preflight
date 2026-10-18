import { cached } from '../lib/cache.js';
import { fetchJson, handler, json, normalizeIcao } from '../lib/http.js';

// Optional hero photo for the selected airport, from Wikipedia/Wikimedia
// Commons. Commons images are freely licensed but most licenses require
// attribution, so the photographer and license are returned with the URL and
// shown on the page.
const WIKIPEDIA_API = 'https://en.wikipedia.org/w/api.php';
const TTL_MS = 7 * 24 * 60 * 60 * 1000;

function stripHtml(value) {
  return String(value || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
}

function scorePage(page, icao, name) {
  const title = String(page.title || '').toUpperCase();
  const shortCode = icao.replace(/^K/, '');
  const nameWords = String(name || '').toUpperCase().split(/[^A-Z0-9]+/).filter((word) => word.length > 3).slice(0, 4);
  let score = 0;
  if (/AIRPORT|AIR FIELD|AIRFIELD|AERODROME|AIRPARK/.test(title)) score += 5;
  if (title.includes(icao) || title.includes(shortCode)) score += 3;
  score += nameWords.filter((word) => title.includes(word)).length * 2;
  return score;
}

async function search(term, icao, name) {
  const params = new URLSearchParams({
    action: 'query',
    generator: 'search',
    gsrsearch: term,
    gsrlimit: '6',
    prop: 'pageimages|info',
    inprop: 'url',
    piprop: 'name|thumbnail',
    pithumbsize: '1600',
    format: 'json',
  });
  const body = await fetchJson(`${WIKIPEDIA_API}?${params}`, { timeoutMs: 5000 });
  return Object.values(body.query?.pages || {})
    // Photos only: SVG/PNG page images are usually location maps, logos or
    // FAA diagrams, which make a poor background.
    .filter((page) => page.thumbnail?.source && /\.jpe?g$/i.test(page.pageimage || ''))
    .map((page) => ({ ...page, score: scorePage(page, icao, name) }))
    .filter((page) => page.score >= 5)
    .sort((a, b) => b.score - a.score)[0] || null;
}

async function credit(fileName) {
  const params = new URLSearchParams({
    action: 'query',
    titles: `File:${fileName}`,
    prop: 'imageinfo',
    iiprop: 'extmetadata|url',
    format: 'json',
  });
  const body = await fetchJson(`${WIKIPEDIA_API}?${params}`, { timeoutMs: 5000 });
  const info = Object.values(body.query?.pages || {})[0]?.imageinfo?.[0];
  const meta = info?.extmetadata || {};
  return {
    artist: stripHtml(meta.Artist?.value) || null,
    license: stripHtml(meta.LicenseShortName?.value) || null,
    license_url: meta.LicenseUrl?.value || null,
    file_url: info?.descriptionurl || null,
  };
}

async function findImage(icao, name) {
  const terms = [...new Set([name ? `${name} airport` : '', `${icao} airport`, icao.startsWith('K') ? `${icao.slice(1)} airport` : ''].filter(Boolean))];
  for (const term of terms) {
    const page = await search(term, icao, name).catch(() => null);
    if (page) {
      return {
        image_url: page.thumbnail.source,
        article_url: page.fullurl,
        article_title: page.title,
        credit: await credit(page.pageimage).catch(() => null),
      };
    }
  }
  return { image_url: null };
}

export default handler(async (req) => {
  const url = new URL(req.url);
  const icao = normalizeIcao(url.searchParams.get('icao'));
  const name = String(url.searchParams.get('name') || '').slice(0, 120);
  if (!icao) return json({ image_url: null });
  const { value } = await cached(`image/v2/${icao}`, TTL_MS, () => findImage(icao, name));
  return json(value, { headers: { 'Cache-Control': 'public, max-age=86400' } });
});
