import { Check, Share2, SlidersHorizontal } from 'lucide-react';
import { useState } from 'react';
import { AirportSearch } from './AirportSearch';
import { BrandWordmark } from './Brand';

export function TopBar({ icao, onSelect, onHome, recents, home, onEditMinimums }) {
  const [shared, setShared] = useState(false);

  async function share() {
    const url = `${window.location.origin}/${icao}`;
    try {
      if (navigator.share && window.matchMedia('(pointer: coarse)').matches) {
        await navigator.share({ title: `${icao} on Preflight`, url });
        return;
      }
      await navigator.clipboard.writeText(url);
      setShared(true);
      window.setTimeout(() => setShared(false), 2000);
    } catch {
      // User cancelled the share sheet or clipboard is blocked; nothing to do.
    }
  }

  return (
    <header className="topbar">
      <BrandWordmark onClick={onHome} />
      <div className="topbar-search">
        <AirportSearch onSelect={onSelect} recents={recents} home={home} />
      </div>
      <div className="topbar-actions">
        <button type="button" className="ghost-button" onClick={onEditMinimums} title="Edit your personal minimums">
          <SlidersHorizontal size={16} />
          <span className="hide-sm">My minimums</span>
        </button>
        {icao ? (
          <button type="button" className="ghost-button" onClick={share} title="Copy a link to this airport">
            {shared ? <Check size={16} /> : <Share2 size={16} />}
            <span className="hide-sm">{shared ? 'Link copied' : 'Share'}</span>
          </button>
        ) : null}
      </div>
    </header>
  );
}
