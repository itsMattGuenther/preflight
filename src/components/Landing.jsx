import { CloudSun, Gauge, Map, Radar, ShieldAlert, SlidersHorizontal, Sunset, Wind } from 'lucide-react';
import { AirportSearch } from './AirportSearch';
import { BrandMark } from './Brand';
import { Footer } from './Footer';

const FEATURES = [
  { icon: SlidersHorizontal, title: 'Your minimums, checked', text: 'Set your personal limits (or your solo endorsement) once. Every airport is checked against them, now and for your planned flight window.' },
  { icon: Wind, title: 'Crosswind done right', text: 'True runway headings, gusts included, variable winds treated as worst case, and the best runway that fits your limits.' },
  { icon: CloudSun, title: 'TAF timeline', text: 'See VFR/MVFR/IFR hour by hour, including TEMPO and PROB groups, so you know if it holds until you are back.' },
  { icon: ShieldAlert, title: 'TFRs, AIRMETs & PIREPs', text: 'Restrictions and weather advisories over the field, plus what pilots nearby are actually reporting.' },
  { icon: Radar, title: 'Radar & live traffic', text: 'Animated precipitation radar and nearby ADS-B traffic, including what is in the pattern right now.' },
  { icon: Sunset, title: 'Daylight & night rules', text: 'Sunrise, sunset, civil twilight, and the night-currency window, explained the way the regulations define them.' },
  { icon: Gauge, title: 'Plain-English METAR', text: 'Every observation decoded, with density altitude and temperature/dew point spread called out.' },
  { icon: Map, title: 'Any US airport', text: 'Search by identifier, name or city. Fields without weather reporting use the nearest station, clearly labeled.' },
];

export function Landing({ onSelect, recents, home }) {
  return (
    <div className="landing">
      <main className="landing-main">
        <div className="landing-hero">
          <div className="landing-brand">
            <BrandMark size={34} />
            <span className="brand-word large">PREFLIGHT</span>
          </div>
          <h1>
            The whole preflight picture, <span className="accent">on one screen.</span>
          </h1>
          <p className="landing-lede">
            Free, no-account airport briefing for student pilots, instructors and VFR pilots. Weather, forecast, crosswind,
            TFRs, advisories, traffic and daylight, checked against <em>your</em> personal minimums.
          </p>
          <AirportSearch onSelect={onSelect} recents={recents} home={home} size="large" placeholder="Airport ID, name or city (e.g. KVBT, Oshkosh, 7M5)" />
          <div className="landing-examples">
            <span>Try:</span>
            {['KOSH', 'KSEA', 'KDEN', 'KVBT', '7M5'].map((code) => (
              <button key={code} type="button" className="chip" onClick={() => onSelect(code)}>{code}</button>
            ))}
          </div>
          {recents.length ? (
            <div className="landing-examples">
              <span>Recent:</span>
              {recents.map((code) => (
                <button key={code} type="button" className="chip chip-recent" onClick={() => onSelect(code)}>{code}</button>
              ))}
            </div>
          ) : null}
        </div>

        <section className="landing-features" aria-label="What Preflight shows">
          {FEATURES.map((feature) => (
            <article key={feature.title} className="feature">
              <feature.icon size={20} aria-hidden="true" />
              <h2>{feature.title}</h2>
              <p>{feature.text}</p>
            </article>
          ))}
        </section>

        <p className="landing-note">
          Built by a student pilot who got tired of opening fifteen tabs before every lesson. No ads, no account, no tracking. Your
          minimums and recent airports stay in your browser.
        </p>
      </main>
      <Footer />
    </div>
  );
}
