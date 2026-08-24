import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ReminderBubble } from "./ReminderBubble";

describe("ReminderBubble", () => {
  it("offers complete, snooze, and dismiss actions", () => {
    const onComplete = vi.fn();
    const onSnooze = vi.fn();
    const onDismiss = vi.fn();
    render(
      <ReminderBubble
        title="起来走走吧"
        message="活动一下肩颈和双腿"
        onComplete={onComplete}
        onSnooze={onSnooze}
        onDismiss={onDismiss}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "完成" }));
    fireEvent.click(screen.getByRole("button", { name: "5 分钟后提醒" }));
    fireEvent.click(screen.getByRole("button", { name: "关闭" }));
    expect(onComplete).toHaveBeenCalledOnce();
    expect(onSnooze).toHaveBeenCalledOnce();
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it("labels the snooze button with the actual snooze length", () => {
    render(
      <ReminderBubble
        title="喝口水吧"
        message="补充一点水分"
        snoozeMinutes={10}
        onComplete={() => undefined}
        onSnooze={() => undefined}
        onDismiss={() => undefined}
      />,
    );
    expect(screen.getByRole("button", { name: "10 分钟后提醒" })).toBeInTheDocument();
  });
});
