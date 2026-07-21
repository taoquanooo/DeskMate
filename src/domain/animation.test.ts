import { describe, expect, it } from "vitest";
import { frameAtElapsedTime, gazeAngleFromVector, resolveAnimationIntent } from "./animation";

describe("animation controller", () => {
  it("honors interaction priority", () => {
    expect(
      resolveAnimationIntent({
        interaction: "waving",
        reminderOpen: true,
        updateState: "running",
        motion: "running-right",
        gazeAngle: 90,
      }),
    ).toEqual({ state: "waving" });
  });

  it("maps a screen-right cursor vector to 90 degrees", () => {
    expect(gazeAngleFromVector(100, 0)).toBe(90);
  });

  it("uses exact idle row durations", () => {
    expect(frameAtElapsedTime("idle", 0)).toBe(0);
    expect(frameAtElapsedTime("idle", 280)).toBe(1);
    expect(frameAtElapsedTime("idle", 390)).toBe(2);
  });
});
