import { Home, Moon, Sun } from 'lucide-react';
import { lightingPhase } from '../lib/aviation/sun';
import { formatDuration, formatFeet, formatLocal, formatLocalWithZone, formatZulu } from '../lib/format';

function primaryFrequency(airport) {
  const freqs = airport?.frequencies || [];
  const pick = (kind) => freqs.find((item) => item.kind === kind);
  const tower = pick('tower');
  if (tower) return { label: 'Tower', value: tower.value };
  const ctaf = pick('ctaf') || pick('unicom');
  return ctaf ? { label: 'CTAF', value: ctaf.value } : null;
}

function longestRunway(airport) {
  return [...(airport?.runways || [])].sort((a, b) => (b.length_ft || 0) - (a.length_ft || 0))[0] || null;
}

export function AirportHeader({ airport, image, sun, now, isHome, onToggleHome }) {
  const tz = airport?.timezone;
  const freq = primaryFrequency(airport);
  const longest = longestRunway(airport);
  const phase = lightingPhase(sun, new Date(now));
  const untilSunset = sun?.sunset ? sun.sunset.getTime() - now : null;
  const credit = image?.credit;

  const chips = [
    airport?.elevation_ft != null ? `Elev ${formatFeet(airport.elevation_ft)}` : null,
    airport?.towered === true ? 'Towered' : airport?.towered === false ? 'Non-towered' : null,
    longest ? `RWY ${longest.id} · ${formatFeet(longest.length_ft)} ${longest.surface?.toLowerCase() || ''}`.trim() : null,
  ].filter(Boolean);

  return (
    <section
      className={`airport-header ${image?.image_url ? 'has-photo' : ''}`}
      style={image?.image_url ? { '--photo': `url("${String(image.image_url).replace(/"/g, '%22')}")` } : undefined}
    >
      <div className="airport-header-main">
        <div className="airport-ident">
          <span className="ident">{airport?.icao || '----'}</span>
          {airport?.faa_id && airport.faa_id !== airport.icao ? <span className="ident-alt">FAA {airport.faa_id}</span> : null}
          <button
            type="button"
            className={`home-toggle ${isHome ? 'active' : ''}`}
            onClick={onToggleHome}
            title={isHome ? 'This is your home airport' : 'Set as home airport'}
            aria-pressed={isHome}
          >
            <Home size={14} />
            <span>{isHome ? 'Home' : 'Set home'}</span>
          </button>
        </div>
        <h1 className="airport-name">{airport?.name || 'Loading airport…'}</h1>
        <p className="airport-place">{[airport?.city, airport?.state].filter(Boolean).join(', ')}</p>
        <p className="airport-facts">
          {freq ? <strong>{freq.label} {freq.value.match(/\b1[1-3]\d\.\d{1,3}\b/)?.[0] || freq.value.split(/\s/)[0]}</strong> : null}
          {chips.map((chip) => <span key={chip}>{chip}</span>)}
        </p>
      </div>

      <div className="airport-clock" aria-label="Current time">
        <div className="clock-zulu">{formatZulu(now, 'HHmm').slice(0, -1)}</div>
        <div className="clock-local">{formatLocalWithZone(now, tz, 'h:mm a')} local</div>
        {phase ? (
          <div className={`clock-phase phase-${phase}`}>
            {phase === 'day' ? <Sun size={13} /> : <Moon size={13} />}
            {phase === 'day' && untilSunset > 0
              ? `Sunset ${formatLocal(sun.sunset, tz)} · ${formatDuration(untilSunset)} left`
              : phase === 'twilight' ? 'Civil twilight · lights on' : `Night · sunrise ${formatLocal(sun.sunrise, tz)}`}
          </div>
        ) : null}
      </div>

      {credit ? (
        <a className="photo-credit" href={credit.file_url || image.article_url} target="_blank" rel="noreferrer">
          Photo: {credit.artist || 'Wikimedia Commons'}{credit.license ? ` · ${credit.license}` : ''}
        </a>
      ) : null}
    </section>
  );
}
