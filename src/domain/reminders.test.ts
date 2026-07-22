import { describe, expect, it } from "vitest";
import { collectDueReminders, createDefaultReminders, mergeReminderMessages } from "./reminders";

describe("reminder scheduling", () => {
  it("creates the three enabled high-frequency defaults", () => {
    const reminders = createDefaultReminders();
    expect(reminders.map((item) => [item.id, item.enabled, item.schedule])).toEqual([
      ["eye-rest", true, { kind: "interval", minutes: 20 }],
      ["water", true, { kind: "interval", minutes: 45 }],
      ["stretch", true, { kind: "interval", minutes: 60 }],
    ]);
  });

  it("does not replay every missed interval after sleep", () => {
    const [reminder] = createDefaultReminders();
    const now = new Date("2026-07-21T08:00:00Z");
    const due = collectDueReminders(
      [reminder!],
      { "eye-rest": new Date("2026-07-21T02:00:00Z").getTime() },
      now.getTime(),
    );
    expect(due).toHaveLength(1);
  });

  it("merges messages that arrive within five minutes", () => {
    expect(
      mergeReminderMessages([
        { title: "远眺", message: "看看远处" },
        { title: "喝水", message: "喝口水吧" },
      ]),
    ).toEqual({ title: "休息一下", message: "看看远处 · 喝口水吧" });
  });
});
