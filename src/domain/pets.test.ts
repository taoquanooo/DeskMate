import { describe, expect, it } from "vitest";
import { ANIMATION_ROWS, validateCatalog, validatePetManifest } from "./pets";

describe("Codex v2 pet contract", () => {
  it("accepts the bundled Yanghao manifest", () => {
    expect(
      validatePetManifest({
        id: "yanghao",
        displayName: "杨皓",
        description: "工作室吉祥物",
        spriteVersionNumber: 2,
        spritesheetPath: "spritesheet.webp",
      }),
    ).toEqual({ ok: true });
  });

  it("rejects manifests that are not v2", () => {
    expect(
      validatePetManifest({
        id: "legacy",
        displayName: "Legacy",
        description: "old",
        spriteVersionNumber: 1,
        spritesheetPath: "spritesheet.webp",
      }),
    ).toEqual({ ok: false, error: "spriteVersionNumber must be 2" });
  });

  it("describes all eleven atlas rows and sixteen gaze angles", () => {
    expect(ANIMATION_ROWS).toHaveLength(11);
    expect(ANIMATION_ROWS.slice(9).flatMap((row) => row.directions)).toEqual([
      0, 22.5, 45, 67.5, 90, 112.5, 135, 157.5, 180, 202.5, 225, 247.5, 270, 292.5, 315, 337.5,
    ]);
  });

  it("rejects catalogs with non-HTTPS packages", () => {
    expect(() =>
      validateCatalog({
        schemaVersion: 1,
        generatedAt: "2026-07-21T00:00:00Z",
        pets: [
          {
            id: "yanghao",
            version: "1.0.0",
            displayName: "杨皓",
            description: "工作室吉祥物",
            author: "DeskMate Studio",
            assetLicense: "All Rights Reserved",
            spriteVersionNumber: 2,
            minAppVersion: "0.1.0",
            previewUrl: "https://example.com/preview.webp",
            packageUrl: "http://example.com/pet.zip",
            sha256: "a".repeat(64),
            sizeBytes: 1024,
          },
        ],
      }),
    ).toThrow("packageUrl must use HTTPS");
  });
});
