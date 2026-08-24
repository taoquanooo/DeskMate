import { useEffect, useState } from "react";

// The slider covers the common range; the number field accepts a wider custom
// range so users are not capped at 300%.
const SLIDER_MIN_PERCENT = 25;
const SLIDER_MAX_PERCENT = 300;
const MIN_PERCENT = 10;
const MAX_PERCENT = 1000;

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
    // the custom range is wide but still bounded.
    const next = Math.min(MAX_PERCENT, Math.max(MIN_PERCENT, Math.round(parsed)));
    setDraft(String(next));
    if (next !== percentage) onChange(next / 100);
  };

  // A custom value beyond the slider range pins the thumb at the nearest end
  // instead of pushing the handle outside its track.
  const sliderValue = Math.min(SLIDER_MAX_PERCENT, Math.max(SLIDER_MIN_PERCENT, percentage));
  const progress = ((sliderValue - SLIDER_MIN_PERCENT) / (SLIDER_MAX_PERCENT - SLIDER_MIN_PERCENT)) * 100;

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
          min={SLIDER_MIN_PERCENT}
          max={SLIDER_MAX_PERCENT}
          step={5}
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
