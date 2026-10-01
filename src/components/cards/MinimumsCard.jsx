import { ClipboardCheck, ClipboardCopy, SlidersHorizontal } from 'lucide-react';
import { useState } from 'react';
import { PRESETS, VERDICTS } from '../../lib/aviation/minimums';
import { formatLocal, formatZulu, zoneAbbreviation } from '../../lib/format';
import { Card, Segmented, StatusIcon } from '../ui';

const DEPART_OPTIONS = [
  { value: 0, label: 'Now' },
  { value: 1, label: '+1 hr' },
  { value: 2, label: '+2 hr' },
  { value: 3, label: '+3 hr' },
  { value: 'custom', label: 'At…' },
];

const DURATION_OPTIONS = [
  { value: 1, label: '1 hr' },
  { value: 1.5, label: '1.5' },
  { value: 2, label: '2 hr' },
  { value: 3, label: '3 hr' },
];

export function MinimumsCard({ evaluation, flightWindow, onWindowChange, windowRange, minimums, isExample, onEdit, onCopyBriefing, timeZone, loading }) {
  const [copied, setCopied] = useState(false);
  const verdict = VERDICTS[evaluation?.verdict || 'unknown'];
  const stillLoading = loading || (evaluation?.checks || []).some((item) => item.value === 'Loading…');
  const presetLabel = PRESETS[minimums.preset]?.label;

  async function copy() {
    const ok = await onCopyBriefing();
    if (ok) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    }
  }

  return (
    <Card
      title="Personal minimums check"
      icon={SlidersHorizontal}
      className="area-minimums minimums-card"
      action={<button type="button" className="text-button" onClick={onEdit}>Edit minimums</button>}
    >
      <div className={`verdict verdict-${stillLoading ? 'unknown' : verdict.tone}`}>
        <StatusIcon status={stillLoading ? 'unknown' : { go: 'pass', caution: 'caution', nogo: 'fail', unknown: 'unknown' }[verdict.tone]} size={30} />
        <div>
          <div className="verdict-label">{stillLoading ? 'Checking conditions…' : verdict.label}</div>
          <div className="verdict-sub">
            {windowRange
              ? `${evaluation?.futureOnly ? 'Departing' : 'Flying'} ${formatLocal(windowRange.startMs, timeZone)}–${formatLocal(windowRange.endMs, timeZone)} ${zoneAbbreviation(timeZone)} (${formatZulu(windowRange.startMs)}–${formatZulu(windowRange.endMs)})`
              : null}
          </div>
        </div>
      </div>

      <div className="window-controls">
        <div className="window-control">
          <span className="control-label">Depart</span>
          <Segmented
            label="Departure time"
            options={DEPART_OPTIONS}
            value={flightWindow.offset}
            onChange={(offset) => onWindowChange({ ...flightWindow, offset })}
          />
          {flightWindow.offset === 'custom' ? (
            <input
              type="time"
              className="time-input"
              value={flightWindow.customTime}
              onChange={(event) => onWindowChange({ ...flightWindow, customTime: event.target.value })}
              aria-label={`Departure time, ${zoneAbbreviation(timeZone)}`}
            />
          ) : null}
        </div>
        <div className="window-control">
          <span className="control-label">For</span>
          <Segmented
            label="Flight duration"
            options={DURATION_OPTIONS}
            value={flightWindow.duration}
            onChange={(duration) => onWindowChange({ ...flightWindow, duration })}
          />
        </div>
      </div>

      <ul className="checks">
        {(evaluation?.checks || []).map((item) => (
          <li key={item.id} className={`check check-${item.status}`}>
            <StatusIcon status={item.status} />
            <div className="check-body">
              <div className="check-line">
                <span className="check-label">{item.label}</span>
                <span className="check-value">{item.value}</span>
              </div>
              <div className="check-detail">
                <span>Limit: {item.limit}</span>
                {item.note ? <span className="check-note">{item.note}</span> : null}
              </div>
            </div>
          </li>
        ))}
      </ul>

      {evaluation?.notChecked?.length ? (
        <div className="not-checked">
          <div className="control-label">Not checked here</div>
          <ul>
            {evaluation.notChecked.map((item) => <li key={item}>{item}</li>)}
          </ul>
        </div>
      ) : null}

      <div className="minimums-foot">
        {isExample ? (
          <button type="button" className="example-banner" onClick={onEdit}>
            Using example <strong>{presetLabel}</strong> limits. <span>Set your own →</span>
          </button>
        ) : (
          <span className="muted small">Your limits: {presetLabel && minimums.preset !== 'custom' ? presetLabel : 'Custom'} · saved in this browser</span>
        )}
        <button type="button" className="ghost-button" onClick={copy}>
          {copied ? <ClipboardCheck size={15} /> : <ClipboardCopy size={15} />}
          {copied ? 'Copied' : 'Copy briefing'}
        </button>
      </div>
    </Card>
  );
}
