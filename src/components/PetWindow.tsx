import { useEffect, useRef, useState } from "react";
import { gazeAngleFromVector, type AnimationState } from "../domain/animation";
import {
  emitEvent,
  listenEvent,
  petAssetUrl,
  petCurrent,
  settingsGet,
  startWindowDrag,
  type PetChangedPayload,
  type RuntimeAnimationPayload,
} from "../lib/tauri";
import { PetSprite } from "./PetSprite";

const VALID_STATES = new Set<AnimationState>([
  "idle",
  "running-right",
  "running-left",
  "waving",
  "jumping",
  "failed",
  "waiting",
  "running",
  "review",
  "look",
]);

export function PetWindow() {
  const [animation, setAnimation] = useState<{
    state: AnimationState;
    directionDegrees?: number;
    startedAt: number;
  }>({ state: "idle", startedAt: performance.now() });
  const [elapsedMs, setElapsedMs] = useState(0);
  const [scale, setScale] = useState(1);
  const [petAppearance, setPetAppearance] = useState<{
    spritesheetUrl: string;
    spriteVersionNumber: 1 | 2;
  }>({ spritesheetUrl: "/pets/yanghao/spritesheet.webp", spriteVersionNumber: 2 });
  const singleClickTimer = useRef<number | undefined>(undefined);
  const interactionTimer = useRef<number | undefined>(undefined);
  const interactionActive = useRef(false);
  const resumeAnimation = useRef<{
    state: AnimationState;
    directionDegrees?: number;
  }>({ state: "idle" });

  useEffect(() => {
    let frame = 0;
    let active = true;
    const tick = (now: number) => {
      if (!active) return;
      setElapsedMs(now - animation.startedAt);
      frame = window.requestAnimationFrame(tick);
    };
    frame = window.requestAnimationFrame(tick);
    return () => {
      active = false;
      window.cancelAnimationFrame(frame);
    };
  }, [animation.startedAt]);

  useEffect(() => {
    let unlistenAnimation: () => void = () => undefined;
    let unlistenPet: () => void = () => undefined;
    void settingsGet().then((settings) => setScale(settings.pet.scale));
    void petCurrent().then((pet) =>
      setPetAppearance({
        spritesheetUrl: petAssetUrl(pet.spritesheetPath),
        spriteVersionNumber: pet.spriteVersionNumber,
      }),
    );
    void listenEvent<RuntimeAnimationPayload>("runtime://animation", (payload) => {
      if (!VALID_STATES.has(payload.state as AnimationState)) return;
      const next = {
        state: payload.state as AnimationState,
        directionDegrees: payload.directionDegrees,
      };
      resumeAnimation.current = next;
      if (interactionActive.current) return;
      setAnimation({
        ...next,
        startedAt: performance.now(),
      });
    }).then((dispose) => {
      unlistenAnimation = dispose;
    });
    void listenEvent<PetChangedPayload>("pet://changed", (payload) =>
      setPetAppearance({
        spritesheetUrl: petAssetUrl(payload.spritesheetPath),
        spriteVersionNumber: payload.spriteVersionNumber,
      }),
    ).then((dispose) => {
      unlistenPet = dispose;
    });
    return () => {
      window.clearTimeout(singleClickTimer.current);
      window.clearTimeout(interactionTimer.current);
      unlistenAnimation();
      unlistenPet();
    };
  }, []);

  const playInteraction = (state: "waving" | "jumping", duration: number) => {
    window.clearTimeout(interactionTimer.current);
    interactionActive.current = true;
    void emitEvent("runtime://interaction", true);
    setAnimation({ state, startedAt: performance.now() });
    interactionTimer.current = window.setTimeout(() => {
      interactionActive.current = false;
      setAnimation({ ...resumeAnimation.current, startedAt: performance.now() });
      void emitEvent("runtime://interaction", false);
    }, duration);
  };

  const handleClick = () => {
    window.clearTimeout(singleClickTimer.current);
    singleClickTimer.current = window.setTimeout(() => playInteraction("waving", 900), 230);
  };

  const handleDoubleClick = () => {
    window.clearTimeout(singleClickTimer.current);
    playInteraction("jumping", 1_000);
  };

  const handleWindowDrag = async () => {
    await emitEvent("runtime://dragging", true);
    try {
      await startWindowDrag();
    } finally {
      await emitEvent("runtime://dragging", false);
    }
  };

  const handlePointerMove = (event: React.PointerEvent) => {
    if (petAppearance.spriteVersionNumber === 1) return;
    if (animation.state !== "idle" && animation.state !== "look") return;
    const rect = event.currentTarget.getBoundingClientRect();
    const directionDegrees = gazeAngleFromVector(
      event.clientX - (rect.left + rect.width / 2),
      event.clientY - (rect.top + rect.height * 0.42),
    );
    setAnimation((current) =>
      current.state === "look" && current.directionDegrees === directionDegrees
        ? current
        : { state: "look", directionDegrees, startedAt: performance.now() },
    );
  };

  return (
    <main
      className="pet-window"
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
      onPointerDown={(event) => {
        if (event.button === 0) void handleWindowDrag();
      }}
      onPointerMove={handlePointerMove}
      onPointerLeave={() => setAnimation({ state: "idle", startedAt: performance.now() })}
      aria-label="DeskMate 桌宠窗口"
    >
      <PetSprite
        state={animation.state}
        directionDegrees={animation.directionDegrees}
        elapsedMs={elapsedMs}
        scale={scale}
        spritesheetUrl={petAppearance.spritesheetUrl}
        spriteVersionNumber={petAppearance.spriteVersionNumber}
      />
    </main>
  );
}
