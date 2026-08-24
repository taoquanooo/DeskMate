import { useEffect, useState } from "react";

// The slider and the number field share the same full range (10%–1000%) so
// dragging always moves the actual value instead of being clamped to a
// sub-range and then fighting the typed number. The step is coarser (10%) on
// the slider for ergonomic dragging; the number field keeps 1% precision.
const MIN_PERCENT = 10;
const MAX_PERCENT = 1000;
const SLIDER_STEP = 10;

export interface PetSizeSettingProps {
  scale: number;
  onChange: (scale: number) => void;
}

export function PetSizeSetting({ scale, onChange }: PetSizeSettingProps) {
  const percentage = Math.round(scale * 100);
  const [draft, setDraft] = useState(String(percentage));

  useEffect(() => setDraft(String(percentage)), [percentage]);

  const commitDraft = () => {
    if (draft.trim() === "") {
      setDraft(String(percentage));
      return;
    }
    const parsed = Number(draft);
    if (!Number.isFinite(parsed)) {
      setDraft(String(percentage));
      return;
    }
    // 0% or negative sizes would make the pet window disappear entirely, so
    // the range is wide but still bounded.
    const next = Math.min(MAX_PERCENT, Math.max(MIN_PERCENT, Math.round(parsed)));
    setDraft(String(next));
    if (next !== percentage) onChange(next / 100);
  };

  const sliderValue = Math.min(MAX_PERCENT, Math.max(MIN_PERCENT, percentage));
  const progress =
    ((sliderValue - MIN_PERCENT) / (MAX_PERCENT - MIN_PERCENT)) * 100;

  return (
    <label className="setting-row pet-size-row">
      <span>
        <strong>大小</strong>
        <small>{percentage}%</small>
      </span>
      <span className="pet-size-controls">
        <input
          aria-label="大小"
          type="range"
          min={MIN_PERCENT}
          max={MAX_PERCENT}
          step={SLIDER_STEP}
          value={sliderValue}
          style={{ "--range-progress": `${progress}%` } as React.CSSProperties}
          onChange={(event) => onChange(Number(event.target.value) / 100)}
        />
        <span className="percent-input">
          <input
            aria-label="桌宠大小百分比"
            type="number"
            min={MIN_PERCENT}
            max={MAX_PERCENT}
            step={1}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={commitDraft}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                commitDraft();
              }
            }}
          />
          <span>%</span>
        </span>
      </span>
    </label>
  );
}
