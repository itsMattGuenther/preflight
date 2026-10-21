const TOKEN = import.meta.env.VITE_API_AUTH_TOKEN;

// Every browser-to-API call goes through here so the bearer token and error
// shape stay consistent. The API (worker/) rejects requests without the token.
export async function apiFetch(name, params = {}) {
  const query = new URLSearchParams(Object.entries(params).filter(([, value]) => value !== undefined && value !== null && value !== ''));
  const res = await fetch(`/api/${name}${query.size ? `?${query}` : ''}`, {
    headers: { Authorization: `Bearer ${TOKEN}` },
  });
  if (!res.ok) {
    let body = {};
    try {
      body = await res.json();
    } catch {
      // Non-JSON error body; keep the status code.
    }
    const error = new Error(body.error || `${res.status}`);
    error.status = res.status;
    // A known condition the card explains in its own words, e.g. 'rate_limited'.
    error.code = body.code;
    throw error;
  }
  return res.json();
}
