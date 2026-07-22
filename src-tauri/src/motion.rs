#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Point {
    pub x: f64,
    pub y: f64,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum DragDirection {
    Left,
    Right,
}

pub fn drag_direction(
    previous: Option<Point>,
    current: Point,
    threshold: f64,
) -> Option<DragDirection> {
    let delta = current.x - previous?.x;
    if delta > threshold {
        Some(DragDirection::Right)
    } else if delta < -threshold {
        Some(DragDirection::Left)
    } else {
        None
    }
}

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub struct DragObservation {
    pub moved: bool,
    pub start_visual: bool,
    pub direction: Option<DragDirection>,
}

#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct DragTracker {
    movement_origin: Option<Point>,
    direction_origin: Option<Point>,
    movement_reported: bool,
    visual_started: bool,
}

impl DragTracker {
    pub fn observe(
        &mut self,
        current: Point,
        threshold: f64,
        animate_direction: bool,
    ) -> DragObservation {
        let Some(movement_origin) = self.movement_origin else {
            self.movement_origin = Some(current);
            self.direction_origin = Some(current);
            let start_visual = animate_direction;
            self.visual_started = start_visual;
            return DragObservation {
                start_visual,
                ..DragObservation::default()
            };
        };

        let moved = !self.movement_reported
            && (current.x - movement_origin.x).hypot(current.y - movement_origin.y) > threshold;
        if moved {
            self.movement_reported = true;
        }

        let start_visual = animate_direction && !self.visual_started;
        if start_visual {
            self.visual_started = true;
        }
        let direction = animate_direction
            .then(|| drag_direction(self.direction_origin, current, threshold))
            .flatten();
        if direction.is_some() {
            self.direction_origin = Some(current);
        }

        DragObservation {
            moved,
            start_visual,
            direction,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct WorkArea {
    pub left: i32,
    pub top: i32,
    pub right: i32,
    pub bottom: i32,
}

pub fn clamp_to_work_area(point: Point, area: WorkArea, width: i32, height: i32) -> Point {
    Point {
        x: point
            .x
            .clamp(area.left as f64, (area.right - width).max(area.left) as f64),
        y: point
            .y
            .clamp(area.top as f64, (area.bottom - height).max(area.top) as f64),
    }
}

pub fn resize_around_bottom_center(
    position: Point,
    old_width: i32,
    old_height: i32,
    new_width: i32,
    new_height: i32,
    area: WorkArea,
) -> Point {
    clamp_to_work_area(
        Point {
            x: position.x + (old_width - new_width) as f64 / 2.0,
            y: position.y + (old_height - new_height) as f64,
        },
        area,
        new_width,
        new_height,
    )
}

pub fn step_toward(from: Point, to: Point, pixels: f64) -> Point {
    let dx = to.x - from.x;
    let dy = to.y - from.y;
    let distance = dx.hypot(dy);
    if distance <= pixels || distance == 0.0 {
        return to;
    }
    Point {
        x: from.x + dx / distance * pixels,
        y: from.y + dy / distance * pixels,
    }
}

#[cfg(test)]
mod tests {
    use super::{
        clamp_to_work_area, drag_direction, resize_around_bottom_center, step_toward,
        DragDirection, DragTracker, Point, WorkArea,
    };

    #[test]
    fn classifies_horizontal_drag_direction_and_ignores_jitter() {
        let from = Some(Point { x: 100.0, y: 50.0 });
        assert_eq!(
            drag_direction(from, Point { x: 104.0, y: 90.0 }, 2.0),
            Some(DragDirection::Right)
        );
        assert_eq!(
            drag_direction(from, Point { x: 96.0, y: 10.0 }, 2.0),
            Some(DragDirection::Left)
        );
        assert_eq!(drag_direction(from, Point { x: 101.0, y: 90.0 }, 2.0), None);
        assert_eq!(drag_direction(None, Point { x: 104.0, y: 90.0 }, 2.0), None);
    }

    #[test]
    fn recognizes_vertical_drag_movement_from_the_drag_origin() {
        let mut tracker = DragTracker::default();
        let initial = tracker.observe(Point { x: 10.0, y: 10.0 }, 2.0, true);
        assert!(!initial.moved);
        assert!(initial.start_visual);

        let observation = tracker.observe(Point { x: 10.0, y: 13.0 }, 2.0, true);

        assert!(observation.moved);
        assert_eq!(observation.direction, None);
    }

    #[test]
    fn accumulates_small_samples_without_moving_the_drag_origin() {
        let mut tracker = DragTracker::default();
        assert!(!tracker.observe(Point { x: 10.0, y: 10.0 }, 2.0, true).moved);
        assert!(
            !tracker
                .observe(Point { x: 11.25, y: 10.0 }, 2.0, true)
                .moved
        );

        let observation = tracker.observe(Point { x: 12.5, y: 10.0 }, 2.0, true);

        assert!(observation.moved);
        assert_eq!(observation.direction, Some(DragDirection::Right));
    }

    #[test]
    fn recognizes_roaming_enabled_drag_without_requesting_direction_animation() {
        let mut tracker = DragTracker::default();
        let initial = tracker.observe(Point { x: 10.0, y: 10.0 }, 2.0, false);

        let observation = tracker.observe(Point { x: 14.0, y: 10.0 }, 2.0, false);

        assert!(!initial.start_visual);
        assert!(observation.moved);
        assert!(!observation.start_visual);
        assert_eq!(observation.direction, None);
    }

    #[test]
    fn clamps_inside_negative_coordinate_work_area() {
        let area = WorkArea {
            left: -1920,
            top: -80,
            right: 0,
            bottom: 1000,
        };
        assert_eq!(
            clamp_to_work_area(
                Point {
                    x: -2100.0,
                    y: 980.0
                },
                area,
                192,
                208
            ),
            Point {
                x: -1920.0,
                y: 792.0
            },
        );
    }

    #[test]
    fn advances_at_constant_speed_without_overshooting() {
        assert_eq!(
            step_toward(Point { x: 0.0, y: 0.0 }, Point { x: 30.0, y: 40.0 }, 10.0),
            Point { x: 6.0, y: 8.0 }
        );
        assert_eq!(
            step_toward(Point { x: 28.0, y: 39.0 }, Point { x: 30.0, y: 40.0 }, 10.0),
            Point { x: 30.0, y: 40.0 }
        );
    }

    #[test]
    fn resize_preserves_bottom_center_and_clamps_to_negative_work_area() {
        let area = WorkArea {
            left: -1920,
            top: 0,
            right: 0,
            bottom: 1040,
        };
        assert_eq!(
            resize_around_bottom_center(
                Point {
                    x: -300.0,
                    y: 700.0,
                },
                192,
                208,
                576,
                624,
                area,
            ),
            Point {
                x: -576.0,
                y: 284.0,
            }
        );
    }

    #[test]
    fn resize_clamps_the_larger_window_inside_the_work_area() {
        let area = WorkArea {
            left: 0,
            top: 0,
            right: 1920,
            bottom: 1040,
        };
        assert_eq!(
            resize_around_bottom_center(
                Point {
                    x: 1750.0,
                    y: 850.0,
                },
                192,
                208,
                576,
                624,
                area,
            ),
            Point {
                x: 1344.0,
                y: 416.0,
            }
        );
    }
}
