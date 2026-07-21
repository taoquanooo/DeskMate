import { frameAtElapsedTime, normalizeGazeAngle, type AnimationState } from "../domain/animation";
import { ANIMATION_ROWS } from "../domain/pets";

const LABELS: Record<Exclude<AnimationState, "look">, string> = {
  idle: "杨皓正在休息",
  "running-right": "杨皓正在向右移动",
  "running-left": "杨皓正在向左移动",
  waving: "杨皓正在挥手",
  jumping: "杨皓正在跳跃",
  failed: "杨皓遇到了一点问题",
  waiting: "杨皓正在等待",
  running: "杨皓正在处理",
  review: "杨皓已经完成",
};

export interface PetSpriteProps {
  state: AnimationState;
  elapsedMs?: number;
  directionDegrees?: number;
  scale?: number;
  className?: string;
  spritesheetUrl?: string;
}

export function PetSprite({
  state,
  elapsedMs = 0,
  directionDegrees = 0,
  scale = 1,
  className = "",
  spritesheetUrl = "/pets/yanghao/spritesheet.webp",
}: PetSpriteProps) {
  const cell = state === "look" ? lookCell(directionDegrees) : standardCell(state, elapsedMs);
  const direction = normalizeGazeAngle(directionDegrees);
  const label = state === "look" ? `杨皓正在看向 ${direction}°` : LABELS[state];

  return (
    <div
      aria-label={label}
      className={`pet-sprite ${className}`.trim()}
      data-row={cell.row}
      data-column={cell.column}
      role="img"
      style={{
        backgroundImage: `url(${spritesheetUrl})`,
        backgroundPosition: `${-cell.column * 192}px ${-cell.row * 208}px`,
        transform: `scale(${scale})`,
      }}
    />
  );
}

function standardCell(state: Exclude<AnimationState, "look">, elapsedMs: number) {
  const row = ANIMATION_ROWS.find((candidate) => candidate.state === state);
  return { row: row?.row ?? 0, column: frameAtElapsedTime(state, elapsedMs) };
}

function lookCell(directionDegrees: number) {
  const direction = normalizeGazeAngle(directionDegrees);
  if (direction < 180) return { row: 9, column: Math.round(direction / 22.5) };
  return { row: 10, column: Math.round((direction - 180) / 22.5) };
}
