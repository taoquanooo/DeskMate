import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "../domain/settings";

const tauriMocks = vi.hoisted(() => ({
  petCurrent: vi.fn(),
  settingsGet: vi.fn(),
}));

vi.mock("../lib/tauri", () => ({
  emitEvent: vi.fn(),
  listenEvent: vi.fn().mockResolvedValue(() => undefined),
  petAssetUrl: (path?: string | null) => path ?? "/pets/yanghao/spritesheet.webp",
  petCurrent: tauriMocks.petCurrent,
  settingsGet: tauriMocks.settingsGet,
  startWindowDrag: vi.fn(),
}));

import { PetWindow } from "./PetWindow";

describe("PetWindow", () => {
  it("restores a selected custom pet after the application restarts", async () => {
    tauriMocks.settingsGet.mockResolvedValue(structuredClone(DEFAULT_SETTINGS));
    tauriMocks.petCurrent.mockResolvedValue({
      id: "studio-cat",
      version: "local",
      spritesheetPath: "C:\\custom-pets\\studio-cat\\spritesheet.webp",
    });

    render(<PetWindow />);

    const sprite = screen.getByRole("img");
    await waitFor(() =>
      expect(sprite).toHaveStyle({
        backgroundImage: "url(C:\\custom-pets\\studio-cat\\spritesheet.webp)",
      }),
    );
  });
});
