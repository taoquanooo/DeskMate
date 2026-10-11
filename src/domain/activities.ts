import { ANIMATION_ROWS } from "./pets";

export const ACTIVITY_ACTIONS = [
  { id: "waving", label: "挥手" },
  { id: "jumping", label: "跳跃" },
  { id: "waiting", label: "发呆" },
  { id: "running", label: "忙碌" },
  { id: "review", label: "庆祝" },
  { id: "failed", label: "懊恼" },
] as const;

export type ActivityAction = (typeof ACTIVITY_ACTIONS)[number]["id"];
export type ActivityFrequency = "quiet" | "normal" | "active" | "custom";
export interface ActivityStatus {
  state:
    | "disabled"
    | "noActions"
    | "paused"
    | "fullscreen"
    | "reducedMotion"
    | "dragging"
    | "interacting"
    | "reminder"
    | "roaming"
    | "waiting"
    | "playing"
    | "unavailable";
  action?: ActivityAction | null;
  remainingSeconds?: number | null;
}

export function activityStatusText(settings: RandomActivitySettings, status: ActivityStatus | null): string {
  if (settings.enabledActions.length === 0) return "未选择动作，请到活动页开启至少一种动作";
  if (!settings.enabled) return "随机活动已关闭";
  if (!status || status.state === "disabled" || status.state === "noActions") return "正在同步活动状态…";
  switch (status.state) {
    case "paused":
      return "已暂停：应用处于暂停状态";
    case "fullscreen":
      return "已暂停：全屏时隐藏";
    case "reducedMotion":
      return "已暂停：系统关闭了界面动画";
    case "dragging":
      return "正在拖拽，结束后重新计时";
    case "interacting":
      return "正在响应点击，结束后重新计时";
    case "reminder":
      return "正在显示提醒，结束后重新计时";
    case "roaming":
      return "等待漫游停下后播放动作";
    case "playing":
      return `正在${ACTIVITY_ACTIONS.find((a) => a.id === status.action)?.label ?? "播放动作"}`;
    case "waiting":
      return status.remainingSeconds == null
        ? "等待下一次活动"
        : `等待下一次活动 · 约 ${status.remainingSeconds} 秒`;
    case "unavailable":
      return "暂时无法读取桌面活动状态";
  }
}
export interface RandomActivitySettings {
  enabled: boolean;
  pauseRoaming: boolean;
  frequency: ActivityFrequency;
  customMinSeconds: number;
  customMaxSeconds: number;
  enabledActions: ActivityAction[];
}

export const DEFAULT_RANDOM_ACTIVITY: RandomActivitySettings = {
  enabled: false,
  pauseRoaming: true,
  frequency: "normal",
  customMinSeconds: 30,
  customMaxSeconds: 90,
  enabledActions: ["waving", "jumping", "waiting", "review"],
};

export function activityDurationMs(action: ActivityAction): number {
  return ANIMATION_ROWS.find((row) => row.state === action)!.durations.reduce((a, b) => a + b, 0) * 2;
}

export function validActivityRange(min: number, max: number): boolean {
  return Number.isInteger(min) && Number.isInteger(max) && min >= 1 && max <= 3600 && min <= max;
}

export function sanitizeRandomActivity(value: unknown): RandomActivitySettings {
  const fallback = structuredClone(DEFAULT_RANDOM_ACTIVITY);
  if (!value || typeof value !== "object" || Array.isArray(value)) return fallback;
  const input = value as Record<string, unknown>;
  const min = input.customMinSeconds ?? fallback.customMinSeconds;
  const max = input.customMaxSeconds ?? fallback.customMaxSeconds;
  const validRange = typeof min === "number" && typeof max === "number" && validActivityRange(min, max);
  return {
    enabled: typeof input.enabled === "boolean" ? input.enabled : fallback.enabled,
    pauseRoaming: typeof input.pauseRoaming === "boolean" ? input.pauseRoaming : fallback.pauseRoaming,
    frequency: ["quiet", "normal", "active", "custom"].includes(input.frequency as string)
      ? (input.frequency as ActivityFrequency)
      : fallback.frequency,
    customMinSeconds: validRange ? min : fallback.customMinSeconds,
    customMaxSeconds: validRange ? max : fallback.customMaxSeconds,
    enabledActions: Array.isArray(input.enabledActions)
      ? [
          ...new Set(
            input.enabledActions.filter((id): id is ActivityAction =>
              ACTIVITY_ACTIONS.some((a) => a.id === id),
            ),
          ),
        ]
      : fallback.enabledActions,
  };
}
