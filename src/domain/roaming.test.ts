import { expect, it } from "vitest";
import { DEFAULT_SETTINGS, mergeSettings } from "./settings";
import { DEFAULT_ROAMING_TIMING, sanitizeRoamingTiming, validSecondsRange } from "./roaming";

it("migrates 0.2.0 preferences without changing the chosen pet, scale or reminders", () => {
  const old = {
    ...structuredClone(DEFAULT_SETTINGS),
    selectedPet: { id: "bear", version: "local" },
    selectedPets: [{ id: "bear", version: "local" }],
  };
  Reflect.deleteProperty(old.pet, "roamingTiming");
  Reflect.deleteProperty(old.randomActivity, "pauseRoaming");
  old.pet.scale = 0.8;
  const next = mergeSettings(old);
  expect(next.pet.roamingTiming).toEqual(DEFAULT_ROAMING_TIMING);
  expect(next.randomActivity.pauseRoaming).toBe(true);
  expect(next.selectedPet).toEqual(old.selectedPet);
  expect(next.pet.scale).toBe(0.8);
  expect(next.reminders).toEqual(old.reminders);
  expect(next.schemaVersion).toBe(1);
});

it("recovers malformed ranges independently and accepts inclusive integer bounds", () => {
  for (const invalid of [
    null,
    "wrong",
    { walkMinSeconds: -1 },
    { walkMinSeconds: 3.5 },
    { walkMinSeconds: 50, walkMaxSeconds: 40 },
  ]) {
    expect(sanitizeRoamingTiming(invalid).walkMinSeconds).toBe(15);
  }
  expect(sanitizeRoamingTiming({ walkMinSeconds: 0, pauseMinSeconds: 1, pauseMaxSeconds: 3600 })).toEqual({
    ...DEFAULT_ROAMING_TIMING,
    pauseMinSeconds: 1,
    pauseMaxSeconds: 3600,
  });
  expect(validSecondsRange(1, 3600)).toBe(true);
  expect(validSecondsRange(5, 5)).toBe(true);
  expect(validSecondsRange(10, 1)).toBe(false);
  expect(validSecondsRange(1, 3601)).toBe(false);
  expect(
    mergeSettings({ schemaVersion: 1, randomActivity: { pauseRoaming: false } }).randomActivity.pauseRoaming,
  ).toBe(false);
});
