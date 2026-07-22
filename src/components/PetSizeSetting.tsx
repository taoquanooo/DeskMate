import { useEffect, useState } from "react";

const MIN_PERCENT = 25;
const MAX_PERCENT = 300;

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
    const next = Math.min(MAX_PERCENT, Math.max(MIN_PERCENT, Math.round(parsed)));
    setDraft(String(next));
    if (next !== percentage) onChange(next / 100);
  };

  const progress = ((percentage - MIN_PERCENT) / (MAX_PERCENT - MIN_PERCENT)) * 100;

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
          step={5}
          value={percentage}
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
