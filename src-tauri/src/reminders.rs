use crate::{
    settings::{Reminder, ReminderSchedule},
    AppState,
};
use chrono::{Local, TimeZone};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    sync::Mutex,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use tauri::{Emitter, Listener, Manager, PhysicalPosition};

#[derive(Default)]
pub struct ReminderRuntime {
    last_triggered: Mutex<HashMap<String, i64>>,
    snoozed_until: Mutex<HashMap<String, i64>>,
    last_tick: Mutex<Option<Instant>>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct BubblePayload {
    reminder_ids: Vec<String>,
    title: String,
    message: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct BubbleAction {
    action: String,
    reminder_ids: Vec<String>,
}

impl ReminderRuntime {
    pub fn initialize(&self, reminders: &[Reminder]) {
        let now = epoch_millis();
        let mut last = self.last_triggered.lock().expect("reminder state poisoned");
        for item in reminders {
            last.entry(item.id.clone()).or_insert(now);
        }
        let mut tick = self.last_tick.lock().expect("reminder state poisoned");
        if tick.is_none() {
            *tick = Some(Instant::now());
        }
    }

    fn reset_after_sleep(&self, reminders: &[Reminder]) -> bool {
        let mut tick = self.last_tick.lock().expect("reminder state poisoned");
        let resumed = tick.is_some_and(|previous| previous.elapsed() > Duration::from_secs(120));
        *tick = Some(Instant::now());
        if resumed {
            let now = epoch_millis();
            let mut last = self.last_triggered.lock().expect("reminder state poisoned");
            for item in reminders {
                last.insert(item.id.clone(), now);
            }
        }
        resumed
    }

    fn due_within(&self, reminders: &[Reminder], window: Duration) -> Vec<Reminder> {
        let now = epoch_millis();
        let horizon = now + window.as_millis() as i64;
        let last = self.last_triggered.lock().expect("reminder state poisoned");
        let snoozed = self.snoozed_until.lock().expect("reminder state poisoned");
        reminders
            .iter()
            .filter(|item| {
                if !item.enabled || snoozed.get(&item.id).is_some_and(|until| *until > now) {
                    return false;
                }
                let previous = *last.get(&item.id).unwrap_or(&now);
                next_due(item, previous, now).is_some_and(|due| due <= horizon)
            })
            .cloned()
            .collect()
    }

    fn mark_triggered(&self, ids: &[String], timestamp: i64) {
        let mut last = self.last_triggered.lock().expect("reminder state poisoned");
        for id in ids {
            last.insert(id.clone(), timestamp);
        }
    }

    fn handle_action(&self, action: BubbleAction) {
        let now = epoch_millis();
        self.mark_triggered(&action.reminder_ids, now);
        let mut snoozed = self.snoozed_until.lock().expect("reminder state poisoned");
        for id in action.reminder_ids {
            if action.action == "snooze" {
                snoozed.insert(id, now + 5 * 60_000);
            } else {
                snoozed.remove(&id);
            }
        }
    }
}

pub fn start(app: tauri::AppHandle, runtime: std::sync::Arc<ReminderRuntime>) {
    let listener_app = app.clone();
    let listener_runtime = runtime.clone();
    app.listen("bubble://action", move |event| {
        if let Ok(action) = serde_json::from_str::<BubbleAction>(event.payload()) {
            listener_runtime.handle_action(action);
            let _ = listener_app.emit("runtime://animation", serde_json::json!({"state": "idle"}));
        }
    });

    tauri::async_runtime::spawn(async move {
        loop {
            tokio::time::sleep(Duration::from_secs(15)).await;
            let state = app.state::<AppState>();
            let settings = state.settings.lock().expect("settings poisoned").clone();
            runtime.initialize(&settings.reminders);
            if runtime.reset_after_sleep(&settings.reminders) {
                continue;
            }
            if state.paused.load(std::sync::atomic::Ordering::Relaxed)
                || state.fullscreen.load(std::sync::atomic::Ordering::Relaxed)
                || state.dragging.load(std::sync::atomic::Ordering::Relaxed)
                || state.interacting.load(std::sync::atomic::Ordering::Relaxed)
            {
                continue;
            }
            let due = runtime.due_within(&settings.reminders, Duration::from_secs(5 * 60));
            if due.is_empty() {
                continue;
            }
            let ids: Vec<String> = due.iter().map(|item| item.id.clone()).collect();
            runtime.mark_triggered(&ids, epoch_millis());
            let payload = if due.len() == 1 {
                BubblePayload {
                    reminder_ids: ids,
                    title: due[0].title.clone(),
                    message: due[0].message.clone(),
                }
            } else {
                BubblePayload {
                    reminder_ids: ids,
                    title: "休息一下".into(),
                    message: due
                        .iter()
                        .map(|item| item.message.as_str())
                        .collect::<Vec<_>>()
                        .join(" · "),
                }
            };
            show_bubble(&app, payload);
        }
    });
}

fn show_bubble(app: &tauri::AppHandle, payload: BubblePayload) {
    let Some(bubble) = app.get_webview_window("bubble") else {
        return;
    };
    if let Some(pet) = app.get_webview_window("pet") {
        if let (Ok(position), Ok(bubble_size)) = (pet.outer_position(), bubble.outer_size()) {
            let x = position.x - 42;
            let y = position.y - bubble_size.height as i32 + 18;
            let _ = bubble.set_position(PhysicalPosition::new(x, y));
        }
    }
    let _ = bubble.emit("bubble://show", payload);
    let _ = app.emit(
        "runtime://animation",
        serde_json::json!({"state": "waiting"}),
    );
    let _ = bubble.show();
}

fn next_due(reminder: &Reminder, previous: i64, now: i64) -> Option<i64> {
    match &reminder.schedule {
        ReminderSchedule::Interval { minutes } => Some(previous + i64::from(*minutes) * 60_000),
        ReminderSchedule::Daily { at } => {
            let (hour, minute) = at.split_once(':')?;
            let local_now = Local.timestamp_millis_opt(now).single()?;
            let scheduled =
                local_now
                    .date_naive()
                    .and_hms_opt(hour.parse().ok()?, minute.parse().ok()?, 0)?;
            let timestamp = Local
                .from_local_datetime(&scheduled)
                .single()?
                .timestamp_millis();
            if previous < timestamp {
                Some(timestamp)
            } else {
                Some(timestamp + chrono::Duration::days(1).num_milliseconds())
            }
        }
    }
}

fn epoch_millis() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}

#[cfg(test)]
mod tests {
    use super::next_due;
    use crate::settings::{Reminder, ReminderSchedule};

    #[test]
    fn interval_reminder_uses_last_delivery_not_missed_history() {
        let reminder = Reminder {
            id: "water".into(),
            title: "water".into(),
            message: "drink".into(),
            enabled: true,
            schedule: ReminderSchedule::Interval { minutes: 45 },
            snooze_minutes: 5,
        };
        assert_eq!(next_due(&reminder, 1_000, 9_999), Some(2_701_000));
    }
}
