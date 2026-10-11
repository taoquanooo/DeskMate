import { beforeEach, describe, expect, it, vi } from "vitest";

const tauriMocks = vi.hoisted(() => ({
  convertFileSrc: vi.fn((path: string) => `asset://${path}`),
  invoke: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => tauriMocks);

import { petAssetUrl, updateProgressText } from "./tauri";

describe("petAssetUrl", () => {
  beforeEach(() => {
    tauriMocks.convertFileSrc.mockClear();
    Reflect.deleteProperty(window, "__TAURI_INTERNALS__");
  });

  it("keeps bundled app-root asset URLs unchanged", () => {
    expect(petAssetUrl("/pets/lev-neon/spritesheet.webp")).toBe("/pets/lev-neon/spritesheet.webp");
    expect(tauriMocks.convertFileSrc).not.toHaveBeenCalled();
  });

  it("converts downloaded filesystem assets in Tauri", () => {
    Object.defineProperty(window, "__TAURI_INTERNALS__", { configurable: true, value: {} });

    expect(petAssetUrl("C:\\pets\\downloaded\\spritesheet.webp")).toBe(
      "asset://C:\\pets\\downloaded\\spritesheet.webp",
    );
    expect(tauriMocks.convertFileSrc).toHaveBeenCalledWith("C:\\pets\\downloaded\\spritesheet.webp");
  });
  it("changes the local asset URL after replacing a pet at the same path", () => {
    Object.defineProperty(window, "__TAURI_INTERNALS__", { configurable: true, value: {} });
    const path = "C:/pets/bear/spritesheet.webp";
    expect(petAssetUrl(path, "bear", "revision-2")).not.toBe(petAssetUrl(path, "bear", "revision-1"));
  });
  it("shows progress when download length is unknown and during signature verification", () => {
    expect(updateProgressText({ stage: "downloading", source: "github", downloaded: 1024 * 1024 })).toContain(
      "1.0 MiB",
    );
    expect(updateProgressText({ stage: "verifying", source: "mirror", downloaded: 0 })).toContain(
      "备用渠道安装包签名",
    );
  });
});
