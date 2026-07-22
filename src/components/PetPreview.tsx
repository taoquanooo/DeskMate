import { useEffect, useMemo, useState } from "react";
import type { AnimationState } from "../domain/animation";
import { petAssetUrl, type PetChangedPayload } from "../lib/tauri";
import { PetSprite } from "./PetSprite";

const SHOWCASE_DURATION_MS = 6_000;
const BUILT_IN_APPEARANCE = {
  spritesheetUrl: "/pets/yanghao/spritesheet.webp",
  spriteVersionNumber: 2 as const,
};

type PreviewAppearance = {
  spritesheetUrl: string;
  spriteVersionNumber: 1 | 2;
};

export function PetPreview({ pet, displayName }: { pet: PetChangedPayload; displayName: string }) {
  const [elapsedMs, setElapsedMs] = useState(0);
  const [appearance, setAppearance] = useState<PreviewAppearance>(BUILT_IN_APPEARANCE);

  useEffect(() => {
    const timer = window.setInterval(() => setElapsedMs((elapsed) => elapsed + 100), 100);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!pet.spritesheetPath) {
      setAppearance(BUILT_IN_APPEARANCE);
      return;
    }

    let active = true;
    const spritesheetUrl = petAssetUrl(pet.spritesheetPath);
    const image = new Image();
    image.onload = () => {
      if (active) {
        setAppearance({ spritesheetUrl, spriteVersionNumber: pet.spriteVersionNumber });
      }
    };
    image.onerror = () => undefined;
    image.src = spritesheetUrl;
    return () => {
      active = false;
    };
  }, [pet.spriteVersionNumber, pet.spritesheetPath]);

  const animation = useMemo(() => showcaseAnimation(elapsedMs), [elapsedMs]);
  const versionLabel = pet.version === "local" ? "local" : `v${pet.version}`;

  return (
    <>
      <div className="sprite-stage">
        <PetSprite
          state={animation.state}
          elapsedMs={animation.elapsedMs}
          scale={1}
          spritesheetUrl={appearance.spritesheetUrl}
          spriteVersionNumber={appearance.spriteVersionNumber}
        />
      </div>
      <div className="pet-identity">
        <strong>
          {displayName} · {versionLabel}
        </strong>
        <span>
          <i className="status-dot" />
          动画展示中
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
