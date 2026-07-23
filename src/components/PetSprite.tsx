import { frameAtElapsedTime, normalizeGazeAngle, type AnimationState } from "../domain/animation";
import { ANIMATION_ROWS } from "../domain/pets";

const LABELS: Record<Exclude<AnimationState, "look">, string> = {
  idle: "桌宠正在休息",
  "running-right": "桌宠正在向右移动",
  "running-left": "桌宠正在向左移动",
  waving: "桌宠正在挥手",
  jumping: "桌宠正在跳跃",
  failed: "桌宠遇到了一点问题",
  waiting: "桌宠正在等待",
  running: "桌宠正在处理",
  review: "桌宠已经完成",
};

export interface PetSpriteProps {
  state: AnimationState;
  elapsedMs?: number;
  directionDegrees?: number;
  scale?: number;
  className?: string;
  ariaLabel?: string;
  spritesheetUrl?: string;
  spriteVersionNumber?: 1 | 2;
}

export function PetSprite({
  state,
  elapsedMs = 0,
  directionDegrees = 0,
  scale = 1,
  className = "",
  ariaLabel,
  spritesheetUrl = "/pets/yanghao/spritesheet.webp",
  spriteVersionNumber = 2,
}: PetSpriteProps) {
  const effectiveState = state === "look" && spriteVersionNumber === 1 ? "idle" : state;
  const cell =
    effectiveState === "look" ? lookCell(directionDegrees) : standardCell(effectiveState, elapsedMs);
  const direction = normalizeGazeAngle(directionDegrees);
  const label = effectiveState === "look" ? `桌宠正在看向 ${direction}°` : LABELS[effectiveState];

  // Size the sprite through layout (not CSS transform) so the rendered box
  // always matches the native window exactly — transform scaling leaves the
  // layout box at 192x208 and lets rounding/origin drift clip the sprite at
  // extreme scales.
  return (
    <div
      aria-label={ariaLabel ?? label}
      className={`pet-sprite ${className}`.trim()}
      data-row={cell.row}
      data-column={cell.column}
      role="img"
      style={{
        width: `${192 * scale}px`,
        height: `${208 * scale}px`,
        backgroundImage: `url(${spritesheetUrl})`,
        backgroundPosition: `${-cell.column * 192 * scale}px ${-cell.row * 208 * scale}px`,
        backgroundSize: `${1536 * scale}px ${(spriteVersionNumber === 1 ? 1872 : 2288) * scale}px`,
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
