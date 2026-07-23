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

  it("migrates the legacy single pet selection into the multi-pet list", () => {
    const settings = mergeSettings({
      schemaVersion: 1,
      selectedPet: { id: "lev-neon", version: "1.0.0" },
    });
    expect(settings.selectedPets).toEqual([{ id: "lev-neon", version: "1.0.0" }]);
    expect(settings.selectedPet).toEqual({ id: "lev-neon", version: "1.0.0" });
  });

  it("dedupes, caps, and primary-syncs the multi-pet list", () => {
    const settings = mergeSettings({
      schemaVersion: 1,
      selectedPets: [
        { id: "yanghao", version: "1.0.0" },
        { id: "lev-neon", version: "1.0.0" },
        { id: "yanghao", version: "1.0.0" },
        { id: "", version: "1.0.0" },
        { id: "a", version: "1.0.0" },
        { id: "b", version: "1.0.0" },
        { id: "c", version: "1.0.0" },
      ],
    });
    expect(settings.selectedPets).toEqual([
      { id: "yanghao", version: "1.0.0" },
      { id: "lev-neon", version: "1.0.0" },
      { id: "a", version: "1.0.0" },
      { id: "b", version: "1.0.0" },
    ]);
    expect(settings.selectedPet).toEqual({ id: "yanghao", version: "1.0.0" });
  });

  it("falls back to the legacy selection when the list is unusable", () => {
    const settings = mergeSettings({
      schemaVersion: 1,
      selectedPet: { id: "lev-neon", version: "1.0.0" },
      selectedPets: [{ id: "", version: "" }],
    });
    expect(settings.selectedPets).toEqual([{ id: "lev-neon", version: "1.0.0" }]);
  });
});
