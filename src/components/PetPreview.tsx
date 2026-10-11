import { useEffect, useMemo, useState } from "react";
import type { AnimationState } from "../domain/animation";
import { activityDurationMs, type ActivityAction } from "../domain/activities";
import { BUILT_IN_PETS, petAssetUrl, type PetChangedPayload } from "../lib/tauri";
import { PetSprite } from "./PetSprite";

const SHOWCASE_DURATION_MS = 6_000;
const DEFAULT_BUILT_IN_APPEARANCE = {
  spritesheetUrl: BUILT_IN_PETS[0].spritesheetUrl,
  spriteVersionNumber: BUILT_IN_PETS[0].spriteVersionNumber,
};

type PreviewAppearance = {
  spritesheetUrl: string;
  spriteVersionNumber: 1 | 2;
};

export function PetPreview({
  pet,
  displayName,
  action,
}: {
  pet: PetChangedPayload;
  displayName: string;
  action?: ActivityAction | "idle";
}) {
  const [elapsedMs, setElapsedMs] = useState(0);
  const [appearance, setAppearance] = useState<PreviewAppearance>(DEFAULT_BUILT_IN_APPEARANCE);
  const [loadedPet, setLoadedPet] = useState<string | null>(null);
  const [loadError, setLoadError] = useState(false);
  const petKey = `${pet.id}:${pet.version}:${pet.spritesheetPath}:${pet.spriteVersionNumber}:${pet.assetRevision}`;
  const ready = loadedPet === petKey;

  useEffect(() => {
    if (action === "idle" || !ready) return;
    setElapsedMs(0);
    const start = performance.now();
    const duration = action ? activityDurationMs(action) : Infinity;
    const timer = window.setInterval(
      () => {
        const elapsed = performance.now() - start;
        setElapsedMs(elapsed);
        if (elapsed >= duration) window.clearInterval(timer);
      },
      action ? 16 : 100,
    );
    return () => window.clearInterval(timer);
  }, [action, ready]);

  useEffect(() => {
    setLoadError(false);
    if (!pet.spritesheetPath) {
      const builtIn = BUILT_IN_PETS.find((candidate) => candidate.id === pet.id);
      setAppearance(
        builtIn
          ? { spritesheetUrl: builtIn.spritesheetUrl, spriteVersionNumber: builtIn.spriteVersionNumber }
          : DEFAULT_BUILT_IN_APPEARANCE,
      );
      setLoadedPet(petKey);
      return;
    }

    let active = true;
    const spritesheetUrl = petAssetUrl(pet.spritesheetPath, pet.id, pet.assetRevision);
    const image = new Image();
    image.onload = () => {
      if (active) {
        setAppearance({ spritesheetUrl, spriteVersionNumber: pet.spriteVersionNumber });
        setLoadedPet(petKey);
      }
    };
    image.onerror = () => {
      if (active) setLoadError(true);
    };
    image.src = spritesheetUrl;
    return () => {
      active = false;
    };
  }, [pet.id, pet.spriteVersionNumber, pet.spritesheetPath, petKey]);

  const animation = useMemo(() => {
    if (!action) return showcaseAnimation(elapsedMs);
    if (action === "idle" || elapsedMs >= activityDurationMs(action)) {
      return { state: "idle" as const, elapsedMs: 0 };
    }
    return { state: action, elapsedMs };
  }, [action, elapsedMs]);
  const versionLabel = pet.version === "local" ? "local" : `v${pet.version}`;

  return (
    <>
      <div className="sprite-stage">
        {!ready ? (
          <p role="status">{loadError ? "预览图暂时无法载入" : "正在载入预览…"}</p>
        ) : (
          <PetSprite
            state={animation.state}
            elapsedMs={animation.elapsedMs}
            scale={1}
            spritesheetUrl={appearance.spritesheetUrl}
            spriteVersionNumber={appearance.spriteVersionNumber}
          />
        )}
      </div>
      <div className="pet-identity">
        <strong>
          {displayName} · {versionLabel}
        </strong>
        <span>
          <i className="status-dot" />
          {action ? "动作预览 · 不影响桌面宠物" : "动画展示中"}
        </span>
      </div>
    </>
  );
}

function showcaseAnimation(elapsedMs: number): { state: AnimationState; elapsedMs: number } {
  const elapsed = elapsedMs % SHOWCASE_DURATION_MS;
  if (elapsed < 3_000) return { state: "idle", elapsedMs: elapsed };
  if (elapsed < 3_900) return { state: "waving", elapsedMs: elapsed - 3_000 };
  if (elapsed < 4_500) return { state: "idle", elapsedMs: elapsed - 3_900 };
  if (elapsed < 5_500) return { state: "jumping", elapsedMs: elapsed - 4_500 };
  return { state: "idle", elapsedMs: elapsed - 5_500 };
}
