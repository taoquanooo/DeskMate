import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { emit, listen, type UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { LocalPetScanV1, PetCatalogV1 } from "../domain/pets";
import { DEFAULT_SETTINGS, mergeSettings, type SettingsV1 } from "../domain/settings";

export interface RuntimeAnimationPayload {
  state: string;
  directionDegrees?: number;
}

export interface BubblePayload {
  reminderIds: string[];
  title: string;
  message: string;
}

export interface UpdateStatus {
  available: boolean;
  version?: string;
  notes?: string;
}

export interface PetChangedPayload {
  id: string;
  version: string;
  spriteVersionNumber: 1 | 2;
  spritesheetPath?: string | null;
}

export const PROJECT_URL = "https://github.com/taoquanooo/DeskMate";
export const PET_GALLERY_URL = "https://codex-pet.org/zh/";
export const PETDEX_URL = "https://petdex.dev/";

export const BUILT_IN_PETS = [
  {
    id: "yanghao",
    version: "1.0.0",
    displayName: "默认伙伴",
    description:
      "一位友善Q版骑行者形象：留着黑色短发，戴着长方形眼镜，佩戴一只白色耳塞，身穿宽松的白色衬衫和灰色短裤，脚蹬浅色运动鞋。",
    spriteVersionNumber: 2 as const,
    spritesheetUrl: "/pets/yanghao/spritesheet.webp",
  },
  {
    id: "lev-neon",
    version: "1.0.0",
    displayName: "Lev-neon",
    description: "一只温暖机灵、认真打磨工具，也懂得等待确认和复盘的金黄色小探索兽。",
    spriteVersionNumber: 2 as const,
    spritesheetUrl: "/pets/lev-neon/spritesheet.webp",
  },
] as const;

export const isTauri = () => "__TAURI_INTERNALS__" in window;

export async function settingsGet(): Promise<SettingsV1> {
  if (isTauri()) return mergeSettings(await invoke("settings_get"));
  const stored = window.localStorage.getItem("deskmate.settings.v1");
  return stored
    ? mergeSettings(JSON.parse(stored))
    : { ...structuredClone(DEFAULT_SETTINGS), onboardingComplete: true };
}

export async function settingsPatch(settings: SettingsV1): Promise<SettingsV1> {
  if (isTauri()) return mergeSettings(await invoke("settings_patch", { patch: settings }));
  window.localStorage.setItem("deskmate.settings.v1", JSON.stringify(settings));
  return settings;
}

export async function autostartSet(enabled: boolean) {
  if (isTauri()) await invoke("autostart_set", { enabled });
}

export async function petCatalogRefresh(): Promise<PetCatalogV1> {
  return invoke("pet_catalog_refresh");
}

export async function petInstall(id: string, version: string) {
  return invoke("pet_install", { id, version });
}

export async function petSelect(id: string, version: string) {
  return invoke("pet_select", { id, version });
}

export async function petLocalRefresh(): Promise<LocalPetScanV1> {
  if (!isTauri()) return { folderPath: "DeskMate/custom-pets", pets: [], errors: [] };
  return invoke("pet_local_refresh");
}

export async function petLocalFolderOpen() {
  if (isTauri()) await invoke("pet_local_folder_open");
}

export async function customPetsDirPick(): Promise<string | null> {
  if (!isTauri()) return null;
  return invoke<string | null>("custom_pets_dir_pick");
}

export async function petCurrent(): Promise<PetChangedPayload> {
  if (!isTauri()) {
    return { id: "yanghao", version: "1.0.0", spriteVersionNumber: 2, spritesheetPath: null };
  }
  return invoke("pet_current");
}

export async function petRecall() {
  if (isTauri()) await invoke("pet_recall");
}

export async function updaterCheck(): Promise<UpdateStatus> {
  if (!isTauri()) return { available: false };
  return invoke("updater_check");
}

export async function updaterInstall() {
  if (isTauri()) await invoke("updater_install");
}

export async function openProjectUrl() {
  if (isTauri()) {
    await invoke("project_url_open");
    return;
  }
  window.open(PROJECT_URL, "_blank", "noopener,noreferrer");
}

export async function openPetGalleryUrl() {
  if (isTauri()) {
    await invoke("pet_gallery_url_open");
    return;
  }
  window.open(PET_GALLERY_URL, "_blank", "noopener,noreferrer");
}

export async function openPetDexUrl() {
  if (isTauri()) {
    await invoke("petdex_url_open");
    return;
  }
  window.open(PETDEX_URL, "_blank", "noopener,noreferrer");
}

export async function shareProject(): Promise<"shared" | "copied" | "cancelled"> {
  if (isTauri()) {
    await invoke("project_share_copy");
    return "copied";
  }
  if (typeof navigator.share === "function") {
    try {
      await navigator.share({
        title: "DeskMate",
        text: "一个开源、安静、支持自定义宠物的 Windows 桌面伙伴。",
        url: PROJECT_URL,
      });
      return "shared";
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return "cancelled";
    }
  }
  try {
    await navigator.clipboard?.writeText(PROJECT_URL);
    if (navigator.clipboard) return "copied";
  } catch {
    // Some embedded browsers deny the asynchronous clipboard API.
  }
  const input = document.createElement("textarea");
  input.value = PROJECT_URL;
  input.setAttribute("readonly", "");
  input.style.position = "fixed";
  input.style.opacity = "0";
  document.body.appendChild(input);
  input.select();
  const copied = document.execCommand?.("copy") ?? false;
  input.remove();
  if (!copied) throw new Error("无法复制分享链接");
  return "copied";
}

export async function listenEvent<T>(event: string, handler: (payload: T) => void): Promise<UnlistenFn> {
  if (!isTauri()) return () => undefined;
  return listen<T>(event, ({ payload }) => handler(payload));
}

export async function emitEvent<T>(event: string, payload: T) {
  if (isTauri()) await emit(event, payload);
}

export async function startWindowDrag() {
  if (isTauri()) await getCurrentWindow().startDragging();
}

export async function hideCurrentWindow() {
  if (isTauri()) await getCurrentWindow().hide();
}

export function petAssetUrl(path?: string | null, builtInId?: string) {
  if (path?.startsWith("/pets/")) return path;
  if (!path)
    return (
      BUILT_IN_PETS.find((pet) => pet.id === builtInId)?.spritesheetUrl ?? BUILT_IN_PETS[0].spritesheetUrl
    );
  return path && isTauri() ? convertFileSrc(path) : "/pets/yanghao/spritesheet.webp";
}
