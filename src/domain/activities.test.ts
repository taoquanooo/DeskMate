import { describe, expect, it } from "vitest";
import { DEFAULT_RANDOM_ACTIVITY, sanitizeRandomActivity, validActivityRange } from "./activities";
import { mergeSettings } from "./settings";

describe("random activity settings", () => {
  it("migrates old settings without losing the 80% scale, pet or reminders", () => {
    const old = mergeSettings({
      schemaVersion: 1,
      selectedPet: { id: "bear", version: "local" },
      pet: { scale: 0.8, roamingEnabled: false },
    });
    expect(old.randomActivity).toEqual(DEFAULT_RANDOM_ACTIVITY);
    expect(old.pet.scale).toBe(0.8);
    expect(old.pet.roamingEnabled).toBe(false);
    expect(old.selectedPet.id).toBe("bear");
    const loaded = mergeSettings({
      ...old,
      randomActivity: {
        enabled: true,
        frequency: "custom",
        customMinSeconds: 15,
        customMaxSeconds: 20,
        enabledActions: [],
      },
    });
    expect(mergeSettings(JSON.parse(JSON.stringify(loaded)))).toEqual(loaded);
    expect(loaded.reminders).toEqual(old.reminders);
    expect(loaded.randomActivity.enabledActions).toEqual([]);
  });
  it("ignores unknown actions and deduplicates without inventing replacements", () => {
    expect(
      sanitizeRandomActivity({ enabledActions: ["waving", "unknown", "waving", 3] }).enabledActions,
    ).toEqual(["waving"]);
    expect(sanitizeRandomActivity({ enabledActions: ["unknown"] }).enabledActions).toEqual([]);
    expect(sanitizeRandomActivity({ enabledActions: "invalid" }).enabledActions).toEqual(
      DEFAULT_RANDOM_ACTIVITY.enabledActions,
    );
  });
  it.each([
    [0, 1],
    [5, 4],
    [1.5, 2],
    [1, 3601],
    [NaN, 10],
    [1, Infinity],
  ])("rejects invalid custom range %s–%s", (min, max) => {
    expect(validActivityRange(min, max)).toBe(false);
    expect(
      sanitizeRandomActivity({ customMinSeconds: min, customMaxSeconds: max, frequency: "bad" }),
    ).toMatchObject({ customMinSeconds: 30, customMaxSeconds: 90, frequency: "normal" });
  });
  it("allows inclusive bounds and a fixed interval", () => {
    expect(validActivityRange(1, 3600)).toBe(true);
    expect(validActivityRange(10, 10)).toBe(true);
  });
});
