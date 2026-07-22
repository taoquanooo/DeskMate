import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, mergeSettings } from "./settings";

describe("settings recovery", () => {
  it("keeps defaults when persisted settings are malformed", () => {
    expect(mergeSettings({ schemaVersion: 99, pet: { speed: -1 } })).toEqual(DEFAULT_SETTINGS);
  });

  it("clamps pet scale to 25% and 300%", () => {
    const minimum = mergeSettings({
      schemaVersion: 1,
      pet: { scale: 0.01 },
    });
    const maximum = mergeSettings({
      schemaVersion: 1,
      pet: { scale: 9 },
    });
    expect(minimum.pet.scale).toBe(0.25);
    expect(maximum.pet.scale).toBe(3);
  });

  it("keeps the existing movement speed limits", () => {
    const settings = mergeSettings({ schemaVersion: 1, pet: { speed: 1 } });
    expect(settings.pet.speed).toBe(40);
  });
});
