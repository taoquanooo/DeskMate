import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PetChangedPayload } from "../lib/tauri";

vi.mock("../lib/tauri", () => ({
  BUILT_IN_PETS: [
    { id: "yanghao", spriteVersionNumber: 2, spritesheetUrl: "/pets/yanghao/spritesheet.webp" },
    { id: "lev-neon", spriteVersionNumber: 2, spritesheetUrl: "/pets/lev-neon/spritesheet.webp" },
  ],
  petAssetUrl: (path?: string | null) => path ?? "/pets/yanghao/spritesheet.webp",
}));

import { PetPreview } from "./PetPreview";

const customPet: PetChangedPayload = {
  id: "studio-cat",
  version: "local",
  spriteVersionNumber: 2,
  spritesheetPath: "D:\\pets\\studio-cat\\spritesheet.webp",
};

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("PetPreview", () => {
  it("waits for the selected atlas before starting an activity preview", async () => {
    vi.useFakeTimers();
    let loaded: (() => void) | undefined;
    vi.stubGlobal(
      "Image",
      class {
        onload: (() => void) | null = null;
        set src(_: string) {
          loaded = () => this.onload?.();
        }
      },
    );
    render(<PetPreview pet={customPet} displayName="工作室小猫" action="waving" />);
    act(() => vi.advanceTimersByTime(5000));
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("正在载入预览");
    act(() => loaded?.());
    expect(screen.getByRole("img")).toHaveAttribute("data-row", "3");
    expect(screen.getByRole("img")).toHaveStyle({
      backgroundImage: "url(D:\\pets\\studio-cat\\spritesheet.webp)",
    });
    act(() => vi.advanceTimersByTime(1420));
    expect(screen.getByRole("img")).toHaveAttribute("data-row", "0");
  });
  it("stays at 100% and cycles through its non-interactive showcase", () => {
    vi.useFakeTimers();
    render(
      <PetPreview
        pet={{ id: "yanghao", version: "1.0.0", spriteVersionNumber: 2, spritesheetPath: null }}
        displayName="默认伙伴"
      />,
    );

    expect(screen.getByRole("img")).toHaveStyle({ width: "192px", height: "208px" });
    expect(screen.getByText("默认伙伴 · v1.0.0")).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(3_200));
    expect(screen.getByLabelText("桌宠正在挥手")).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(1_400));
    expect(screen.getByLabelText("桌宠正在跳跃")).toBeInTheDocument();
  });

  it("resolves Lev-neon to its bundled atlas without an app-data path", () => {
    render(
      <PetPreview
        pet={{ id: "lev-neon", version: "1.0.0", spriteVersionNumber: 2, spritesheetPath: null }}
        displayName="Lev-neon"
      />,
    );

    expect(screen.getByRole("img")).toHaveStyle({
      backgroundImage: "url(/pets/lev-neon/spritesheet.webp)",
    });
  });

  it("never shows the previous pet under a new name while the next atlas loads or fails", async () => {
    class PreviewImage {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      set src(value: string) {
        queueMicrotask(() => {
          if (value.includes("broken")) this.onerror?.();
          else this.onload?.();
        });
      }
    }
    vi.stubGlobal("Image", PreviewImage);
    const { rerender } = render(<PetPreview pet={customPet} displayName="工作室小猫" />);

    await waitFor(() =>
      expect(screen.getByRole("img")).toHaveStyle({
        backgroundImage: "url(D:\\pets\\studio-cat\\spritesheet.webp)",
      }),
    );

    rerender(
      <PetPreview
        pet={{ ...customPet, id: "broken", spritesheetPath: "D:\\pets\\broken\\spritesheet.webp" }}
        displayName="损坏宠物"
      />,
    );
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("正在载入预览");
    await act(async () => Promise.resolve());
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("预览图暂时无法载入");
  });
});
