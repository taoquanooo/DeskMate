use crate::settings::{ActivityAction, RandomActivitySettings, SelectedPet};
use serde::Serialize;

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ActivityStatus {
    pub state: &'static str,
    pub action: Option<ActivityAction>,
    pub remaining_seconds: Option<u64>,
}

#[derive(Default)]
pub struct ActivityBlockers {
    pub paused: bool,
    pub fullscreen: bool,
    pub reduced_motion: bool,
    pub dragging: bool,
    pub interacting: bool,
    pub reminder: bool,
}

impl ActivityBlockers {
    pub fn reason(&self) -> Option<&'static str> {
        if self.paused {
            Some("paused")
        } else if self.fullscreen {
            Some("fullscreen")
        } else if self.reduced_motion {
            Some("reducedMotion")
        } else if self.dragging {
            Some("dragging")
        } else if self.interacting {
            Some("interacting")
        } else if self.reminder {
            Some("reminder")
        } else {
            None
        }
    }
}

/// Pure scheduler: time and randomness are supplied by the existing motion
/// engine. It never moves windows, emits reminders, or marks user interaction.
#[derive(Default)]
pub struct ActivityScheduler {
    config: Option<RandomActivitySettings>,
    pet: Option<SelectedPet>,
    due_at: Option<u64>,
    playing: Option<(ActivityAction, u64)>,
    previous: Option<ActivityAction>,
    last_wall_ms: Option<i64>,
}

impl ActivityScheduler {
    pub fn status(
        &self,
        now_ms: u64,
        config: &RandomActivitySettings,
        blockers: &ActivityBlockers,
        moving: bool,
    ) -> ActivityStatus {
        let remaining = self
            .due_at
            .map(|due| due.saturating_sub(now_ms).div_ceil(1000));
        let state = if !config.enabled {
            "disabled"
        } else if config.enabled_actions.is_empty() {
            "noActions"
        } else if let Some(reason) = blockers.reason() {
            reason
        } else if self.playing.is_some() {
            "playing"
        } else if moving && remaining == Some(0) {
            "roaming"
        } else {
            "waiting"
        };
        ActivityStatus {
            state,
            action: if state == "playing" {
                self.playing.map(|(action, _)| action)
            } else {
                None
            },
            remaining_seconds: if state == "waiting" { remaining } else { None },
        }
    }
    pub fn tick(
        &mut self,
        now_ms: u64,
        wall_ms: i64,
        config: &RandomActivitySettings,
        pet: &SelectedPet,
        blocked: bool,
        moving: bool,
        mut choose: impl FnMut(u64, u64) -> u64,
    ) -> Option<ActivityAction> {
        // Instant can stop advancing during Windows sleep. A wall-clock gap
        // resets both the current animation and its deadline, with no catch-up.
        let interrupted = self.last_wall_ms.is_some_and(|last| {
            let gap = wall_ms.saturating_sub(last);
            !(0..=2000).contains(&gap)
        });
        self.last_wall_ms = Some(wall_ms);
        let pet_changed = self.pet.as_ref() != Some(pet);
        if interrupted || pet_changed {
            self.playing = None;
            self.due_at = None;
            self.previous = None;
        }
        self.pet = Some(pet.clone());
        if self.config.as_ref() != Some(config) {
            // Preserve a playing action across frequency edits, unless that
            // action has just been disabled. Waiting timers restart immediately.
            if self
                .playing
                .is_some_and(|(action, _)| !config.enabled_actions.contains(&action))
            {
                self.playing = None;
            }
            self.due_at = None;
            self.config = Some(config.clone());
        }
        if blocked || !config.enabled || config.enabled_actions.is_empty() {
            self.playing = None;
            self.due_at = None;
            return None;
        }
        if let Some((action, until)) = self.playing {
            if now_ms < until {
                return Some(action);
            }
            self.playing = None;
        }
        let due_at = *self.due_at.get_or_insert_with(|| {
            let (min, max) = config.interval_seconds();
            now_ms + choose(u64::from(min) * 1000, u64::from(max) * 1000)
        });
        if now_ms < due_at || (moving && !config.pause_roaming) {
            return None;
        }
        let candidates: Vec<_> = config
            .enabled_actions
            .iter()
            .copied()
            .filter(|action| config.enabled_actions.len() == 1 || Some(*action) != self.previous)
            .collect();
        let action = candidates[choose(0, (candidates.len() - 1) as u64) as usize];
        self.previous = Some(action);
        self.playing = Some((action, now_ms + action.duration_ms()));
        self.due_at = None;
        Some(action)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::settings::ActivityFrequency;

    #[test]
    fn status_tracks_real_deadlines_and_priority_reasons() {
        let mut s = ActivityScheduler::default();
        let c = RandomActivitySettings {
            pause_roaming: false,
            ..config()
        };
        let clear = ActivityBlockers::default();
        tick(&mut s, 0, &c, false, false);
        assert_eq!(s.status(1, &c, &clear, false).remaining_seconds, Some(1));
        tick(&mut s, 1000, &c, false, true);
        assert_eq!(s.status(1000, &c, &clear, true).state, "roaming");
        tick(&mut s, 1100, &c, false, false);
        assert_eq!(
            s.status(1100, &c, &clear, false).action,
            Some(ActivityAction::Waving)
        );
        for (blocked, expected) in [
            (
                ActivityBlockers {
                    paused: true,
                    ..Default::default()
                },
                "paused",
            ),
            (
                ActivityBlockers {
                    fullscreen: true,
                    ..Default::default()
                },
                "fullscreen",
            ),
            (
                ActivityBlockers {
                    reduced_motion: true,
                    ..Default::default()
                },
                "reducedMotion",
            ),
            (
                ActivityBlockers {
                    dragging: true,
                    ..Default::default()
                },
                "dragging",
            ),
            (
                ActivityBlockers {
                    interacting: true,
                    ..Default::default()
                },
                "interacting",
            ),
            (
                ActivityBlockers {
                    reminder: true,
                    ..Default::default()
                },
                "reminder",
            ),
        ] {
            assert_eq!(s.status(1100, &c, &blocked, false).state, expected);
        }
        assert_eq!(
            s.status(1100, &RandomActivitySettings::default(), &clear, false)
                .state,
            "disabled"
        );
        let empty = RandomActivitySettings {
            enabled_actions: vec![],
            ..c
        };
        assert_eq!(s.status(1100, &empty, &clear, false).state, "noActions");
    }

    fn config() -> RandomActivitySettings {
        RandomActivitySettings {
            enabled: true,
            frequency: ActivityFrequency::Custom,
            custom_min_seconds: 1,
            custom_max_seconds: 1,
            ..Default::default()
        }
    }
    fn pet() -> SelectedPet {
        SelectedPet {
            id: "yanghao".into(),
            version: "1.0.0".into(),
        }
    }
    fn tick(
        s: &mut ActivityScheduler,
        now: u64,
        c: &RandomActivitySettings,
        blocked: bool,
        moving: bool,
    ) -> Option<ActivityAction> {
        s.tick(now, now as i64, c, &pet(), blocked, moving, |min, _| min)
    }

    #[test]
    fn waits_plays_two_cycles_and_waits_again_without_immediate_repetition() {
        let mut s = ActivityScheduler::default();
        let c = config();
        assert_eq!(tick(&mut s, 0, &c, false, false), None);
        assert_eq!(tick(&mut s, 999, &c, false, false), None);
        assert_eq!(
            tick(&mut s, 1000, &c, false, false),
            Some(ActivityAction::Waving)
        );
        assert_eq!(
            tick(&mut s, 2399, &c, false, false),
            Some(ActivityAction::Waving)
        );
        assert_eq!(tick(&mut s, 2400, &c, false, false), None);
        assert_eq!(
            tick(&mut s, 3400, &c, false, false),
            Some(ActivityAction::Jumping)
        );
    }
    #[test]
    fn movement_defers_start_and_disabled_roaming_does_not_block() {
        let mut s = ActivityScheduler::default();
        let c = RandomActivitySettings {
            pause_roaming: false,
            ..config()
        };
        tick(&mut s, 0, &c, false, true);
        assert_eq!(tick(&mut s, 1000, &c, false, true), None);
        assert_eq!(
            tick(&mut s, 1100, &c, false, false),
            Some(ActivityAction::Waving)
        );
    }
    #[test]
    fn due_activity_can_interrupt_walking_when_enabled() {
        let mut scheduler = ActivityScheduler::default();
        let c = config();
        assert!(c.pause_roaming);
        tick(&mut scheduler, 0, &c, false, true);
        assert_eq!(
            tick(&mut scheduler, 1000, &c, false, true),
            Some(ActivityAction::Waving)
        );
    }
    #[test]
    fn interaction_reminder_pause_or_reduced_motion_cancels_and_restarts_wait() {
        let mut s = ActivityScheduler::default();
        let c = config();
        tick(&mut s, 0, &c, false, false);
        tick(&mut s, 1000, &c, false, false);
        assert_eq!(tick(&mut s, 1100, &c, true, false), None);
        assert_eq!(tick(&mut s, 1200, &c, false, false), None);
        assert_eq!(tick(&mut s, 2199, &c, false, false), None);
        assert!(tick(&mut s, 2200, &c, false, false).is_some());
    }
    #[test]
    fn empty_actions_and_disable_cancel_immediately() {
        for empty in [false, true] {
            let mut s = ActivityScheduler::default();
            let mut c = config();
            tick(&mut s, 0, &c, false, false);
            tick(&mut s, 1000, &c, false, false);
            if empty {
                c.enabled_actions.clear();
            } else {
                c.enabled = false;
            }
            assert_eq!(tick(&mut s, 1100, &c, false, false), None);
            assert_eq!(s.due_at, None);
        }
    }
    #[test]
    fn removing_active_action_cancels_but_frequency_change_finishes_it() {
        let mut s = ActivityScheduler::default();
        let mut c = config();
        tick(&mut s, 0, &c, false, false);
        tick(&mut s, 1000, &c, false, false);
        c.frequency = ActivityFrequency::Quiet;
        assert_eq!(
            tick(&mut s, 1100, &c, false, false),
            Some(ActivityAction::Waving)
        );
        assert_eq!(tick(&mut s, 2400, &c, false, false), None);
        assert_eq!(s.due_at, Some(122400));
        c.frequency = ActivityFrequency::Custom;
        tick(&mut s, 2500, &c, false, false);
        let action = tick(&mut s, 3500, &c, false, false).unwrap();
        c.enabled_actions.retain(|a| *a != action);
        assert_eq!(tick(&mut s, 3600, &c, false, false), None);
        assert_eq!(s.due_at, Some(4600));
    }
    #[test]
    fn sleep_and_pet_switch_reset_without_catch_up() {
        let mut s = ActivityScheduler::default();
        let c = config();
        tick(&mut s, 0, &c, false, false);
        tick(&mut s, 1000, &c, false, false);
        assert_eq!(
            s.tick(1050, 60000, &c, &pet(), false, false, |min, _| min),
            None
        );
        assert_eq!(s.due_at, Some(2050));
        let other = SelectedPet {
            id: "other".into(),
            ..pet()
        };
        assert_eq!(
            s.tick(1100, 60050, &c, &other, false, false, |min, _| min),
            None
        );
        assert_eq!(s.due_at, Some(2100));
    }
    #[test]
    fn presets_supply_full_inclusive_range_and_single_action_can_repeat() {
        for (frequency, min, max) in [
            (ActivityFrequency::Quiet, 120000, 300000),
            (ActivityFrequency::Normal, 30000, 90000),
            (ActivityFrequency::Active, 10000, 30000),
        ] {
            let mut s = ActivityScheduler::default();
            let mut c = config();
            c.frequency = frequency;
            s.tick(0, 0, &c, &pet(), false, false, |lo, hi| {
                assert_eq!((lo, hi), (min, max));
                hi
            });
            assert_eq!(s.due_at, Some(max));
        }
        let mut s = ActivityScheduler::default();
        let mut c = config();
        c.enabled_actions = vec![ActivityAction::Waving];
        tick(&mut s, 0, &c, false, false);
        tick(&mut s, 1000, &c, false, false);
        tick(&mut s, 2400, &c, false, false);
        assert_eq!(
            tick(&mut s, 3400, &c, false, false),
            Some(ActivityAction::Waving)
        );
    }
}
