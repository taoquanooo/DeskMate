export interface RoamingTiming {
  walkMinSeconds: number;
  walkMaxSeconds: number;
  pauseMinSeconds: number;
  pauseMaxSeconds: number;
}

export const DEFAULT_ROAMING_TIMING: RoamingTiming = {
  walkMinSeconds: 15,
  walkMaxSeconds: 45,
  pauseMinSeconds: 3,
  pauseMaxSeconds: 10,
};

export function validSecondsRange(min: number, max: number): boolean {
  return Number.isInteger(min) && Number.isInteger(max) && min >= 1 && max <= 3600 && min <= max;
}

export function sanitizeRoamingTiming(value: unknown): RoamingTiming {
  const input = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const result = { ...DEFAULT_ROAMING_TIMING };
  for (const [minKey, maxKey] of [
    ["walkMinSeconds", "walkMaxSeconds"],
    ["pauseMinSeconds", "pauseMaxSeconds"],
  ] as const) {
    const min = input[minKey] ?? result[minKey];
    const max = input[maxKey] ?? result[maxKey];
    if (typeof min === "number" && typeof max === "number" && validSecondsRange(min, max)) {
      result[minKey] = min;
      result[maxKey] = max;
    }
  }
  return result;
}
