import { useState } from "react";
import {
  ACTIVITY_ACTIONS,
  validActivityRange,
  type ActivityAction,
  type ActivityFrequency,
  type RandomActivitySettings,
} from "../domain/activities";
import type { PetChangedPayload } from "../lib/tauri";
import { PetPreview } from "./PetPreview";

export function RandomActivitySettingsPanel({
  value,
  onChange,
  pet,
  displayName,
  statusLabel,
  intervalDraft,
  onIntervalDraftChange,
}: {
  value: RandomActivitySettings;
  onChange: (value: RandomActivitySettings) => void;
  pet: PetChangedPayload;
  displayName: string;
  statusLabel: string;
  intervalDraft: { min: string; max: string };
  onIntervalDraftChange: (value: { min: string; max: string }) => void;
}) {
  const { min, max } = intervalDraft;
  const [preview, setPreview] = useState<{ action: ActivityAction; count: number } | null>(null);
  const valid = min.trim() !== "" && max.trim() !== "" && validActivityRange(Number(min), Number(max));
  const dirty = min !== String(value.customMinSeconds) || max !== String(value.customMaxSeconds);
  const patch = (patch: Partial<RandomActivitySettings>) => onChange({ ...value, ...patch });
  return (
    <section className="random-activity-panel" aria-label="随机活动设置">
      <header className="activity-section-header">
        <h2>随机活动</h2>
        <p>只播放原地动作，不发出提醒；自动漫游关闭时也可以独立运行。</p>
      </header>
      <div className="setting-row">
        <span>
          <strong>启用随机活动</strong>
          <small>拖拽、点击互动和定时提醒优先</small>
        </span>
        <button
          type="button"
          role="switch"
          aria-label="启用随机活动"
          aria-checked={value.enabled}
          className={`switch ${value.enabled ? "checked" : ""}`}
          onClick={() => patch({ enabled: !value.enabled })}
        >
          <span />
        </button>
      </div>
      <p className="activity-runtime-status" aria-label="随机活动运行状态">
        {statusLabel}
      </p>
      <div className="setting-row">
        <span>
          <strong>活动时暂停漫游</strong>
          <small>开启后动作到期立即停下，结束后继续漫游；关闭后等待自然停留。</small>
        </span>
        <button
          type="button"
          role="switch"
          aria-label="活动时暂停漫游"
          aria-checked={value.pauseRoaming}
          className={`switch ${value.pauseRoaming ? "checked" : ""}`}
          onClick={() => patch({ pauseRoaming: !value.pauseRoaming })}
        >
          <span />
        </button>
      </div>
      <label className="activity-frequency">
        <strong>活动频率</strong>
        <select
          value={value.frequency}
          onChange={(e) => patch({ frequency: e.target.value as ActivityFrequency })}
        >
          <option value="quiet">安静 · 2–5 分钟</option>
          <option value="normal">普通 · 30–90 秒</option>
          <option value="active">活跃 · 10–30 秒</option>
          <option value="custom">自定义</option>
        </select>
      </label>
      {value.frequency === "custom" && (
        <div className="activity-custom-range">
          <label>
            最短间隔（秒）
            <input
              type="number"
              min="1"
              max="3600"
              step="1"
              value={min}
              aria-invalid={!valid}
              aria-describedby={!valid ? "activity-range-error" : undefined}
              onChange={(e) => onIntervalDraftChange({ min: e.target.value, max })}
            />
          </label>
          <label>
            最长间隔（秒）
            <input
              type="number"
              min="1"
              max="3600"
              step="1"
              value={max}
              aria-invalid={!valid}
              aria-describedby={!valid ? "activity-range-error" : undefined}
              onChange={(e) => onIntervalDraftChange({ min, max: e.target.value })}
            />
          </label>
          <button
            type="button"
            className="button button-secondary"
            disabled={
              !valid || (Number(min) === value.customMinSeconds && Number(max) === value.customMaxSeconds)
            }
            onClick={() => patch({ customMinSeconds: Number(min), customMaxSeconds: Number(max) })}
          >
            保存间隔
          </button>
          <p className="activity-save-hint" role="status">
            {dirty
              ? "未保存：点击“保存间隔”后生效。切换页面会保留草稿，关闭设置窗口前请保存。"
              : "修改间隔后点击“保存间隔”；其他开关自动保存。"}
          </p>
          {!valid && (
            <p id="activity-range-error" role="alert">
              请输入 1–3600 的整数秒，最短间隔不能大于最长间隔。
            </p>
          )}
        </div>
      )}
      <div className="activity-actions-layout">
        <div className="activity-actions">
          {ACTIVITY_ACTIONS.map(({ id, label }) => {
            const checked = value.enabledActions.includes(id);
            return (
              <div className="activity-action" key={id}>
                <div className="activity-action-toggle">
                  <button
                    type="button"
                    className="switch"
                    role="switch"
                    aria-label={label}
                    aria-checked={checked}
                    onClick={() =>
                      patch({
                        enabledActions: checked
                          ? value.enabledActions.filter((action) => action !== id)
                          : [...value.enabledActions, id],
                      })
                    }
                  >
                    <span />
                  </button>
                  <span>{label}</span>
                </div>
                <button
                  type="button"
                  className="button button-secondary"
                  aria-label={`预览${label}`}
                  onClick={() =>
                    setPreview((previous) => ({ action: id, count: (previous?.count ?? 0) + 1 }))
                  }
                >
                  预览
                </button>
              </div>
            );
          })}
          {value.enabledActions.length === 0 && <p role="status">未选择动作，暂不播放随机活动。</p>}
        </div>
        <div className="activity-preview" aria-label="随机动作预览">
          <PetPreview
            key={`${pet.id}:${pet.version}:${pet.spritesheetPath}:${preview?.count ?? 0}`}
            pet={pet}
            displayName={displayName}
            action={preview?.action ?? "idle"}
          />
        </div>
      </div>
    </section>
  );
}
