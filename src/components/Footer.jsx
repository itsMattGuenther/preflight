export function Footer() {
  return (
    <footer className="footer">
      <div className="footer-disclaimer">
        <strong>For situational awareness only.</strong> Preflight is not an FAA-approved weather briefing or a substitute for
        pilot judgment. Get a standard briefing (1800wxbrief.com or your EFB), read every NOTAM, and verify everything against
        official sources before flight. The pilot in command is responsible for the go/no-go decision.
      </div>
      <div className="footer-meta">
        <span>
          Data: <a href="https://aviationweather.gov" target="_blank" rel="noreferrer">NOAA AviationWeather.gov</a>,{' '}
          <a href="https://tfr.faa.gov" target="_blank" rel="noreferrer">FAA TFR</a>,{' '}
          <a href="https://adsb.fi" target="_blank" rel="noreferrer">adsb.fi</a>,{' '}
          <a href="https://www.rainviewer.com" target="_blank" rel="noreferrer">RainViewer</a>,{' '}
          <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a>,{' '}
          <a href="https://www.airnav.com" target="_blank" rel="noreferrer">AirNav</a>,{' '}
          <a href="https://ourairports.com" target="_blank" rel="noreferrer">OurAirports</a>
        </span>
        <span>
          Free and open source · <a href="https://github.com/itsMattGuenther/preflight" target="_blank" rel="noreferrer">GitHub</a> ·{' '}
          <a href="https://github.com/itsMattGuenther/preflight/issues" target="_blank" rel="noreferrer">Feedback &amp; bug reports</a>
        </span>
      </div>
    </footer>
  );
}
