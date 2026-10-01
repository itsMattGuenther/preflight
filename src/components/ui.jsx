import { AlertTriangle, CheckCircle2, CircleHelp, ExternalLink, Info, X, XOctagon } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { CATEGORY_INFO } from '../lib/aviation/flightCategory';

export function Card({ title, icon: Icon, meta, action, children, className = '', id }) {
  return (
    <section className={`card ${className}`} id={id} aria-label={typeof title === 'string' ? title : undefined}>
      <header className="card-head">
        <div className="card-title">
          {Icon ? <Icon size={15} aria-hidden="true" /> : null}
          <h2>{title}</h2>
        </div>
        <div className="card-head-right">
          {meta ? <span className="card-meta">{meta}</span> : null}
          {action}
        </div>
      </header>
      {children}
    </section>
  );
}

export function CategoryBadge({ category, size = 'md', title }) {
  if (!category) return <span className={`cat-badge cat-none ${size}`}>--</span>;
  return (
    <span className={`cat-badge cat-${category.toLowerCase()} ${size}`} title={title || CATEGORY_INFO[category]?.description}>
      {category}
    </span>
  );
}

const STATUS_ICONS = {
  pass: CheckCircle2,
  caution: AlertTriangle,
  fail: XOctagon,
  unknown: CircleHelp,
  info: Info,
};

export function StatusIcon({ status, size = 16 }) {
  const Icon = STATUS_ICONS[status] || CircleHelp;
  return <Icon size={size} className={`status-icon status-${status}`} aria-label={status} />;
}

export function LinkOut({ href, children, className = '' }) {
  return (
    <a className={`link-out ${className}`} href={href} target="_blank" rel="noreferrer">
      {children}
      <ExternalLink size={11} aria-hidden="true" />
    </a>
  );
}

export function Skeleton({ lines = 3 }) {
  return (
    <div className="skeleton" aria-busy="true" aria-label="Loading">
      {Array.from({ length: lines }).map((_, index) => (
        <span key={index} style={{ width: `${92 - index * 14}%` }} />
      ))}
    </div>
  );
}

export function Notice({ tone = 'info', children }) {
  return <div className={`notice notice-${tone}`}>{children}</div>;
}

export function ErrorNote({ error, what = 'this data', onRetry }) {
  return (
    <div className="notice notice-error">
      <span>Couldn&apos;t load {what}{error?.message ? ` (${error.message})` : ''}.</span>
      {onRetry ? <button type="button" className="text-button" onClick={() => onRetry()}>Retry</button> : null}
    </div>
  );
}

export function Modal({ open, onClose, title, children, wide = false }) {
  const panelRef = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const previous = document.activeElement;
    const onKey = (event) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    panelRef.current?.focus();
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
      previous?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className={`modal ${wide ? 'modal-wide' : ''}`} role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} ref={panelRef}>
        <header className="modal-head">
          <h2>{title}</h2>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </header>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}

export function Segmented({ options, value, onChange, label }) {
  return (
    <div className="segmented" role="radiogroup" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={option.value === value}
          className={option.value === value ? 'active' : ''}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
