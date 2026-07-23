import { beforeEach, describe, expect, it, vi } from "vitest";

const tauriMocks = vi.hoisted(() => ({
  convertFileSrc: vi.fn((path: string) => `asset://${path}`),
  invoke: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => tauriMocks);

import { petAssetUrl } from "./tauri";

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
});
