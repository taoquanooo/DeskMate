import { validSecondsRange, type RoamingTiming } from "../domain/roaming";

export type RoamingDraft = Record<keyof RoamingTiming, string>;
export const roamingDraft = (value: RoamingTiming): RoamingDraft =>
  Object.fromEntries(Object.entries(value).map(([key, number]) => [key, String(number)])) as RoamingDraft;

export function RoamingTimingSettings({
  value,
  draft,
  onDraftChange,
  onSave,
}: {
  value: RoamingTiming;
  draft: RoamingDraft;
  onDraftChange: (value: RoamingDraft) => void;
  onSave: (value: RoamingTiming) => void;
}) {
  const valid =
    Object.values(draft).every((value) => value.trim() !== "") &&
    validSecondsRange(Number(draft.walkMinSeconds), Number(draft.walkMaxSeconds)) &&
    validSecondsRange(Number(draft.pauseMinSeconds), Number(draft.pauseMaxSeconds));
  const dirty = Object.entries(draft).some(
    ([key, text]) => text !== String(value[key as keyof RoamingTiming]),
  );
  return (
    <form
      className="roaming-timing"
      aria-label="漫游行走与停留时长"
      onSubmit={(event) => {
        event.preventDefault();
        if (valid)
          onSave(
            Object.fromEntries(
              Object.entries(draft).map(([key, text]) => [key, Number(text)]),
            ) as unknown as RoamingTiming,
          );
      }}
    >
      <p>随机行走一段时间后停留；提前到达目标也会停下来。</p>
      {(
        [
          ["随机行走", "walkMinSeconds", "walkMaxSeconds"],
          ["随机停留", "pauseMinSeconds", "pauseMaxSeconds"],
        ] as const
      ).map(([label, min, max]) => (
        <fieldset key={label}>
          <legend>{label}</legend>
          {(
            [
              [min, "最短"],
              [max, "最长"],
            ] as const
          ).map(([key, limit]) => (
            <label key={key}>
              {limit}（秒）
              <input
                aria-label={`${label}${limit}秒数`}
                type="number"
                min={1}
                max={3600}
                step={1}
                value={draft[key]}
                onChange={(event) => onDraftChange({ ...draft, [key]: event.target.value })}
              />
            </label>
          ))}
        </fieldset>
      ))}
      {!valid && <small role="alert">请输入 1–3600 的整数秒数，最短值不能大于最长值。</small>}
      <div className="form-actions">
        <button className="button button-secondary" disabled={!valid || !dirty}>
          保存漫游时长
        </button>
        {dirty && <small role="status">未保存</small>}
      </div>
    </form>
  );
}
