import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useActivityStatus } from "./useActivityStatus";
import { activityStatusText, DEFAULT_RANDOM_ACTIVITY, type ActivityStatus } from "../domain/activities";
const mocks = vi.hoisted(() => ({ get: vi.fn(), listen: vi.fn() }));
vi.mock("./tauri", () => ({ activityStatusGet: mocks.get, listenEvent: mocks.listen }));
beforeEach(() => {
  mocks.get.mockReset();
  mocks.listen.mockReset();
});
describe("native activity status", () => {
  it("keeps a newer live event instead of a delayed initial snapshot", async () => {
    let receive!: (status: ActivityStatus) => void;
    let resolve!: (status: ActivityStatus) => void;
    const dispose = vi.fn();
    mocks.listen.mockImplementation(async (_event, handler) => {
      receive = handler;
      return dispose;
    });
    mocks.get.mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const { result, unmount } = renderHook(useActivityStatus);
    await act(async () => undefined);
    act(() => receive({ state: "playing", action: "waving" }));
    await act(async () => resolve({ state: "waiting", remainingSeconds: 30 }));
    expect(result.current).toEqual({ state: "playing", action: "waving" });
    unmount();
    expect(dispose).toHaveBeenCalledOnce();
  });
  it("reports an IPC failure and recovers when live status arrives", async () => {
    let receive!: (status: ActivityStatus) => void;
    mocks.listen.mockImplementation(async (_event, handler) => {
      receive = handler;
      return () => undefined;
    });
    mocks.get.mockRejectedValue(new Error("offline"));
    const { result } = renderHook(useActivityStatus);
    await waitFor(() => expect(result.current?.state).toBe("unavailable"));
    act(() => receive({ state: "paused" }));
    expect(result.current?.state).toBe("paused");
  });
  it("explains blocking, playback and countdown while honoring local switches", () => {
    const settings = { ...DEFAULT_RANDOM_ACTIVITY, enabled: true };
    for (const [state, text] of [
      ["fullscreen", "全屏"],
      ["reducedMotion", "系统"],
      ["reminder", "提醒"],
      ["dragging", "拖拽"],
      ["interacting", "点击"],
      ["roaming", "漫游"],
    ] as const) {
      expect(activityStatusText(settings, { state })).toContain(text);
    }
    expect(activityStatusText(settings, { state: "waiting", remainingSeconds: 7 })).toContain("7 秒");
    expect(activityStatusText(settings, { state: "playing", action: "waving" })).toBe("正在挥手");
    expect(activityStatusText({ ...settings, enabled: false }, { state: "playing" })).toContain("关闭");
    expect(activityStatusText({ ...settings, enabledActions: [] }, { state: "playing" })).toContain(
      "未选择动作",
    );
  });
});
