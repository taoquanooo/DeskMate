export type ReminderSchedule = { kind: "interval"; minutes: number } | { kind: "daily"; at: string };

export interface Reminder {
  id: string;
  title: string;
  message: string;
  enabled: boolean;
  schedule: ReminderSchedule;
  snoozeMinutes: 5;
}

export interface ReminderMessage {
  title: string;
  message: string;
}

export function createDefaultReminders(): Reminder[] {
  return [
    reminder("eye-rest", "看看远处", "让眼睛休息 20 秒", 20),
    reminder("water", "喝口水吧", "补充一点水分", 45),
    reminder("stretch", "起来走走吧", "活动一下肩颈和双腿", 60),
  ];
}

export function collectDueReminders(
  reminders: readonly Reminder[],
  lastTriggeredAt: Readonly<Record<string, number>>,
  now: number,
): Reminder[] {
  return reminders.filter((item) => {
    if (!item.enabled) return false;
    const last = lastTriggeredAt[item.id] ?? now;
    if (item.schedule.kind === "interval") {
      return now - last >= item.schedule.minutes * 60_000;
    }
    const scheduled = dailyTimestamp(now, item.schedule.at);
    return now >= scheduled && last < scheduled;
  });
}

export function mergeReminderMessages(messages: readonly ReminderMessage[]): ReminderMessage {
  if (messages.length === 0) return { title: "休息一下", message: "照顾好自己" };
  if (messages.length === 1) return messages[0]!;
  return {
    title: "休息一下",
    message: messages.map((item) => item.message).join(" · "),
  };
}

function reminder(id: string, title: string, message: string, minutes: number): Reminder {
  return { id, title, message, enabled: true, schedule: { kind: "interval", minutes }, snoozeMinutes: 5 };
}

function dailyTimestamp(now: number, at: string): number {
  const match = /^(\d{2}):(\d{2})$/.exec(at);
  if (!match) return Number.POSITIVE_INFINITY;
  const date = new Date(now);
  date.setHours(Number(match[1]), Number(match[2]), 0, 0);
  return date.getTime();
}
