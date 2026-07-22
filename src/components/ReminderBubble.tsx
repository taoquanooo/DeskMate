import { useEffect } from "react";
import { Check, Clock3, X } from "lucide-react";

export interface ReminderBubbleProps {
  title: string;
  message: string;
  onComplete: () => void;
  onSnooze: () => void;
  onDismiss: () => void;
  autoDismissMs?: number;
}

export function ReminderBubble({
  title,
  message,
  onComplete,
  onSnooze,
  onDismiss,
  autoDismissMs = 12_000,
}: ReminderBubbleProps) {
  useEffect(() => {
    if (autoDismissMs <= 0) return;
    const timer = window.setTimeout(onDismiss, autoDismissMs);
    return () => window.clearTimeout(timer);
  }, [autoDismissMs, onDismiss]);

  return (
    <section className="reminder-bubble" aria-live="polite">
      <button className="icon-button bubble-close" aria-label="关闭" onClick={onDismiss}>
        <X size={16} />
      </button>
      <p className="eyebrow">DESKMATE 提醒</p>
      <h2>{title}</h2>
      <p>{message}</p>
      <div className="bubble-actions">
        <button className="button button-primary" onClick={onComplete}>
          <Check size={16} />
          完成
        </button>
        <button className="button button-secondary" onClick={onSnooze}>
          <Clock3 size={16} />5 分钟后提醒
        </button>
      </div>
    </section>
  );
}
