import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "../domain/settings";
import { SettingsApp } from "./SettingsApp";

describe("SettingsApp", () => {
  it("matches the approved desktop settings information architecture", () => {
    render(<SettingsApp initialSettings={DEFAULT_SETTINGS} />);
    expect(screen.getByRole("heading", { name: "桌宠设置" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "桌宠" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "提醒" })).toBeInTheDocument();
    expect(screen.getByText("杨皓 · v1.0.0")).toBeInTheDocument();
  });

  it("persists a changed roaming preference", () => {
    const onSettingsChange = vi.fn();
    render(<SettingsApp initialSettings={DEFAULT_SETTINGS} onSettingsChange={onSettingsChange} />);
    fireEvent.click(screen.getByRole("switch", { name: "自动漫游" }));
    expect(onSettingsChange).toHaveBeenCalledWith(
      expect.objectContaining({ pet: expect.objectContaining({ roamingEnabled: false }) }),
    );
  });

  it("opens the reminder editor from the navigation", () => {
    render(<SettingsApp initialSettings={DEFAULT_SETTINGS} />);
    fireEvent.click(screen.getByRole("button", { name: "提醒" }));
    expect(screen.getByRole("heading", { name: "提醒设置" })).toBeInTheDocument();
    expect(screen.getByText("看看远处")).toBeInTheDocument();
  });

  it("labels a daily reminder with its time purpose", () => {
    render(<SettingsApp initialSettings={DEFAULT_SETTINGS} />);
    fireEvent.click(screen.getByRole("button", { name: "提醒" }));
    fireEvent.change(screen.getByRole("combobox", { name: "喝口水吧计划类型" }), {
      target: { value: "daily" },
    });
    expect(screen.getByLabelText("喝口水吧提醒时间")).toHaveAttribute("type", "time");
  });
});
