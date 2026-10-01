import { FileText, Headphones, Map, TriangleAlert } from 'lucide-react';
import { liveAtcUrl, skyVectorUrl } from '../lib/links';

// The charts a pilot briefs before taxi: the FAA airport diagram (or the
// Chart Supplement sketch for fields without one), hot spots and LAHSO.
export function ChartLinks({ airport, charts, compact = false, showListen = false }) {
  const data = charts?.data;
  const supplement = data?.chart_supplement?.pages?.[0];
  const links = [];
  if (data?.diagram) links.push({ href: data.diagram.url, icon: Map, label: 'Airport diagram', sub: 'FAA PDF', primary: true });
  if (supplement) links.push({ href: supplement, icon: FileText, label: 'Chart Supplement', sub: data.diagram ? 'FAA PDF' : 'FAA PDF · runway sketch', primary: !data.diagram });
  (data?.hot_spots || []).slice(0, 1).forEach((item) => links.push({ href: item.url, icon: TriangleAlert, label: 'Hot spots', sub: 'FAA PDF' }));
  (data?.lahso || []).slice(0, 1).forEach((item) => links.push({ href: item.url, icon: TriangleAlert, label: 'LAHSO', sub: 'FAA PDF' }));
  if (showListen) links.push({ href: liveAtcUrl(airport?.icao), icon: Headphones, label: 'LiveATC', sub: 'listen live' });
  links.push({ href: skyVectorUrl(airport), icon: Map, label: 'SkyVector', sub: 'sectional & procedures' });

  return (
    <div className={`chart-links ${compact ? 'compact' : ''}`}>
      {links.map((link) => (
        <a key={link.label} className={`chart-link ${link.primary ? 'primary' : ''}`} href={link.href} target="_blank" rel="noreferrer">
          <link.icon size={compact ? 13 : 15} aria-hidden="true" />
          <span>
            {link.label}
            {compact ? null : <small>{link.sub}</small>}
          </span>
        </a>
      ))}
      {charts?.isPending && !compact ? <span className="muted small">Finding FAA charts…</span> : null}
    </div>
  );
}
