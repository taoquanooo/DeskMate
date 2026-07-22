import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "../domain/settings";

const tauriMocks = vi.hoisted(() => ({
  eventHandlers: new Map<string, (payload: unknown) => void>(),
  listenEvent: vi.fn(),
  petCurrent: vi.fn(),
  settingsGet: vi.fn(),
}));

vi.mock("../lib/tauri", () => ({
  emitEvent: vi.fn(),
  listenEvent: tauriMocks.listenEvent,
  petAssetUrl: (path?: string | null) => path ?? "/pets/yanghao/spritesheet.webp",
  petCurrent: tauriMocks.petCurrent,
  settingsGet: tauriMocks.settingsGet,
  startWindowDrag: vi.fn(),
}));

import { PetWindow } from "./PetWindow";

describe("PetWindow", () => {
  beforeEach(() => {
    tauriMocks.eventHandlers.clear();
    tauriMocks.listenEvent.mockReset();
    tauriMocks.petCurrent.mockReset();
    tauriMocks.settingsGet.mockReset();
    tauriMocks.listenEvent.mockImplementation(async (event, handler) => {
      tauriMocks.eventHandlers.set(event, handler);
      return () => undefined;
    });
    tauriMocks.settingsGet.mockResolvedValue(structuredClone(DEFAULT_SETTINGS));
    tauriMocks.petCurrent.mockResolvedValue({
      id: "yanghao",
      version: "1.0.0",
      spriteVersionNumber: 2,
      spritesheetPath: null,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("restores a selected custom pet after the application restarts", async () => {
    tauriMocks.settingsGet.mockResolvedValue(structuredClone(DEFAULT_SETTINGS));
    tauriMocks.petCurrent.mockResolvedValue({
      id: "studio-cat",
      version: "local",
      spriteVersionNumber: 1,
      spritesheetPath: "C:\\custom-pets\\studio-cat\\spritesheet.webp",
    });

    render(<PetWindow />);

    const sprite = screen.getByRole("img");
    await waitFor(() =>
      expect(sprite).toHaveStyle({
        backgroundImage: "url(C:\\custom-pets\\studio-cat\\spritesheet.webp)",
        backgroundSize: "1536px 1872px",
      }),
    );
  });

  it("plays jumping after a single click", async () => {
    vi.useFakeTimers();
    render(<PetWindow />);
    await act(async () => undefined);

    fireEvent.click(screen.getByLabelText("DeskMate 桌宠窗口"));
    act(() => vi.advanceTimersByTime(230));

    expect(screen.getByLabelText("桌宠正在跳跃")).toBeInTheDocument();
  });

  it("plays waving after a double click", async () => {
    render(<PetWindow />);
    await act(async () => undefined);

    fireEvent.doubleClick(screen.getByLabelText("DeskMate 桌宠窗口"));

    expect(screen.getByLabelText("桌宠正在挥手")).toBeInTheDocument();
  });

  it("plays the selected action after a right click", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    render(<PetWindow />);
    await act(async () => undefined);

    fireEvent.contextMenu(screen.getByLabelText("DeskMate 桌宠窗口"));

    expect(screen.getByLabelText("桌宠正在等待")).toBeInTheDocument();
  });

  it("keeps the context action when it follows a pending single click", async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    render(<PetWindow />);
    await act(async () => undefined);

    const window = screen.getByLabelText("DeskMate 桌宠窗口");
    fireEvent.click(window);
    fireEvent.contextMenu(window);
    expect(screen.getByLabelText("桌宠正在等待")).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(230));

    expect(screen.getByLabelText("桌宠正在等待")).toBeInTheDocument();
  });

  it("suppresses the pending click action after native drag movement", async () => {
    vi.useFakeTimers();
    render(<PetWindow />);
    await act(async () => undefined);

    fireEvent.click(screen.getByLabelText("DeskMate 桌宠窗口"));
    const dragMoved = tauriMocks.eventHandlers.get("runtime://drag-moved");
    expect(dragMoved).toBeDefined();
    dragMoved?.(undefined);
    act(() => vi.advanceTimersByTime(230));

    expect(screen.queryByLabelText("桌宠正在跳跃")).not.toBeInTheDocument();
  });

  it("restores the pre-drag animation when native dragging ends", async () => {
    render(<PetWindow />);
    await act(async () => undefined);

    const runtimeAnimation = tauriMocks.eventHandlers.get("runtime://animation");
    const dragAnimation = tauriMocks.eventHandlers.get("runtime://drag-animation");
    const dragEnded = tauriMocks.eventHandlers.get("runtime://drag-ended");
    expect(runtimeAnimation).toBeDefined();
    expect(dragAnimation).toBeDefined();
    expect(dragEnded).toBeDefined();

    act(() => runtimeAnimation?.({ state: "waiting" }));
    expect(screen.getByLabelText("桌宠正在等待")).toBeInTheDocument();
    act(() => dragAnimation?.({ state: "running-left" }));
    expect(screen.getByLabelText("桌宠正在向左移动")).toBeInTheDocument();
    act(() => dragEnded?.(undefined));

    expect(screen.getByLabelText("桌宠正在等待")).toBeInTheDocument();
  });

  it("restores an active interaction after native dragging ends", async () => {
    vi.useFakeTimers();
    render(<PetWindow />);
    await act(async () => undefined);

    const dragAnimation = tauriMocks.eventHandlers.get("runtime://drag-animation");
    const dragEnded = tauriMocks.eventHandlers.get("runtime://drag-ended");
    expect(dragAnimation).toBeDefined();
    expect(dragEnded).toBeDefined();

    fireEvent.doubleClick(screen.getByLabelText("DeskMate 桌宠窗口"));
    expect(screen.getByLabelText("桌宠正在挥手")).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(300));
    act(() => dragAnimation?.({ state: "running-left" }));
    expect(screen.getByLabelText("桌宠正在向左移动")).toBeInTheDocument();
    act(() => dragEnded?.(undefined));

    expect(screen.getByLabelText("桌宠正在挥手")).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(600));
    expect(screen.getByLabelText("桌宠正在休息")).toBeInTheDocument();
  });

  it("keeps native drag feedback visible after an interaction expires", async () => {
    vi.useFakeTimers();
    render(<PetWindow />);
    await act(async () => undefined);

    const runtimeAnimation = tauriMocks.eventHandlers.get("runtime://animation");
    const dragAnimation = tauriMocks.eventHandlers.get("runtime://drag-animation");
    const dragEnded = tauriMocks.eventHandlers.get("runtime://drag-ended");
    expect(runtimeAnimation).toBeDefined();
    expect(dragAnimation).toBeDefined();
    expect(dragEnded).toBeDefined();

    fireEvent.doubleClick(screen.getByLabelText("DeskMate 桌宠窗口"));
    act(() => dragAnimation?.({ state: "running-right" }));
    act(() => runtimeAnimation?.({ state: "waiting" }));
    act(() => vi.advanceTimersByTime(900));

    expect(screen.getByLabelText("桌宠正在向右移动")).toBeInTheDocument();
    act(() => dragEnded?.(undefined));
    expect(screen.getByLabelText("桌宠正在等待")).toBeInTheDocument();
  });
});
