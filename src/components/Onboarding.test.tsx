import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Onboarding } from "./Onboarding";

describe("Onboarding", () => {
  it("defaults autostart and all three reminders to enabled", () => {
    render(<Onboarding onFinish={vi.fn()} />);
    expect(screen.getByRole("checkbox", { name: "开机时启动 DeskMate" })).toBeChecked();
    expect(screen.getAllByRole("checkbox", { checked: true })).toHaveLength(4);
  });

  it("submits the first-run choices", () => {
    const onFinish = vi.fn();
    render(<Onboarding onFinish={onFinish} />);
    fireEvent.click(screen.getByRole("button", { name: "开始陪伴" }));
    expect(onFinish).toHaveBeenCalledWith({
      autostartEnabled: true,
      reminderIds: ["eye-rest", "water", "stretch"],
    });
  });
});
