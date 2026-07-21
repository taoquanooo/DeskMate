import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, mergeSettings } from "./settings";

describe("settings recovery", () => {
  it("keeps defaults when persisted settings are malformed", () => {
    expect(mergeSettings({ schemaVersion: 99, pet: { speed: -1 } })).toEqual(DEFAULT_SETTINGS);
  });

  it("clamps pet scale and speed", () => {
    const settings = mergeSettings({
      schemaVersion: 1,
      pet: { scale: 9, speed: 1 },
    });
    expect(settings.pet.scale).toBe(1.5);
    expect(settings.pet.speed).toBe(40);
  });
});
