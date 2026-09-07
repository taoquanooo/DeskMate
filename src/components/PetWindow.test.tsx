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
  emitWindowFlag: vi.fn(),
  listenEvent: tauriMocks.listenEvent,
  petAssetUrl: (path?: string | null, id?: string) =>
    path ?? (id === "lev-neon" ? "/pets/lev-neon/spritesheet.webp" : "/pets/yanghao/spritesheet.webp"),
  petCurrent: tauriMocks.petCurrent,
  settingsGet: tauriMocks.settingsGet,
  startWindowDrag: vi.fn(),
}));

import { PetWindow } from "./PetWindow";

describe("PetWindow", () => {
  it("hands a random activity to manual interaction, then the pending reminder, then idle", async () => {
    vi.useFakeTimers();
    render(<PetWindow />);
    await act(async () => undefined);
    const animation = tauriMocks.eventHandlers.get("runtime://animation")!;
    act(() => animation({ state: "review" }));
    expect(screen.getByRole("img")).toHaveAttribute("data-row", "8");
    fireEvent.doubleClick(screen.getByLabelText("DeskMate 桌宠窗口"));
    act(() => animation({ state: "idle" })); // native cancellation updates the resume state
    expect(screen.getByRole("img")).toHaveAttribute("data-row", "3");
    act(() => animation({ state: "waiting" }));
    act(() => vi.advanceTimersByTime(900));
    expect(screen.getByRole("img")).toHaveAttribute("data-row", "6");
    act(() => animation({ state: "idle" })); // also delivered on bubble auto-hide
    expect(screen.getByRole("img")).toHaveAttribute("data-row", "0");
  });
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
    vi.unstubAllGlobals();
  });

  it("fits the entire sprite inside an 80% native window before settings finish loading", async () => {
    vi.stubGlobal("innerWidth", 160);
    vi.stubGlobal("innerHeight", 172);
    tauriMocks.settingsGet.mockImplementation(() => new Promise(() => undefined));

    render(<PetWindow />);
    await act(async () => undefined);

    const sprite = screen.getByRole("img");
    expect(parseFloat(sprite.style.width)).toBeLessThanOrEqual(154);
    expect(parseFloat(sprite.style.height)).toBeLessThanOrEqual(166);
    expect(parseFloat(sprite.style.width) / parseFloat(sprite.style.height)).toBeCloseTo(192 / 208);
  });

  it("fits fractional DPI rounding and follows native resizes", async () => {
    vi.stubGlobal("innerWidth", 160);
    vi.stubGlobal("innerHeight", 172);
    tauriMocks.settingsGet.mockResolvedValue({
      ...structuredClone(DEFAULT_SETTINGS),
      pet: { ...DEFAULT_SETTINGS.pet, scale: 0.8 },
    });
    render(<PetWindow />);
    await act(async () => undefined);

    const sprite = screen.getByRole("img");
    expect(parseFloat(sprite.style.height)).toBeLessThanOrEqual(166);

    act(() => tauriMocks.eventHandlers.get("settings://scale")?.(2));
    expect(parseFloat(sprite.style.height)).toBeLessThanOrEqual(166);
    vi.stubGlobal("innerWidth", 390);
    vi.stubGlobal("innerHeight", 422);
    fireEvent(window, new Event("resize"));
    expect(sprite).toHaveStyle({ width: "384px", height: "416px" });
  });

  it("does not let a delayed initial settings response undo a newer scale event", async () => {
    let finishSettings!: (value: typeof DEFAULT_SETTINGS) => void;
    tauriMocks.settingsGet.mockImplementation(
      () =>
        new Promise((resolve) => {
          finishSettings = resolve;
        }),
    );
    render(<PetWindow />);
    await act(async () => undefined);

    act(() => tauriMocks.eventHandlers.get("settings://scale")?.(0.8));
    await act(async () => finishSettings(structuredClone(DEFAULT_SETTINGS)));
    expect(screen.getByRole("img")).toHaveStyle({ width: "153.60000000000002px", height: "166.4px" });
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

  it("resolves Lev-neon to its bundled atlas when native payload has no filesystem path", async () => {
    tauriMocks.petCurrent.mockResolvedValue({
      id: "lev-neon",
      version: "1.0.0",
      spriteVersionNumber: 2,
      spritesheetPath: null,
    });

    render(<PetWindow />);

    await waitFor(() =>
      expect(screen.getByRole("img")).toHaveStyle({
        backgroundImage: "url(/pets/lev-neon/spritesheet.webp)",
      }),
    );
  });

  it("renders at the saved global size", async () => {
    tauriMocks.settingsGet.mockResolvedValue({
      ...structuredClone(DEFAULT_SETTINGS),
      pet: { ...DEFAULT_SETTINGS.pet, scale: 2 },
    });

    render(<PetWindow />);

    await waitFor(() => expect(screen.getByRole("img")).toHaveStyle({ width: "384px", height: "416px" }));
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

  it("defers backend animation updates until native dragging ends", async () => {
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
    act(() => dragAnimation?.({ state: "running-left" }));
    act(() => vi.advanceTimersByTime(900));
    act(() => runtimeAnimation?.({ state: "review" }));

    expect(screen.getByLabelText("桌宠正在向左移动")).toBeInTheDocument();
    act(() => dragEnded?.(undefined));
    expect(screen.getByLabelText("桌宠已经完成")).toBeInTheDocument();
  });
});
