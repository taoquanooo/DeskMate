use crate::{
    settings::{Reminder, ReminderSchedule},
    AppState,
};
use chrono::{Local, TimeZone};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    sync::Mutex,
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tauri::{Emitter, Listener, Manager, PhysicalPosition};

#[derive(Default)]
pub struct ReminderRuntime {
    last_triggered: Mutex<HashMap<String, i64>>,
    snoozed_until: Mutex<HashMap<String, i64>>,
    // Wall-clock (epoch millis) of the last tick. `Instant` cannot detect a
    // system sleep on every Windows setup because QPC may pause while
    // suspended, which would replay stale snoozes after wake.
    last_tick: Mutex<Option<i64>>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct BubblePayload {
    reminder_ids: Vec<String>,
    title: String,
    message: String,
    snooze_minutes: u8,
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
            *tick = Some(now);
        }
    }

    fn reset_after_sleep(&self, reminders: &[Reminder]) -> bool {
        let now = epoch_millis();
        let mut tick = self.last_tick.lock().expect("reminder state poisoned");
        let resumed = tick.is_some_and(|previous| now - previous > 120_000);
        *tick = Some(now);
        if resumed {
            let mut last = self.last_triggered.lock().expect("reminder state poisoned");
            for item in reminders {
                last.insert(item.id.clone(), now);
            }
            // A snooze requested before sleeping must not replay hours later.
            self.snoozed_until
                .lock()
                .expect("reminder state poisoned")
                .clear();
        }
        resumed
    }

    /// Reminders whose due time has passed, paired with that due time. A
    /// snoozed reminder becomes due exactly once when its snooze window ends,
    /// independent of its regular schedule.
    fn due_now(&self, reminders: &[Reminder], now: i64) -> Vec<(Reminder, i64)> {
        let last = self.last_triggered.lock().expect("reminder state poisoned");
        let snoozed = self.snoozed_until.lock().expect("reminder state poisoned");
        reminders
            .iter()
            .filter_map(|item| {
                if !item.enabled {
                    return None;
                }
                if let Some(&until) = snoozed.get(&item.id) {
                    return (until <= now).then(|| (item.clone(), until));
                }
                let previous = *last.get(&item.id).unwrap_or(&now);
                let due = next_due(item, previous, now)?;
                (due <= now).then(|| (item.clone(), due))
            })
            .collect()
    }

    /// Record a delivery using the reminder's own due time (not "now") so the
    /// next due time stays anchored to the schedule instead of drifting, and
    /// an already-fired reminder can never look due again on the next tick.
    fn mark_fired(&self, fired: &[(String, i64)]) {
        let mut last = self.last_triggered.lock().expect("reminder state poisoned");
        let mut snoozed = self.snoozed_until.lock().expect("reminder state poisoned");
        for (id, timestamp) in fired {
            last.insert(id.clone(), *timestamp);
            snoozed.remove(id);
        }
    }

    fn handle_action(&self, action: BubbleAction, snooze_minutes: u8) {
        let now = epoch_millis();
        if action.action == "snooze" {
            // The bubble was already shown (the reminder is marked fired with
            // its due time). Schedule one re-fire when the snooze window ends;
            // due_now treats an elapsed snooze as due and mark_fired clears
            // the entry, so it fires exactly once.
            let until = now + i64::from(snooze_minutes) * 60_000;
            let mut snoozed = self.snoozed_until.lock().expect("reminder state poisoned");
            for id in &action.reminder_ids {
                snoozed.insert(id.clone(), until);
            }
        } else {
            let fired: Vec<(String, i64)> = action
                .reminder_ids
                .iter()
                .map(|id| (id.clone(), now))
                .collect();
            self.mark_fired(&fired);
        }
    }
}

pub fn start(app: tauri::AppHandle, runtime: std::sync::Arc<ReminderRuntime>) {
    let listener_app = app.clone();
    let listener_runtime = runtime.clone();
    app.listen("bubble://action", move |event| {
        if let Ok(action) = serde_json::from_str::<BubbleAction>(event.payload()) {
            // A merged bubble snoozes every included reminder at once, so use
            // the longest requested window (matching what the bubble showed).
            let snooze_minutes = listener_app
                .state::<AppState>()
                .settings
                .lock()
                .ok()
                .and_then(|settings| {
                    settings
                        .reminders
                        .iter()
                        .filter(|item| action.reminder_ids.contains(&item.id))
                        .map(|item| item.snooze_minutes)
                        .max()
                })
                .unwrap_or(5);
            listener_runtime.handle_action(action, snooze_minutes);
            let _ = listener_app.emit("runtime://animation", serde_json::json!({"state": "idle"}));
        }
    });

    tauri::async_runtime::spawn(async move {
        loop {
            tokio::time::sleep(Duration::from_secs(15)).await;
            let state = app.state::<AppState>();
            // A poisoned settings lock must not kill the reminder loop: skip
            // the tick so reminders survive instead of silently dying.
            let settings = match state.settings.lock() {
                Ok(settings) => settings.clone(),
                Err(_) => continue,
            };
            runtime.initialize(&settings.reminders);
            if runtime.reset_after_sleep(&settings.reminders) {
                continue;
            }
            if state.paused.load(std::sync::atomic::Ordering::Relaxed)
                || state.fullscreen.load(std::sync::atomic::Ordering::Relaxed)
                || crate::any_window_flag(&state.dragging)
                || crate::any_window_flag(&state.interacting)
            {
                continue;
            }
            let now = epoch_millis();
            let due = runtime.due_now(&settings.reminders, now);
            if due.is_empty() {
                continue;
            }
            let ids: Vec<String> = due.iter().map(|(item, _)| item.id.clone()).collect();
            // The merged bubble snoozes every included reminder at once, so
            // advertise the longest requested window to match what happens.
            let snooze_minutes = due
                .iter()
                .map(|(item, _)| item.snooze_minutes)
                .max()
                .unwrap_or(5);
            let payload = if due.len() == 1 {
                BubblePayload {
                    reminder_ids: ids,
                    title: due[0].0.title.clone(),
                    message: due[0].0.message.clone(),
                    snooze_minutes,
                }
            } else {
                BubblePayload {
                    reminder_ids: ids,
                    title: "休息一下".into(),
                    message: due
                        .iter()
                        .map(|(item, _)| item.message.as_str())
                        .collect::<Vec<_>>()
                        .join(" · "),
                    snooze_minutes,
                }
            };
            let fired: Vec<(String, i64)> = due
                .iter()
                .map(|(item, timestamp)| (item.id.clone(), *timestamp))
                .collect();
            runtime.mark_fired(&fired);
            show_bubble(&app, payload);
        }
    });
}

fn show_bubble(app: &tauri::AppHandle, payload: BubblePayload) {
    let Some(bubble) = app.get_webview_window("bubble") else {
        return;
    };
    if let Some(pet) = app.get_webview_window("pet") {
        if let (Ok(pet_position), Ok(pet_size), Ok(bubble_size)) =
            (pet.outer_position(), pet.outer_size(), bubble.outer_size())
        {
            // All values are physical pixels. Center the bubble over the pet
            // with a small DPI-scaled overlap so it visually connects to it.
            let scale = pet.scale_factor().unwrap_or(1.0);
            let overlap = (scale * 12.0).round() as i32;
            let mut x = pet_position.x + (pet_size.width as i32 - bubble_size.width as i32) / 2;
            let mut y = pet_position.y - bubble_size.height as i32 + overlap;
            // Keep the bubble fully inside the pet's monitor so it is never
            // clipped at a screen edge.
            if let Some(monitor) = pet.current_monitor().ok().flatten() {
                let bounds = monitor.work_area();
                x = x.clamp(
                    bounds.position.x,
                    (bounds.position.x + bounds.size.width as i32 - bubble_size.width as i32)
                        .max(bounds.position.x),
                );
                y = y.max(bounds.position.y);
            }
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
                .earliest()?
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
    use super::{next_due, ReminderRuntime};
    use crate::settings::{Reminder, ReminderSchedule};

    fn interval_reminder() -> Reminder {
        Reminder {
            id: "water".into(),
            title: "water".into(),
            message: "drink".into(),
            enabled: true,
            schedule: ReminderSchedule::Interval { minutes: 45 },
            snooze_minutes: 5,
        }
    }

    #[test]
    fn interval_reminder_uses_last_delivery_not_missed_history() {
        let reminder = interval_reminder();
        assert_eq!(next_due(&reminder, 1_000, 9_999), Some(2_701_000));
    }

    #[test]
    fn fired_interval_does_not_re_fire_before_next_due() {
        let reminder = interval_reminder();
        let runtime = ReminderRuntime::default();
        let now = 10_000_000;
        // Simulate a previous delivery so the reminder is armed from `now`.
        runtime
            .last_triggered
            .lock()
            .expect("reminder state poisoned")
            .insert(reminder.id.clone(), now);

        let due = runtime.due_now(std::slice::from_ref(&reminder), now + 45 * 60_000);
        assert_eq!(due.len(), 1);
        assert_eq!(due[0].1, now + 45 * 60_000);
        runtime.mark_fired(&[(reminder.id.clone(), due[0].1)]);

        assert!(runtime
            .due_now(std::slice::from_ref(&reminder), now + 45 * 60_000 + 60_000)
            .is_empty());

        let next = runtime.due_now(std::slice::from_ref(&reminder), now + 90 * 60_000);
        assert_eq!(next.len(), 1);
    }

    #[test]
    fn snoozed_reminder_fires_exactly_once() {
        let reminder = interval_reminder();
        let runtime = ReminderRuntime::default();
        let now = 10_000_000;
        runtime
            .last_triggered
            .lock()
            .expect("reminder state poisoned")
            .insert(reminder.id.clone(), now);

        let due = runtime.due_now(std::slice::from_ref(&reminder), now + 45 * 60_000);
        runtime.mark_fired(&[(reminder.id.clone(), due[0].1)]);

        let snooze_end = now + 50 * 60_000;
        runtime
            .snoozed_until
            .lock()
            .expect("reminder state poisoned")
            .insert(reminder.id.clone(), snooze_end);

        assert!(runtime
            .due_now(std::slice::from_ref(&reminder), now + 46 * 60_000)
            .is_empty());

        let refire = runtime.due_now(std::slice::from_ref(&reminder), snooze_end + 1_000);
        assert_eq!(refire.len(), 1);
        assert_eq!(refire[0].1, snooze_end);

        runtime.mark_fired(&[(reminder.id.clone(), refire[0].1)]);
        assert!(runtime
            .due_now(std::slice::from_ref(&reminder), snooze_end + 2_000)
            .is_empty());
    }
}
