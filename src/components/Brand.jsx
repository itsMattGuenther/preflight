// SVG version of the Preflight windsock logo so it stays crisp at any size
// and can be reused for the favicon.
const BANDS = 5;
const NARROW_X = 4;
const WIDE_X = 38;
const taper = (x) => ((WIDE_X - x) / (WIDE_X - NARROW_X)) * 5;

function band(index) {
  const x0 = NARROW_X + ((WIDE_X - NARROW_X) / BANDS) * index;
  const x1 = NARROW_X + ((WIDE_X - NARROW_X) / BANDS) * (index + 1);
  const top = (x) => 4 + taper(x);
  const bottom = (x) => 24 - taper(x);
  return `${x0},${top(x0)} ${x1},${top(x1)} ${x1},${bottom(x1)} ${x0},${bottom(x0)}`;
}

export function BrandMark({ size = 32 }) {
  return (
    <svg width={size * (48 / 28)} height={size} viewBox="0 0 48 28" aria-hidden="true" className="brand-mark">
      {Array.from({ length: BANDS }).map((_, index) => (
        <polygon key={index} points={band(index)} fill={index % 2 === 0 ? '#ff4f12' : '#f8fbff'} />
      ))}
      <ellipse cx="39.5" cy="14" rx="2.2" ry="10.4" fill="none" stroke="#f8fbff" strokeWidth="1.6" />
      <line x1="45.5" y1="1" x2="45.5" y2="27" stroke="#f8fbff" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

export function BrandWordmark({ onClick }) {
  const content = (
    <>
      <BrandMark size={22} />
      <span className="brand-word">PREFLIGHT</span>
    </>
  );
  return onClick ? (
    <button type="button" className="brand" onClick={onClick} aria-label="Preflight home">{content}</button>
  ) : (
    <span className="brand">{content}</span>
  );
}
