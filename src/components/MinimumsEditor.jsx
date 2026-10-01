import { useEffect, useState } from 'react';
import { MINIMUM_FIELDS, PRESETS } from '../lib/aviation/minimums';
import { Modal } from './ui';

export function MinimumsEditor({ open, onClose, minimums, isExample, onSave, onReset }) {
  const [draft, setDraft] = useState(minimums);
  // Start from the saved values each time the editor opens. Depending only on
  // `open` means background refreshes never wipe edits in progress.
  useEffect(() => {
    if (open) setDraft(minimums);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = (key, value) => setDraft((current) => ({ ...current, [key]: value, preset: 'custom' }));
  const applyPreset = (key) => setDraft({ preset: key, ...PRESETS[key].values });

  function submit(event) {
    event.preventDefault();
    const clean = { ...draft };
    for (const field of MINIMUM_FIELDS) {
      const value = Number(clean[field.key]);
      clean[field.key] = Number.isFinite(value) ? Math.min(field.max, Math.max(field.min, value)) : PRESETS.student.values[field.key];
    }
    clean.margin_pct = Math.min(50, Math.max(0, Number(clean.margin_pct) || 0));
    onSave(clean);
    onClose();
  }

  return (
    <Modal open={open} onClose={onClose} title="Your personal minimums" wide>
      <form className="minimums-form" onSubmit={submit}>
        <p className="form-intro">
          Personal minimums are the limits <em>you</em> fly within, usually stricter than the regulations. Student pilots: use the
          limitations your instructor wrote in your solo endorsement. Everything here is saved only in this browser.
        </p>

        <div className="preset-row" role="group" aria-label="Start from a preset">
          {Object.entries(PRESETS).map(([key, preset]) => (
            <button
              key={key}
              type="button"
              className={`preset ${draft.preset === key ? 'active' : ''}`}
              onClick={() => applyPreset(key)}
            >
              <strong>{preset.label}</strong>
              <span>{preset.description}</span>
            </button>
          ))}
        </div>

        <div className="field-grid">
          {MINIMUM_FIELDS.map((field) => (
            <label key={field.key} className="field">
              <span className="field-label">
                {field.label}
                {field.hint ? <small>{field.hint}</small> : null}
              </span>
              <span className="field-input">
                <input
                  type="number"
                  inputMode="decimal"
                  min={field.min}
                  max={field.max}
                  step={field.step}
                  value={draft[field.key] ?? ''}
                  onChange={(event) => set(field.key, event.target.value)}
                />
                <span className="unit">{field.unit}</span>
              </span>
            </label>
          ))}
          <label className="field">
            <span className="field-label">
              Warn when within
              <small>Shows &ldquo;close to your limits&rdquo; before a limit is reached</small>
            </span>
            <span className="field-input">
              <input type="number" min={0} max={50} step={5} value={draft.margin_pct ?? 15} onChange={(event) => set('margin_pct', event.target.value)} />
              <span className="unit">%</span>
            </span>
          </label>
        </div>

        <div className="toggle-row">
          <label className="toggle">
            <input type="checkbox" checked={Boolean(draft.paved_only)} onChange={(event) => set('paved_only', event.target.checked)} />
            <span>Paved runways only</span>
          </label>
          <label className="toggle">
            <input type="checkbox" checked={Boolean(draft.day_only)} onChange={(event) => set('day_only', event.target.checked)} />
            <span>Daytime only (sunrise to sunset)</span>
          </label>
        </div>

        <div className="form-actions">
          {!isExample ? (
            <button type="button" className="text-button" onClick={() => { onReset(); onClose(); }}>
              Clear my minimums
            </button>
          ) : <span />}
          <div className="form-actions-right">
            <button type="button" className="ghost-button" onClick={onClose}>Cancel</button>
            <button type="submit" className="primary-button">Save minimums</button>
          </div>
        </div>
      </form>
    </Modal>
  );
}
