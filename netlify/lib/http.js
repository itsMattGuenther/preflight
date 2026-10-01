// Shared plumbing for every Netlify function: the bearer-token guard, JSON
// responses, upstream fetches with timeouts, and input normalization. Keeping
// this in one place means every function validates input the same way.

const DEFAULT_TIMEOUT_MS = 8000;
const USER_AGENT = 'preflight-dashboard/2.0 (+https://preflightapp.netlify.app)';

export function requireAuth(headers) {
  // The browser sends VITE_API_AUTH_TOKEN and the function compares it to the
  // server-only API_AUTH_TOKEN. This deters casual scanners; it is not a secret
  // because the browser bundle necessarily contains it (see README).
  const expected = process.env.API_AUTH_TOKEN;
  if (!expected) {
    return { ok: false, status: 500, message: 'Missing API_AUTH_TOKEN environment variable' };
  }
  const header = headers.get?.('authorization') || headers.authorization || headers.Authorization;
  const provided = header?.replace(/^Bearer\s+/i, '');
  if (provided !== expected) {
    return { ok: false, status: 401, message: 'Unauthorized' };
  }
  return { ok: true };
}

export function json(body, init = {}) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  });
}

// Wraps a handler with the auth guard and a last-resort error response so an
// unexpected upstream failure returns JSON the UI can show instead of a crash.
export function handler(fn) {
  return async (req, context) => {
    const auth = requireAuth(req.headers);
    if (!auth.ok) return json({ error: auth.message }, { status: auth.status });
    try {
      return await fn(req, context);
    } catch (error) {
      console.error(error);
      return json({ error: error.message || 'Upstream request failed' }, { status: 502 });
    }
  };
}

export async function fetchWithTimeout(url, { timeoutMs = DEFAULT_TIMEOUT_MS, headers = {}, ...options } = {}) {
  return fetch(url, {
    ...options,
    headers: { 'User-Agent': USER_AGENT, ...headers },
    signal: AbortSignal.timeout(timeoutMs),
  });
}

export async function fetchJson(url, options = {}) {
  const res = await fetchWithTimeout(url, { ...options, headers: { Accept: 'application/json', ...(options.headers || {}) } });
  // AviationWeather answers "no data" with 204, which is a valid empty result.
  if (res.status === 204) return [];
  if (!res.ok) throw new Error(`${res.status} from ${new URL(url).host}`);
  const text = await res.text();
  return text ? JSON.parse(text) : [];
}

export async function fetchText(url, options = {}) {
  const res = await fetchWithTimeout(url, options);
  if (!res.ok) throw new Error(`${res.status} from ${new URL(url).host}`);
  return res.text();
}

export function normalizeIcao(value) {
  // Strip anything that is not a letter or digit so user input can never alter
  // the upstream query string. Three-letter all-alpha US identifiers get the K
  // prefix; alphanumeric FAA identifiers such as 7M5 are left alone.
  const input = String(value || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5);
  if (/^[A-Z]{3}$/.test(input)) return `K${input}`;
  return input;
}

export function coordinateParams(url) {
  const lat = Number(url.searchParams.get('lat'));
  const lon = Number(url.searchParams.get('lon'));
  if (!url.searchParams.get('lat') || !url.searchParams.get('lon')) return null;
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return { lat, lon };
}

export function badRequest(message) {
  return json({ error: message }, { status: 400 });
}
