import { ANIMATION_ROWS, type StandardAnimationState } from "./pets";

export type AnimationState = StandardAnimationState | "look";

export interface AnimationIntentInput {
  interaction?: "waving" | "jumping" | null;
  reminderOpen: boolean;
  updateState?: "running" | "review" | "failed" | null;
  motion?: "running-left" | "running-right" | null;
  gazeAngle?: number | null;
}

export interface AnimationSelection {
  state: AnimationState;
  directionDegrees?: number;
}

export function resolveAnimationIntent(input: AnimationIntentInput): AnimationSelection {
  if (input.interaction) return { state: input.interaction };
  if (input.reminderOpen) return { state: "waiting" };
  if (input.updateState) return { state: input.updateState };
  if (input.motion) return { state: input.motion };
  if (input.gazeAngle !== null && input.gazeAngle !== undefined) {
    return { state: "look", directionDegrees: normalizeGazeAngle(input.gazeAngle) };
  }
  return { state: "idle" };
}

export function gazeAngleFromVector(dx: number, dy: number): number {
  if (dx === 0 && dy === 0) return 0;
  const clockwiseFromUp = (Math.atan2(dx, -dy) * 180) / Math.PI;
  return normalizeGazeAngle(clockwiseFromUp);
}

export function normalizeGazeAngle(angle: number): number {
  const normalized = ((angle % 360) + 360) % 360;
  return (Math.round(normalized / 22.5) * 22.5) % 360;
}

export function frameAtElapsedTime(state: StandardAnimationState, elapsedMs: number): number {
  const row = ANIMATION_ROWS.find((candidate) => candidate.state === state);
  if (!row || row.durations.length === 0) return 0;
  const cycle = row.durations.reduce((sum, duration) => sum + duration, 0);
  let cursor = ((elapsedMs % cycle) + cycle) % cycle;
  for (let index = 0; index < row.durations.length; index += 1) {
    const duration = row.durations[index] ?? 0;
    if (cursor < duration) return index;
    cursor -= duration;
  }
  return 0;
}
