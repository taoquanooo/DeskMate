import { useEffect, useMemo, useState } from "react";
import { Heart } from "lucide-react";
import { petAssetUrl } from "../lib/tauri";
import { PetSprite } from "./PetSprite";

export interface PetThumbnailProps {
  displayName: string;
  spritesheetPath?: string | null;
  spriteVersionNumber?: 1 | 2;
  previewUrl?: string;
}

type AtlasAppearance = {
  spritesheetUrl: string;
  spriteVersionNumber: 1 | 2;
};

export function PetThumbnail({
  displayName,
  spritesheetPath,
  spriteVersionNumber = 2,
  previewUrl,
}: PetThumbnailProps) {
  const requestedAtlas = useMemo<AtlasAppearance>(
    () => ({
      spritesheetUrl: petAssetUrl(spritesheetPath),
      spriteVersionNumber,
    }),
    [spritesheetPath, spriteVersionNumber],
  );
  const [displayedAtlas, setDisplayedAtlas] = useState(requestedAtlas);
  const [failedAtlasUrl, setFailedAtlasUrl] = useState<string | null>(null);
  const [failedPreviewUrl, setFailedPreviewUrl] = useState<string | null>(null);
  const label = `${displayName}预览`;

  useEffect(() => {
    let mounted = true;
    const image = new Image();
    setFailedAtlasUrl((failedUrl) => (failedUrl === requestedAtlas.spritesheetUrl ? failedUrl : null));
    image.onload = () => {
      if (mounted) {
        setDisplayedAtlas(requestedAtlas);
        setFailedAtlasUrl((failedUrl) => (failedUrl === requestedAtlas.spritesheetUrl ? null : failedUrl));
      }
    };
    image.onerror = () => {
      if (mounted) setFailedAtlasUrl(requestedAtlas.spritesheetUrl);
    };
    image.src = requestedAtlas.spritesheetUrl;
    return () => {
      mounted = false;
    };
  }, [requestedAtlas]);

  useEffect(() => {
    setFailedPreviewUrl((failedUrl) => (failedUrl === previewUrl ? failedUrl : null));
  }, [previewUrl]);

  if (previewUrl) {
    if (failedPreviewUrl === previewUrl) return <UnavailableThumbnail label={label} />;
    return (
      <img
        alt={label}
        className="pet-thumbnail"
        onError={() => setFailedPreviewUrl(previewUrl)}
        onLoad={() => setFailedPreviewUrl((failedUrl) => (failedUrl === previewUrl ? null : failedUrl))}
        src={previewUrl}
      />
    );
  }

  if (failedAtlasUrl === requestedAtlas.spritesheetUrl) return <UnavailableThumbnail label={label} />;

  return (
    <div className="pet-thumbnail">
      <PetSprite
        ariaLabel={label}
        elapsedMs={0}
        scale={0.42}
        spriteVersionNumber={displayedAtlas.spriteVersionNumber}
        spritesheetUrl={displayedAtlas.spritesheetUrl}
        state="idle"
      />
    </div>
  );
}

function UnavailableThumbnail({ label }: { label: string }) {
  return (
    <div aria-label={`${label}暂不可用`} className="pet-thumbnail pet-thumbnail-placeholder" role="img">
      <Heart aria-hidden="true" fill="currentColor" size={28} />
    </div>
  );
}
