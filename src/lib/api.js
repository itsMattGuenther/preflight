const TOKEN = import.meta.env.VITE_API_AUTH_TOKEN;

// Every browser-to-function call goes through here so the bearer token and
// error shape stay consistent. Functions reject requests without the token.
export async function apiFetch(name, params = {}) {
  const query = new URLSearchParams(Object.entries(params).filter(([, value]) => value !== undefined && value !== null && value !== ''));
  const res = await fetch(`/.netlify/functions/${name}${query.size ? `?${query}` : ''}`, {
    headers: { Authorization: `Bearer ${TOKEN}` },
  });
  if (!res.ok) {
    let message = `${res.status}`;
    try {
      const body = await res.json();
      message = body.error || message;
    } catch {
      // Non-JSON error body; keep the status code.
    }
    const error = new Error(message);
    error.status = res.status;
    throw error;
  }
  return res.json();
}
