// localStorage that never throws: private browsing, disabled storage, or a
// full quota all degrade to "not remembered" instead of breaking the page.

export function readJson(key, fallback = null) {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

export function writeJson(key, value) {
  try {
    if (value === undefined || value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Ignore: preferences simply will not persist.
  }
}
