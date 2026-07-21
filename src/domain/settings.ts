import { createDefaultReminders, type Reminder } from "./reminders";

export interface SettingsV1 {
  schemaVersion: 1;
  onboardingComplete: boolean;
  autostartEnabled: boolean;
  selectedPet: { id: string; version: string };
  pet: {
    scale: number;
    speed: number;
    roamingEnabled: boolean;
    alwaysOnTop: boolean;
    hideInFullscreen: boolean;
    clickThrough: boolean;
  };
  reminders: Reminder[];
}

export const DEFAULT_SETTINGS: SettingsV1 = {
  schemaVersion: 1,
  onboardingComplete: false,
  autostartEnabled: true,
  selectedPet: { id: "yanghao", version: "1.0.0" },
  pet: {
    scale: 1,
    speed: 80,
    roamingEnabled: true,
    alwaysOnTop: true,
    hideInFullscreen: true,
    clickThrough: false,
  },
  reminders: createDefaultReminders(),
};

export function mergeSettings(value: unknown): SettingsV1 {
  if (!isRecord(value) || value.schemaVersion !== 1) return cloneDefaults();
  const defaults = cloneDefaults();
  const pet = isRecord(value.pet) ? value.pet : {};
  const selectedPet = isRecord(value.selectedPet) ? value.selectedPet : {};
  return {
    schemaVersion: 1,
    onboardingComplete: booleanOr(value.onboardingComplete, defaults.onboardingComplete),
    autostartEnabled: booleanOr(value.autostartEnabled, defaults.autostartEnabled),
    selectedPet: {
      id: stringOr(selectedPet.id, defaults.selectedPet.id),
      version: stringOr(selectedPet.version, defaults.selectedPet.version),
    },
    pet: {
      scale: clamp(numberOr(pet.scale, defaults.pet.scale), 0.75, 1.5),
      speed: clamp(numberOr(pet.speed, defaults.pet.speed), 40, 140),
      roamingEnabled: booleanOr(pet.roamingEnabled, defaults.pet.roamingEnabled),
      alwaysOnTop: booleanOr(pet.alwaysOnTop, defaults.pet.alwaysOnTop),
      hideInFullscreen: booleanOr(pet.hideInFullscreen, defaults.pet.hideInFullscreen),
      clickThrough: booleanOr(pet.clickThrough, defaults.pet.clickThrough),
    },
    reminders: Array.isArray(value.reminders)
      ? sanitizeReminders(value.reminders, defaults.reminders)
      : defaults.reminders,
  };
}

function sanitizeReminders(value: unknown[], fallback: Reminder[]): Reminder[] {
  const valid = value.filter((item): item is Reminder => {
    if (!isRecord(item) || !isRecord(item.schedule)) return false;
    const schedule = item.schedule;
    const scheduleValid =
      (schedule.kind === "interval" && typeof schedule.minutes === "number" && schedule.minutes >= 1) ||
      (schedule.kind === "daily" && typeof schedule.at === "string" && /^\d{2}:\d{2}$/.test(schedule.at));
    return (
      scheduleValid &&
      typeof item.id === "string" &&
      typeof item.title === "string" &&
      typeof item.message === "string" &&
      typeof item.enabled === "boolean"
    );
  });
  return valid.length > 0 ? valid.map((item) => ({ ...item, snoozeMinutes: 5 })) : fallback;
}

function cloneDefaults(): SettingsV1 {
  return structuredClone(DEFAULT_SETTINGS);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function booleanOr(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function stringOr(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() !== "" ? value : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
