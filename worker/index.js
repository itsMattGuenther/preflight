// Preflight's API on Cloudflare Workers. The app itself (dist/) is served as
// static files, which are free and unmetered; only /api/* runs this code
// (assets.run_worker_first in wrangler.jsonc). Each function in ./functions
// answers one path: /api/weather runs functions/weather.js, and so on.
import advisories from './functions/advisories.js';
import airportImage from './functions/airport-image.js';
import airport from './functions/airport.js';
import charts from './functions/charts.js';
import fuel from './functions/fuel.js';
import notams from './functions/notams.js';
import radar from './functions/radar.js';
import tfr from './functions/tfr.js';
import traffic from './functions/traffic.js';
import weather from './functions/weather.js';
import windsAloft from './functions/winds-aloft.js';
import { setDatabase } from './lib/cache.js';
import { json } from './lib/http.js';

const FUNCTIONS = {
  advisories,
  'airport-image': airportImage,
  airport,
  charts,
  fuel,
  notams,
  radar,
  tfr,
  traffic,
  weather,
  'winds-aloft': windsAloft,
};

export default {
  async fetch(req, env) {
    const { pathname } = new URL(req.url);
    // Anything outside /api/ is a static file (or the app's index.html).
    if (!pathname.startsWith('/api/')) return env.ASSETS.fetch(req);
    const name = pathname.slice('/api/'.length);
    if (!Object.hasOwn(FUNCTIONS, name)) return json({ error: 'Not found' }, { status: 404 });
    setDatabase(env.DB);
    return FUNCTIONS[name](req, env);
  },
};
