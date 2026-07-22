import { DEFAULT_SETTINGS } from "./domain/settings";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PetChangedPayload } from "./lib/tauri";

const tauriMocks = vi.hoisted(() => ({
  listenEvent: vi.fn(),
  petCurrent: vi.fn(),
  settingsGet: vi.fn(),
}));

vi.mock("./lib/tauri", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./lib/tauri")>()),
  listenEvent: tauriMocks.listenEvent,
  petCurrent: tauriMocks.petCurrent,
  settingsGet: tauriMocks.settingsGet,
}));

import { App, loadInitialSettings } from "./App";

describe("DeskMate settings startup", () => {
  beforeEach(() => {
    tauriMocks.settingsGet.mockReset();
    tauriMocks.petCurrent.mockReset();
    tauriMocks.listenEvent.mockReset();
    tauriMocks.petCurrent.mockResolvedValue({
      id: "yanghao",
      version: "1.0.0",
      spriteVersionNumber: 2,
      spritesheetPath: null,
    });
    tauriMocks.listenEvent.mockResolvedValue(() => undefined);
  });

  it("recovers when the first settings request races native startup", async () => {
    tauriMocks.settingsGet
      .mockRejectedValueOnce(new Error("state not ready"))
      .mockResolvedValueOnce(structuredClone(DEFAULT_SETTINGS));

    await expect(loadInitialSettings()).resolves.toEqual(DEFAULT_SETTINGS);
    expect(tauriMocks.settingsGet).toHaveBeenCalledTimes(2);
  });

  it("shows a useful error instead of spinning forever", async () => {
    tauriMocks.settingsGet.mockRejectedValue(new Error("native settings unavailable"));
    window.history.replaceState({}, "", "/?view=settings");

    render(<App />);

    expect(await screen.findByRole("alert")).toHaveTextContent("无法加载设置");
    expect(screen.queryByLabelText("正在加载 DeskMate")).not.toBeInTheDocument();
  });

  it("copies the GitHub link when native sharing is unavailable", async () => {
    tauriMocks.settingsGet.mockResolvedValue({
      ...structuredClone(DEFAULT_SETTINGS),
      onboardingComplete: true,
    });
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    Object.defineProperty(navigator, "share", { configurable: true, value: undefined });
    window.history.replaceState({}, "", "/?view=settings");

    render(<App />);
    await screen.findByRole("heading", { name: "桌宠设置" });
    fireEvent.click(screen.getByRole("button", { name: "关于" }));
    fireEvent.click(screen.getByRole("button", { name: "一键分享" }));

    expect(await screen.findByRole("button", { name: "链接已复制" })).toBeInTheDocument();
    expect(writeText).toHaveBeenCalledWith("https://github.com/taoquanooo/DeskMate");
  });

  it("falls back to a selection copy when clipboard permission is denied", async () => {
    tauriMocks.settingsGet.mockResolvedValue({
      ...structuredClone(DEFAULT_SETTINGS),
      onboardingComplete: true,
    });
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: vi.fn().mockRejectedValue(new Error("permission denied")) },
    });
    Object.defineProperty(navigator, "share", { configurable: true, value: undefined });
    const execCommand = vi.fn().mockReturnValue(true);
    Object.defineProperty(document, "execCommand", { configurable: true, value: execCommand });
    window.history.replaceState({}, "", "/?view=settings");

    render(<App />);
    await screen.findByRole("heading", { name: "桌宠设置" });
    fireEvent.click(screen.getByRole("button", { name: "关于" }));
    fireEvent.click(screen.getByRole("button", { name: "一键分享" }));

    expect(await screen.findByRole("button", { name: "链接已复制" })).toBeInTheDocument();
    expect(execCommand).toHaveBeenCalledWith("copy");
  });

  it("updates the settings preview when the selected pet changes", async () => {
    let changed: ((payload: PetChangedPayload) => void) | undefined;
    tauriMocks.settingsGet.mockResolvedValue({
      ...structuredClone(DEFAULT_SETTINGS),
      onboardingComplete: true,
    });
    tauriMocks.petCurrent.mockResolvedValue({
      id: "studio-cat",
      version: "local",
      spriteVersionNumber: 2,
      spritesheetPath: "D:\\pets\\studio-cat\\spritesheet.webp",
    });
    tauriMocks.listenEvent.mockImplementation(async (event, handler) => {
      if (event === "pet://changed") changed = handler;
      return () => undefined;
    });
    window.history.replaceState({}, "", "/?view=settings");

    render(<App />);

    expect(await screen.findByText("studio-cat · local")).toBeInTheDocument();
    act(() =>
      changed?.({
        id: "new-cat",
        version: "local",
        spriteVersionNumber: 1,
        spritesheetPath: "D:\\pets\\new-cat\\spritesheet.webp",
      }),
    );
    expect(await screen.findByText("new-cat · local")).toBeInTheDocument();
  });
});
