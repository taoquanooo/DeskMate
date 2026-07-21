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
    use super::{clamp_to_work_area, step_toward, Point, WorkArea};

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
}
