import { cached } from '../lib/cache.js';
import { fetchJson, handler, json } from '../lib/http.js';

const RAINVIEWER_URL = 'https://api.rainviewer.com/public/weather-maps.json';

export default handler(async () => {
  const { value: body } = await cached('radar/v1/index', 4 * 60 * 1000, () => fetchJson(RAINVIEWER_URL, { timeoutMs: 6000 }));
  const past = Array.isArray(body.radar?.past) ? body.radar.past : [];
  // The UI animates the last several frames so pilots can see which way cells
  // are moving, not just where they are.
  const frames = past.slice(-6).map((frame) => ({ time_utc: new Date(frame.time * 1000).toISOString(), path: frame.path }));

  return json(
    {
      fetched_utc: new Date().toISOString(),
      source: 'RainViewer',
      source_url: 'https://www.rainviewer.com/',
      host: body.host || 'https://tilecache.rainviewer.com',
      frames,
      radar: frames.at(-1) || null,
    },
    { headers: { 'Cache-Control': 'public, max-age=240' } },
  );
});
