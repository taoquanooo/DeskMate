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

const CONTEXT_ACTIONS = [
  { state: "waving", duration: 900 },
  { state: "waiting", duration: 1_100 },
  { state: "review", duration: 1_050 },
] as const;

type InteractionState = "jumping" | (typeof CONTEXT_ACTIONS)[number]["state"];

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
  const activeInteraction = useRef<{ state: InteractionState; startedAt: number } | undefined>(undefined);
  const dragActive = useRef(false);
  const dragMoved = useRef(false);
  const pointerStart = useRef<{ x: number; y: number } | undefined>(undefined);
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
    let cancelled = false;
    const disposers: Array<() => void> = [];
    const track = (promise: Promise<() => void>) => {
      void promise.then((dispose) => {
        if (cancelled) dispose();
        else disposers.push(dispose);
      });
    };
    void settingsGet()
      .then((settings) => setScale(settings.pet.scale))
      .catch(() => undefined);
    void petCurrent()
      .then((pet) =>
        setPetAppearance({
          spritesheetUrl: petAssetUrl(pet.spritesheetPath, pet.id),
          spriteVersionNumber: pet.spriteVersionNumber,
        }),
      )
      .catch(() => undefined);
    track(
      listenEvent<RuntimeAnimationPayload>("runtime://animation", (payload) => {
        if (!VALID_STATES.has(payload.state as AnimationState)) return;
        const next = {
          state: payload.state as AnimationState,
          directionDegrees: payload.directionDegrees,
        };
        resumeAnimation.current = next;
        if (interactionActive.current || dragActive.current) return;
        setAnimation({
          ...next,
          startedAt: performance.now(),
        });
      }),
    );
    track(
      listenEvent<RuntimeAnimationPayload>("runtime://drag-animation", (payload) => {
        if (!VALID_STATES.has(payload.state as AnimationState)) return;
        dragActive.current = true;
        setAnimation({
          state: payload.state as AnimationState,
          directionDegrees: payload.directionDegrees,
          startedAt: performance.now(),
        });
      }),
    );
    track(
      listenEvent("runtime://drag-moved", () => {
        window.clearTimeout(singleClickTimer.current);
        dragMoved.current = true;
      }),
    );
    track(
      listenEvent("runtime://drag-ended", () => {
        dragActive.current = false;
        if (interactionActive.current && activeInteraction.current) {
          setAnimation(activeInteraction.current);
          return;
        }
        setAnimation({ ...resumeAnimation.current, startedAt: performance.now() });
      }),
    );
    track(
      listenEvent<PetChangedPayload>("pet://changed", (payload) =>
        setPetAppearance({
          spritesheetUrl: petAssetUrl(payload.spritesheetPath, payload.id),
          spriteVersionNumber: payload.spriteVersionNumber,
        }),
      ),
    );
    track(listenEvent<number>("settings://scale", (value) => setScale(value)));
    return () => {
      cancelled = true;
      disposers.forEach((dispose) => dispose());
      window.clearTimeout(singleClickTimer.current);
      window.clearTimeout(interactionTimer.current);
      if (interactionActive.current) {
        interactionActive.current = false;
        activeInteraction.current = undefined;
        dragActive.current = false;
        void emitEvent("runtime://interaction", false);
      }
    };
  }, []);

  const playInteraction = (state: InteractionState, duration: number) => {
    window.clearTimeout(interactionTimer.current);
    interactionActive.current = true;
    void emitEvent("runtime://interaction", true);
    const interaction = { state, startedAt: performance.now() };
    activeInteraction.current = interaction;
    setAnimation(interaction);
    interactionTimer.current = window.setTimeout(() => {
      interactionActive.current = false;
      activeInteraction.current = undefined;
      if (!dragActive.current) {
        setAnimation({ ...resumeAnimation.current, startedAt: performance.now() });
      }
      void emitEvent("runtime://interaction", false);
    }, duration);
  };

  const handleClick = () => {
    window.clearTimeout(singleClickTimer.current);
    if (dragMoved.current) {
      dragMoved.current = false;
      return;
    }
    singleClickTimer.current = window.setTimeout(() => playInteraction("jumping", 1_000), 230);
  };

  const handleDoubleClick = () => {
    window.clearTimeout(singleClickTimer.current);
    playInteraction("waving", 900);
  };

  const handleContextMenu = (event: React.MouseEvent) => {
    event.preventDefault();
    window.clearTimeout(singleClickTimer.current);
    const action = CONTEXT_ACTIONS[Math.floor(Math.random() * CONTEXT_ACTIONS.length)]!;
    playInteraction(action.state, action.duration);
  };

  const handleWindowDrag = async () => {
    await emitEvent("runtime://dragging", true);
    await startWindowDrag();
    // The OS drag continues after startWindowDrag resolves (notably on Windows).
    // The backend clears the dragging flag once the left mouse button is released,
    // so we deliberately don't emit false here — doing so would clear the flag
    // while the drag is still in flight and let the motion engine fight the cursor.
  };

  const handlePointerMove = (event: React.PointerEvent) => {
    // Start a native window drag only after the pointer moves beyond a small
    // threshold so that simple clicks (jump/wave) are not swallowed by the
    // OS drag loop.
    if (pointerStart.current) {
      const dx = event.clientX - pointerStart.current.x;
      const dy = event.clientY - pointerStart.current.y;
      if (Math.abs(dx) > 4 || Math.abs(dy) > 4) {
        pointerStart.current = undefined;
        void handleWindowDrag();
        return;
      }
    }
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
        if (event.button === 0) {
          dragMoved.current = false;
          pointerStart.current = { x: event.clientX, y: event.clientY };
        }
      }}
      onPointerUp={() => {
        pointerStart.current = undefined;
      }}
      onContextMenu={handleContextMenu}
      onPointerMove={handlePointerMove}
      onPointerLeave={() => {
        pointerStart.current = undefined;
        setAnimation((current) =>
          current.state === "look" ? { ...resumeAnimation.current, startedAt: performance.now() } : current,
        );
      }}
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
