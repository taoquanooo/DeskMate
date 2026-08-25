import { createDefaultReminders, type Reminder } from "./reminders";

export const MIN_PET_SCALE = 0.1;
export const MAX_PET_SCALE = 10;

export interface PetSelection {
  id: string;
  version: string;
}

export interface SettingsV1 {
  schemaVersion: 1;
  onboardingComplete: boolean;
  autostartEnabled: boolean;
  selectedPet: PetSelection;
  /**
   * Single-pet mode: the desktop shows exactly one pet. The list shape is kept
   * for settings-file compatibility with older releases that allowed several
   * pets; loading now truncates it to the first entry.
   */
  selectedPets: PetSelection[];
  pet: {
    scale: number;
    speed: number;
    roamingEnabled: boolean;
    alwaysOnTop: boolean;
    hideInFullscreen: boolean;
    clickThrough: boolean;
  };
  reminders: Reminder[];
  customPetsDir?: string | null;
}

export const DEFAULT_SETTINGS: SettingsV1 = {
  schemaVersion: 1,
  onboardingComplete: false,
  autostartEnabled: true,
  selectedPet: { id: "yanghao", version: "1.0.0" },
  selectedPets: [{ id: "yanghao", version: "1.0.0" }],
  pet: {
    scale: 1,
    speed: 80,
    roamingEnabled: true,
    alwaysOnTop: true,
    hideInFullscreen: true,
    clickThrough: false,
  },
  reminders: createDefaultReminders(),
  customPetsDir: null,
};

export function mergeSettings(value: unknown): SettingsV1 {
  if (!isRecord(value) || value.schemaVersion !== 1) return cloneDefaults();
  const defaults = cloneDefaults();
  const pet = isRecord(value.pet) ? value.pet : {};
  const selectedPet = isRecord(value.selectedPet) ? value.selectedPet : {};
  const legacySelected: PetSelection = {
    id: stringOr(selectedPet.id, defaults.selectedPet.id),
    version: stringOr(selectedPet.version, defaults.selectedPet.version),
  };
  const selectedPets = sanitizeSelectedPets(value.selectedPets, [legacySelected]);
  return {
    schemaVersion: 1,
    onboardingComplete: booleanOr(value.onboardingComplete, defaults.onboardingComplete),
    autostartEnabled: booleanOr(value.autostartEnabled, defaults.autostartEnabled),
    // sanitizeSelectedPets guarantees at least one entry (it falls back to the
    // legacy selection), so index 0 always exists.
    selectedPet: selectedPets[0] ?? defaults.selectedPet,
    selectedPets,
    pet: {
      scale: clamp(numberOr(pet.scale, defaults.pet.scale), MIN_PET_SCALE, MAX_PET_SCALE),
      speed: clamp(numberOr(pet.speed, defaults.pet.speed), 40, 140),
      roamingEnabled: booleanOr(pet.roamingEnabled, defaults.pet.roamingEnabled),
      alwaysOnTop: booleanOr(pet.alwaysOnTop, defaults.pet.alwaysOnTop),
      hideInFullscreen: booleanOr(pet.hideInFullscreen, defaults.pet.hideInFullscreen),
      clickThrough: booleanOr(pet.clickThrough, defaults.pet.clickThrough),
    },
    reminders: Array.isArray(value.reminders)
      ? sanitizeReminders(value.reminders, defaults.reminders)
      : defaults.reminders,
    customPetsDir:
      typeof value.customPetsDir === "string" && value.customPetsDir.trim() !== ""
        ? value.customPetsDir
        : null,
  };
}

function sanitizeSelectedPets(value: unknown, fallback: PetSelection[]): PetSelection[] {
  const valid: PetSelection[] = [];
  if (Array.isArray(value)) {
    for (const item of value) {
      if (!isRecord(item)) continue;
      if (typeof item.id !== "string" || item.id.trim() === "") continue;
      if (typeof item.version !== "string" || item.version.trim() === "") continue;
      valid.push({ id: item.id, version: item.version });
      // Single-pet mode: only the first valid entry survives.
      break;
    }
  }
  return valid.length > 0 ? valid : fallback;
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
  // Clamp instead of overwriting: flattening every reminder to the 5-minute
  // default here would undo the snooze length persisted by the backend.
  return valid.length > 0
    ? valid.map((item) => ({
        ...item,
        snoozeMinutes: clamp(numberOr(item.snoozeMinutes, 5), 1, 30),
      }))
    : fallback;
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
