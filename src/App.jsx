import { fromZonedTime, formatInTimeZone } from 'date-fns-tz';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { AirportHeader } from './components/AirportHeader';
import { AirportSearch } from './components/AirportSearch';
import { AirportInfoCard } from './components/cards/AirportInfoCard';
import { ConditionsCard } from './components/cards/ConditionsCard';
import { DaylightCard } from './components/cards/DaylightCard';
import { FuelCard } from './components/cards/FuelCard';
import { HazardsCard } from './components/cards/HazardsCard';
import { MinimumsCard } from './components/cards/MinimumsCard';
import { NearbyCard } from './components/cards/NearbyCard';
import { RadarCard } from './components/cards/RadarCard';
import { RunwayCard } from './components/cards/RunwayCard';
import { TafCard } from './components/cards/TafCard';
import { TrafficCard } from './components/cards/TrafficCard';
import { WindsAloftCard } from './components/cards/WindsAloftCard';
import { Footer } from './components/Footer';
import { Landing } from './components/Landing';
import { MinimumsEditor } from './components/MinimumsEditor';
import { TopBar } from './components/TopBar';
import {
  useAdvisories,
  useAirport,
  useAirportImage,
  useCharts,
  useFuel,
  useNotams,
  useRadar,
  useTfrs,
  useTraffic,
  useWeather,
  useWindsAloft,
} from './hooks/useData';
import { useLastSeen } from './hooks/useLastSeen';
import { useMinimums } from './hooks/useMinimums';
import { useNow } from './hooks/useNow';
import { rememberAirport, useAirportRoute } from './hooks/useRoute';
import { evaluateMinimums } from './lib/aviation/minimums';
import { sunTimes } from './lib/aviation/sun';
import { buildBriefing } from './lib/briefing';
import { formatLocal, zoneOrBrowser } from './lib/format';
import { addRecentAirport, getHomeAirport, getRecentAirports, setHomeAirport } from './lib/recentAirports';
import { readJson, writeJson } from './lib/storage';

const HOUR = 3600 * 1000;

function flightWindowRange(flightWindow, now, timeZone) {
  // Translate the departure picker into absolute times. A custom time is in
  // the airport's local time zone; if it has already passed today, it means
  // tomorrow.
  let start = now;
  if (flightWindow.offset === 'custom') {
    if (flightWindow.customTime) {
      const zone = zoneOrBrowser(timeZone);
      const today = formatInTimeZone(now, zone, 'yyyy-MM-dd');
      start = fromZonedTime(`${today}T${flightWindow.customTime}:00`, zone).getTime();
      if (start < now - 30 * 60 * 1000) start += 24 * HOUR;
    } else {
      start = now + HOUR;
    }
  } else {
    start = now + Number(flightWindow.offset || 0) * HOUR;
  }
  return { startMs: start, endMs: start + Number(flightWindow.duration || 1) * HOUR };
}

function NotFound({ icao, onSelect, recents, home }) {
  return (
    <section className="card not-found">
      <h1>Couldn&apos;t find &ldquo;{icao}&rdquo;</h1>
      <p>Try the airport&apos;s identifier (KVBT or VBT), its name, or the city.</p>
      <AirportSearch onSelect={onSelect} recents={recents} home={home} size="large" />
    </section>
  );
}

export default function App() {
  const { icao, selectAirport, goHome } = useAirportRoute();
  const [recents, setRecents] = useState(getRecentAirports);
  const [home, setHome] = useState(getHomeAirport);
  const { minimums, isExample, save, reset } = useMinimums();
  const [editorOpen, setEditorOpen] = useState(false);
  const [flightWindow, setFlightWindow] = useState(() => ({ offset: 0, customTime: '', duration: readJson('preflight:flightDuration', 1.5) }));
  const now = useNow(30000);

  const airportQuery = useAirport(icao);
  const airport = airportQuery.data?.airport;
  const weather = useWeather(icao, airport);
  const advisories = useAdvisories(airport);
  const tfrs = useTfrs(airport);
  const winds = useWindsAloft(airport);
  const notams = useNotams(icao);
  const traffic = useTraffic(airport);
  const fuel = useFuel(icao, airport, airportQuery.data?.nearby);
  const radar = useRadar();
  const image = useAirportImage(airport);
  const charts = useCharts(airport);
  const lastSeen = useLastSeen(icao, weather.data?.metar);

  useEffect(() => {
    if (!airport?.icao) return;
    setRecents(addRecentAirport(airport.icao));
    rememberAirport(icao);
  }, [airport?.icao, icao]);

  const changeWindow = useCallback((next) => {
    setFlightWindow(next);
    writeJson('preflight:flightDuration', next.duration);
  }, []);

  const tz = airport?.timezone;
  const windowRange = useMemo(() => flightWindowRange(flightWindow, now, tz), [flightWindow, now, tz]);
  const sunToday = useMemo(() => (airport ? sunTimes(airport.lat, airport.lon, new Date(now)) : null), [airport, now]);
  const sunForFlight = useMemo(
    () => (airport ? sunTimes(airport.lat, airport.lon, new Date(windowRange.startMs)) : null),
    [airport, windowRange.startMs],
  );

  const evaluation = useMemo(() => {
    if (!airport || weather.isPending) return null;
    return evaluateMinimums({
      minimums,
      airport,
      metar: weather.data?.metar,
      metarSource: weather.data?.metar_source,
      taf: weather.data?.taf,
      sun: sunForFlight,
      // undefined = still loading, null = feed failed.
      tfrs: tfrs.isPending ? undefined : tfrs.isError ? null : tfrs.data?.tfrs,
      tfrsStale: Boolean(tfrs.data?.stale),
      advisories: advisories.isPending ? undefined : advisories.isError ? null : advisories.data,
      notams: notams.data || (notams.isError ? { configured: false } : null),
      window: windowRange,
      now,
      formatTime: (value) => formatLocal(value, tz),
    });
  }, [airport, weather.isPending, weather.data, minimums, sunForFlight, tfrs.data, tfrs.isError, tfrs.isPending, advisories.data, advisories.isError, advisories.isPending, notams.data, notams.isError, windowRange, now, tz]);

  const copyBriefing = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(buildBriefing({
        airport,
        weather: weather.data,
        evaluation,
        windowRange,
        sun: sunForFlight,
        tfrs: tfrs.data?.tfrs,
        url: `${window.location.origin}/${airport.icao}`,
      }));
      return true;
    } catch {
      return false;
    }
  }, [airport, weather.data, evaluation, windowRange, sunForFlight, tfrs.data]);

  const toggleHome = useCallback(() => {
    const next = home === airport?.icao ? null : airport?.icao;
    setHomeAirport(next);
    setHome(next);
  }, [home, airport?.icao]);

  const editor = (
    <MinimumsEditor open={editorOpen} onClose={() => setEditorOpen(false)} minimums={minimums} isExample={isExample} onSave={save} onReset={reset} />
  );

  if (!icao) {
    return (
      <>
        <Landing onSelect={selectAirport} recents={recents} home={home} />
        {editor}
      </>
    );
  }

  const notFound = airportQuery.isError && airportQuery.error?.status === 404;

  return (
    <div className="app">
      <TopBar icao={icao} onSelect={selectAirport} onHome={goHome} recents={recents} home={home} onEditMinimums={() => setEditorOpen(true)} />
      <main className="dashboard">
        {notFound ? (
          <NotFound icao={icao} onSelect={selectAirport} recents={recents} home={home} />
        ) : airportQuery.isError ? (
          <section className="card not-found">
            <h1>Airport data is unavailable</h1>
            <p>{airportQuery.error?.message}. The data source may be down; try again in a minute.</p>
            <button type="button" className="primary-button" onClick={() => airportQuery.refetch()}>Retry</button>
          </section>
        ) : (
          <>
            <AirportHeader airport={airport} image={image.data} sun={sunToday} now={now} isHome={home === airport?.icao} onToggleHome={toggleHome} charts={charts} />
            {/* Rows group related cards: the go/no-go picture first, then the
                forecast, the field itself, traffic, and reference info. */}
            <div className="rows">
              <div className="row row-lead">
                <MinimumsCard
                  evaluation={evaluation}
                  loading={!evaluation}
                  flightWindow={flightWindow}
                  onWindowChange={changeWindow}
                  windowRange={windowRange}
                  minimums={minimums}
                  isExample={isExample}
                  onEdit={() => setEditorOpen(true)}
                  onCopyBriefing={copyBriefing}
                  timeZone={tz}
                />
                <ConditionsCard weather={weather} airport={airport} lastSeen={lastSeen} now={now} />
              </div>
              <TafCard weather={weather} airport={airport} windowRange={windowRange} now={now} />
              <h2 className="section-title">Runway &amp; hazards</h2>
              <div className="row row-three">
                <RunwayCard airport={airport} weather={weather} minimums={minimums} charts={charts} />
                <HazardsCard airport={airport} tfrs={tfrs} advisories={advisories} notams={notams} now={now} />
                <RadarCard airport={airport} radar={radar} />
              </div>
              <h2 className="section-title">Traffic, fuel &amp; frequencies</h2>
              <div className="row row-wide">
                <TrafficCard airport={airport} traffic={traffic} now={now} />
                <NearbyCard nearby={airportQuery.data?.nearby} loading={airportQuery.isPending} onSelect={selectAirport} />
              </div>
              <div className="row row-wide">
                <FuelCard fuel={fuel} nearby={airportQuery.data?.nearby} onSelect={selectAirport} />
                <AirportInfoCard airport={airport} />
              </div>
              <h2 className="section-title">Reference</h2>
              <div className="row row-two">
                <WindsAloftCard winds={winds} />
                <DaylightCard airport={airport} sun={sunToday} now={now} />
              </div>
            </div>
          </>
        )}
      </main>
      <Footer />
      {editor}
    </div>
  );
}
