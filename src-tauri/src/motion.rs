#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Point {
    pub x: f64,
    pub y: f64,
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
    use super::{clamp_to_work_area, resize_around_bottom_center, step_toward, Point, WorkArea};

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
                x: -492.0,
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
