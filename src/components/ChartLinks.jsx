import { skyVectorUrl } from '../lib/links';

// The charts a pilot briefs before taxi: the FAA airport diagram (or the
// Chart Supplement sketch for fields without one), hot spots and LAHSO.
// Plain text links: they are references, not actions.
export function ChartLinks({ airport, charts }) {
  const data = charts?.data;
  const links = [];
  if (data?.diagram) links.push({ href: data.diagram.url, label: 'Airport diagram' });
  const supplement = data?.chart_supplement?.pages?.[0];
  if (supplement) links.push({ href: supplement, label: data?.diagram ? 'Chart Supplement' : 'Chart Supplement (runway sketch)' });
  if (data?.hot_spots?.[0]) links.push({ href: data.hot_spots[0].url, label: 'Hot spots' });
  if (data?.lahso?.[0]) links.push({ href: data.lahso[0].url, label: 'LAHSO' });
  links.push({ href: skyVectorUrl(airport), label: 'SkyVector' });

  return (
    <nav className="inline-links" aria-label="Charts">
      {links.map((link) => (
        <a key={link.label} href={link.href} target="_blank" rel="noreferrer">{link.label}<span aria-hidden="true"> ↗</span></a>
      ))}
    </nav>
  );
}
