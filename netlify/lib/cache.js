import { getDeployStore, getStore } from '@netlify/blobs';

// Small read-through cache for slow or rate-limited upstream sources (AirNav
// scraping, the national TFR list, winds aloft text, airport reference data).
// Two layers: an in-memory Map that survives while a function instance is warm,
// and Netlify Blobs so every instance shares results. If the upstream call
// fails, a stale cached value is served rather than an error
// ("stale-if-error"), and if Blobs is unavailable everything still works, just
// uncached.

const STORE_NAME = 'preflight-cache';
const memory = new Map();
const MAX_MEMORY_ENTRIES = 300;

function store() {
  // Production shares one site-wide cache. Deploy previews and branch deploys
  // get a deploy-scoped store so preview code never writes into production's
  // cache (Netlify's recommended isolation for global blob stores). Local dev
  // uses the CLI's sandboxed store.
  const context = globalThis.Netlify?.context?.deploy?.context;
  try {
    if (context === 'production' || !context || context === 'dev') return getStore({ name: STORE_NAME });
    return getDeployStore({ name: STORE_NAME });
  } catch {
    return null;
  }
}

async function readBlob(key) {
  try {
    return (await store()?.get(key, { type: 'json' })) ?? null;
  } catch {
    return null;
  }
}

async function writeBlob(key, entry) {
  try {
    await store()?.setJSON(key, entry);
  } catch {
    // Caching is an optimization; a failed write must never fail the request.
  }
}

function remember(key, entry) {
  if (memory.size >= MAX_MEMORY_ENTRIES) memory.delete(memory.keys().next().value);
  memory.set(key, entry);
}

/**
 * Returns { value, cached_utc, stale } for `key`, calling `load()` only when
 * no entry younger than `ttlMs` exists.
 */
export async function cached(key, ttlMs, load) {
  const now = Date.now();
  let entry = memory.get(key) || null;
  if (!entry || now - entry.stored_at > ttlMs) {
    const fromBlob = await readBlob(key);
    if (fromBlob && (!entry || fromBlob.stored_at > entry.stored_at)) entry = fromBlob;
  }
  if (entry && now - entry.stored_at <= ttlMs) {
    remember(key, entry);
    return { value: entry.value, cached_utc: new Date(entry.stored_at).toISOString(), stale: false };
  }

  try {
    const value = await load();
    const fresh = { stored_at: now, value };
    remember(key, fresh);
    await writeBlob(key, fresh);
    return { value, cached_utc: new Date(now).toISOString(), stale: false };
  } catch (error) {
    if (entry) return { value: entry.value, cached_utc: new Date(entry.stored_at).toISOString(), stale: true, error: error.message };
    throw error;
  }
}
