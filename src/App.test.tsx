import { DEFAULT_SETTINGS } from "./domain/settings";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const settingsGetMock = vi.hoisted(() => vi.fn());

vi.mock("./lib/tauri", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./lib/tauri")>()),
  settingsGet: settingsGetMock,
}));

import { App, loadInitialSettings } from "./App";

describe("DeskMate settings startup", () => {
  beforeEach(() => {
    settingsGetMock.mockReset();
  });

  it("recovers when the first settings request races native startup", async () => {
    settingsGetMock
      .mockRejectedValueOnce(new Error("state not ready"))
      .mockResolvedValueOnce(structuredClone(DEFAULT_SETTINGS));

    await expect(loadInitialSettings()).resolves.toEqual(DEFAULT_SETTINGS);
    expect(settingsGetMock).toHaveBeenCalledTimes(2);
  });

  it("shows a useful error instead of spinning forever", async () => {
    settingsGetMock.mockRejectedValue(new Error("native settings unavailable"));
    window.history.replaceState({}, "", "/?view=settings");

    render(<App />);

    expect(await screen.findByRole("alert")).toHaveTextContent("无法加载设置");
    expect(screen.queryByLabelText("正在加载 DeskMate")).not.toBeInTheDocument();
  });

  it("copies the GitHub link when native sharing is unavailable", async () => {
    settingsGetMock.mockResolvedValue({ ...structuredClone(DEFAULT_SETTINGS), onboardingComplete: true });
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
    settingsGetMock.mockResolvedValue({ ...structuredClone(DEFAULT_SETTINGS), onboardingComplete: true });
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
});
