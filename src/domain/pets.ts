export interface PetManifestV2 {
  id: string;
  displayName: string;
  description: string;
  spriteVersionNumber: 2;
  spritesheetPath: "spritesheet.webp";
}

export interface PetCatalogEntryV1 {
  id: string;
  version: string;
  displayName: string;
  description: string;
  author: string;
  assetLicense: string;
  spriteVersionNumber: 2;
  minAppVersion: string;
  previewUrl: string;
  packageUrl: string;
  sha256: string;
  sizeBytes: number;
}

export interface PetCatalogV1 {
  schemaVersion: 1;
  generatedAt: string;
  pets: PetCatalogEntryV1[];
}

export interface LocalPetV1 {
  id: string;
  version: "local";
  displayName: string;
  description: string;
  folderName: string;
  spriteVersionNumber: 1 | 2;
}

export interface LocalPetScanV1 {
  folderPath: string;
  pets: LocalPetV1[];
  errors: string[];
}

export type StandardAnimationState =
  | "idle"
  | "running-right"
  | "running-left"
  | "waving"
  | "jumping"
  | "failed"
  | "waiting"
  | "running"
  | "review";

export interface AnimationRow {
  row: number;
  state: StandardAnimationState | "look-a" | "look-b";
  durations: number[];
  directions: number[];
}

export const ANIMATION_ROWS: readonly AnimationRow[] = [
  { row: 0, state: "idle", durations: [280, 110, 110, 140, 140, 320], directions: [] },
  { row: 1, state: "running-right", durations: [120, 120, 120, 120, 120, 120, 120, 220], directions: [] },
  { row: 2, state: "running-left", durations: [120, 120, 120, 120, 120, 120, 120, 220], directions: [] },
  { row: 3, state: "waving", durations: [140, 140, 140, 280], directions: [] },
  { row: 4, state: "jumping", durations: [140, 140, 140, 140, 280], directions: [] },
  { row: 5, state: "failed", durations: [140, 140, 140, 140, 140, 140, 140, 240], directions: [] },
  { row: 6, state: "waiting", durations: [150, 150, 150, 150, 150, 260], directions: [] },
  { row: 7, state: "running", durations: [120, 120, 120, 120, 120, 220], directions: [] },
  { row: 8, state: "review", durations: [150, 150, 150, 150, 150, 280], directions: [] },
  { row: 9, state: "look-a", durations: [], directions: [0, 22.5, 45, 67.5, 90, 112.5, 135, 157.5] },
  { row: 10, state: "look-b", durations: [], directions: [180, 202.5, 225, 247.5, 270, 292.5, 315, 337.5] },
] as const;

export type ValidationResult = { ok: true } | { ok: false; error: string };

export function validatePetManifest(value: unknown): ValidationResult {
  if (!isRecord(value)) return { ok: false, error: "manifest must be an object" };
  if (value.spriteVersionNumber !== 2) {
    return { ok: false, error: "spriteVersionNumber must be 2" };
  }
  if (value.spritesheetPath !== "spritesheet.webp") {
    return { ok: false, error: "spritesheetPath must be spritesheet.webp" };
  }
  for (const field of ["id", "displayName", "description"] as const) {
    if (typeof value[field] !== "string" || value[field].trim() === "") {
      return { ok: false, error: `${field} must be a non-empty string` };
    }
  }
  if (!/^[a-z0-9][a-z0-9-]*$/.test(value.id as string)) {
    return { ok: false, error: "id must use lowercase letters, numbers, and hyphens" };
  }
  return { ok: true };
}

export function validateCatalog(value: unknown): PetCatalogV1 {
  if (!isRecord(value) || value.schemaVersion !== 1 || !Array.isArray(value.pets)) {
    throw new Error("catalog must use schemaVersion 1");
  }
  if (typeof value.generatedAt !== "string" || Number.isNaN(Date.parse(value.generatedAt))) {
    throw new Error("generatedAt must be an ISO date");
  }
  const seen = new Set<string>();
  const pets = value.pets.map((entry) => validateCatalogEntry(entry, seen));
  return { schemaVersion: 1, generatedAt: value.generatedAt, pets };
}

function validateCatalogEntry(value: unknown, seen: Set<string>): PetCatalogEntryV1 {
  if (!isRecord(value)) throw new Error("catalog pet must be an object");
  const stringFields = [
    "id",
    "version",
    "displayName",
    "description",
    "author",
    "assetLicense",
    "minAppVersion",
    "previewUrl",
    "packageUrl",
    "sha256",
  ] as const;
  for (const field of stringFields) {
    if (typeof value[field] !== "string" || value[field].trim() === "") {
      throw new Error(`${field} must be a non-empty string`);
    }
  }
  if (value.spriteVersionNumber !== 2) throw new Error("spriteVersionNumber must be 2");
  if (!Number.isSafeInteger(value.sizeBytes) || (value.sizeBytes as number) <= 0) {
    throw new Error("sizeBytes must be a positive integer");
  }
  for (const field of ["previewUrl", "packageUrl"] as const) {
    const url = new URL(value[field] as string);
    if (url.protocol !== "https:") throw new Error(`${field} must use HTTPS`);
  }
  if (!/^[a-f0-9]{64}$/i.test(value.sha256 as string)) {
    throw new Error("sha256 must contain 64 hexadecimal characters");
  }
  const key = `${value.id}@${value.version}`;
  if (seen.has(key)) throw new Error(`duplicate catalog entry ${key}`);
  seen.add(key);
  return value as unknown as PetCatalogEntryV1;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
