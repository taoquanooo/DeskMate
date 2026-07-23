import { useState } from "react";
import { BellRing, Heart, Rocket } from "lucide-react";

const REMINDERS = [
  { id: "eye-rest", title: "看看远处", description: "每 20 分钟" },
  { id: "water", title: "喝口水吧", description: "每 45 分钟" },
  { id: "stretch", title: "起来走走", description: "每 60 分钟" },
] as const;

export interface OnboardingChoice {
  autostartEnabled: boolean;
  reminderIds: string[];
}

export function Onboarding({ onFinish }: { onFinish: (choice: OnboardingChoice) => void }) {
  const [autostartEnabled, setAutostartEnabled] = useState(true);
  const [enabled, setEnabled] = useState<Set<string>>(() => new Set(REMINDERS.map((item) => item.id)));

  const toggleReminder = (id: string) => {
    setEnabled((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <main className="onboarding">
      <div className="onboarding-mark">
        <Heart size={28} fill="currentColor" />
      </div>
      <p className="eyebrow">欢迎来到 DESKMATE</p>
      <h1>让桌面伙伴陪你一起工作</h1>
      <p className="onboarding-intro">安静待在桌面，需要时提醒你喝水、远眺和活动一下。</p>
      <label className="choice-row">
        <span className="choice-icon">
          <Rocket size={19} />
        </span>
        <span>
          <strong>开机时启动 DeskMate</strong>
          <small>随时都能在系统托盘暂停或退出</small>
        </span>
        <input
          aria-label="开机时启动 DeskMate"
          type="checkbox"
          checked={autostartEnabled}
          onChange={(event) => setAutostartEnabled(event.target.checked)}
        />
      </label>
      <div className="choice-group">
        <div className="choice-heading">
          <BellRing size={19} />
          <strong>健康提醒</strong>
        </div>
        {REMINDERS.map((reminder) => (
          <label className="compact-choice" key={reminder.id}>
            <span>
              <strong>{reminder.title}</strong>
              <small>{reminder.description}</small>
            </span>
            <input
              type="checkbox"
              checked={enabled.has(reminder.id)}
              onChange={() => toggleReminder(reminder.id)}
              aria-label={reminder.title}
            />
          </label>
        ))}
      </div>
      <button
        className="button button-primary onboarding-start"
        onClick={() =>
          onFinish({
            autostartEnabled,
            reminderIds: REMINDERS.filter((item) => enabled.has(item.id)).map((item) => item.id),
          })
        }
      >
        开始陪伴
      </button>
      <p className="privacy-note">所有设置与提醒都只保存在这台电脑上。</p>
    </main>
  );
}
