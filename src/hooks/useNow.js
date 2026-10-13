import { useEffect, useState } from 'react';

// Re-renders on an interval so clocks, "x min ago" labels and daylight
// countdowns stay current without refetching data.
export function useNow(intervalMs = 30000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);
  return now;
}
