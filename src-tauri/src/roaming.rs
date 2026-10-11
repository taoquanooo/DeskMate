use crate::settings::RoamingTiming;

/// Window movement and activity scheduling use the same phase decision.
#[derive(Default)]
pub struct RoamingScheduler {
    phase: Option<(bool, u64)>,
    config: Option<RoamingTiming>,
    last_wall: Option<i64>,
}

impl RoamingScheduler {
    pub fn tick(
        &mut self,
        now: u64,
        wall: i64,
        config: &RoamingTiming,
        blocked: bool,
        arrived: bool,
        mut choose: impl FnMut(u64, u64) -> u64,
    ) -> bool {
        let interrupted = self
            .last_wall
            .is_some_and(|last| !(0..=2000).contains(&wall.saturating_sub(last)));
        self.last_wall = Some(wall);
        if blocked || interrupted || self.config.as_ref() != Some(config) {
            self.phase = None;
        }
        self.config = Some(config.clone());
        if blocked {
            return false;
        }
        match self.phase {
            Some((true, until)) if arrived || now >= until => {
                self.phase = Some((
                    false,
                    now + choose(
                        u64::from(config.pause_min_seconds) * 1000,
                        u64::from(config.pause_max_seconds) * 1000,
                    ),
                ));
                false
            }
            Some((false, until)) if now < until => false,
            Some((true, _)) => true,
            _ => {
                self.phase = Some((
                    true,
                    now + choose(
                        u64::from(config.walk_min_seconds) * 1000,
                        u64::from(config.walk_max_seconds) * 1000,
                    ),
                ));
                true
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn tick(s: &mut RoamingScheduler, now: u64, blocked: bool, arrived: bool) -> bool {
        s.tick(
            now,
            now as i64,
            &RoamingTiming {
                walk_min_seconds: 1,
                walk_max_seconds: 1,
                pause_min_seconds: 2,
                pause_max_seconds: 2,
            },
            blocked,
            arrived,
            |min, _| min,
        )
    }
    #[test]
    fn walks_then_rests_on_deadline_or_arrival() {
        let mut s = RoamingScheduler::default();
        assert!(tick(&mut s, 0, false, false));
        assert!(!tick(&mut s, 1000, false, false));
        assert!(!tick(&mut s, 2000, false, false));
        assert!(tick(&mut s, 3000, false, false));
        assert!(!tick(&mut s, 3100, false, true));
    }
    #[test]
    fn blockers_and_sleep_start_a_fresh_walk() {
        let mut s = RoamingScheduler::default();
        assert!(tick(&mut s, 0, false, false));
        assert!(!tick(&mut s, 500, true, false));
        assert!(tick(&mut s, 600, false, false));
        assert!(tick(&mut s, 10_000, false, false));
    }
    #[test]
    fn samples_both_ranges_and_resumes_after_activity_finishes() {
        let mut scheduler = RoamingScheduler::default();
        let config = RoamingTiming::default();
        let mut ranges = Vec::new();
        let mut choose = |min, max| {
            ranges.push((min, max));
            max
        };
        assert!(scheduler.tick(0, 0, &config, false, false, &mut choose));
        // The wall-clock moves normally; controlled monotonic time reaches the deadline.
        assert!(!scheduler.tick(45_000, 100, &config, false, false, &mut choose));
        assert!(!scheduler.tick(54_999, 200, &config, false, false, &mut choose));
        assert!(scheduler.tick(55_000, 300, &config, false, false, &mut choose));
        assert!(!scheduler.tick(55_100, 400, &config, true, false, &mut choose));
        assert!(scheduler.tick(56_500, 500, &config, false, false, &mut choose));
        assert_eq!(
            ranges,
            vec![
                (15_000, 45_000),
                (3000, 10_000),
                (15_000, 45_000),
                (15_000, 45_000)
            ]
        );
    }
}
