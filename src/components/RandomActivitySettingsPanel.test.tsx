import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "../domain/settings";
import { SettingsApp } from "./SettingsApp";
vi.mock("../lib/useActivityStatus", () => ({ useActivityStatus: () => null }));

afterEach(() => vi.useRealTimers());

describe("random activity controls", () => {
  it("keeps unsaved interval drafts across navigation and shows the current missing-action state on home", () => {
    const change = vi.fn();
    render(
      <SettingsApp
        initialSettings={{
          ...DEFAULT_SETTINGS,
          randomActivity: {
            ...DEFAULT_SETTINGS.randomActivity,
            enabled: true,
            frequency: "custom",
            enabledActions: [],
          },
        }}
        onSettingsChange={change}
      />,
    );
    expect(screen.getByLabelText("随机活动运行状态")).toHaveTextContent("未选择动作");
    fireEvent.click(screen.getByRole("button", { name: "活动" }));
    fireEvent.change(screen.getByLabelText("最短间隔（秒）"), { target: { value: "20" } });
    expect(screen.getByText(/未保存：/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "桌宠" }));
    fireEvent.click(screen.getByRole("button", { name: "活动" }));
    expect(screen.getByLabelText("最短间隔（秒）")).toHaveValue(20);
    expect(change).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "保存间隔" }));
    expect(change.mock.lastCall?.[0].randomActivity.customMinSeconds).toBe(20);
    expect(screen.queryByText(/未保存：/)).not.toBeInTheDocument();
  });
  it("keeps the independent activity switch on home and shares it with Activities", () => {
    const change = vi.fn();
    render(<SettingsApp initialSettings={DEFAULT_SETTINGS} onSettingsChange={change} />);
    const toggles = within(screen.getByLabelText("桌宠行为设置")).getAllByRole("switch");
    expect(toggles[0]).toHaveAccessibleName("随机活动");
    expect(toggles[0]).toHaveAttribute("aria-checked", "false");
    fireEvent.click(toggles[0]!);
    expect(change.mock.lastCall?.[0]).toMatchObject({
      randomActivity: { enabled: true },
      pet: { roamingEnabled: true },
    });
    fireEvent.click(screen.getByRole("button", { name: "活动" }));
    expect(screen.getByRole("switch", { name: "启用随机活动" })).toHaveAttribute("aria-checked", "true");
    fireEvent.click(screen.getByRole("switch", { name: "启用随机活动" }));
    fireEvent.click(screen.getByRole("button", { name: "桌宠" }));
    expect(screen.getByRole("switch", { name: "随机活动" })).toHaveAttribute("aria-checked", "false");
  });
  it("saves all presets and validates custom intervals together", () => {
    const change = vi.fn();
    render(<SettingsApp initialSettings={DEFAULT_SETTINGS} onSettingsChange={change} />);
    fireEvent.click(screen.getByRole("button", { name: "活动" }));
    const frequency = screen.getByRole("combobox", { name: "活动频率" });
    expect(frequency).toHaveValue("normal");
    for (const value of ["quiet", "normal", "active", "custom"]) {
      fireEvent.change(frequency, { target: { value } });
      expect(change.mock.lastCall?.[0].randomActivity.frequency).toBe(value);
    }
    const min = screen.getByLabelText("最短间隔（秒）");
    const max = screen.getByLabelText("最长间隔（秒）");
    change.mockClear();
    fireEvent.change(min, { target: { value: "100" } });
    expect(screen.getByRole("alert")).toHaveTextContent("最短间隔不能大于最长间隔");
    expect(screen.getByRole("button", { name: "保存间隔" })).toBeDisabled();
    expect(change).not.toHaveBeenCalled();
    fireEvent.change(max, { target: { value: "180" } });
    fireEvent.click(screen.getByRole("button", { name: "保存间隔" }));
    expect(change.mock.lastCall?.[0].randomActivity).toMatchObject({
      customMinSeconds: 100,
      customMaxSeconds: 180,
    });
    fireEvent.change(frequency, { target: { value: "quiet" } });
    fireEvent.change(frequency, { target: { value: "custom" } });
    expect(screen.getByLabelText("最短间隔（秒）")).toHaveValue(100);
    expect(screen.getByLabelText("最长间隔（秒）")).toHaveValue(180);
  });
  it("keeps reminders intact when all actions are disabled", () => {
    const change = vi.fn();
    render(<SettingsApp initialSettings={DEFAULT_SETTINGS} onSettingsChange={change} />);
    fireEvent.click(screen.getByRole("button", { name: "活动" }));
    for (const name of ["挥手", "跳跃", "发呆", "庆祝"])
      fireEvent.click(screen.getByRole("switch", { name }));
    expect(screen.getByText("未选择动作，暂不播放随机活动。")).toBeInTheDocument();
    expect(change.mock.lastCall?.[0].randomActivity.enabledActions).toEqual([]);
    expect(change.mock.lastCall?.[0].reminders).toEqual(DEFAULT_SETTINGS.reminders);
  });
  it("previews one action for two cycles even while disabled without saving or changing the desktop", () => {
    vi.useFakeTimers();
    const change = vi.fn();
    render(<SettingsApp initialSettings={DEFAULT_SETTINGS} onSettingsChange={change} />);
    fireEvent.click(screen.getByRole("button", { name: "活动" }));
    fireEvent.click(screen.getByRole("button", { name: "预览挥手" }));
    expect(screen.getByRole("img")).toHaveAttribute("data-row", "3");
    act(() => vi.advanceTimersByTime(1392));
    expect(screen.getByRole("img")).toHaveAttribute("data-row", "3");
    act(() => vi.advanceTimersByTime(32));
    expect(screen.getByRole("img")).toHaveAttribute("data-row", "0");
    expect(screen.getByRole("img")).toHaveAttribute("data-column", "0");
    fireEvent.click(screen.getByRole("button", { name: "预览跳跃" }));
    expect(screen.getAllByRole("img")).toHaveLength(1);
    expect(screen.getByRole("img")).toHaveAttribute("data-row", "4");
    expect(change).not.toHaveBeenCalled();
  });
});
