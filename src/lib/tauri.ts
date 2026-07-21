import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { emit, listen, type UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { PetCatalogV1 } from "../domain/pets";
import { DEFAULT_SETTINGS, mergeSettings, type SettingsV1 } from "../domain/settings";

export interface RuntimeAnimationPayload {
  state: string;
  directionDegrees?: number;
  loopCount?: number;
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
  spritesheetPath?: string | null;
}

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

export async function petRecall() {
  if (isTauri()) await invoke("pet_recall");
}

export async function windowSetClickThrough(enabled: boolean) {
  if (isTauri()) await invoke("window_set_click_through", { enabled });
}

export async function updaterCheck(): Promise<UpdateStatus> {
  if (!isTauri()) return { available: false };
  return invoke("updater_check");
}

export async function updaterInstall() {
  if (isTauri()) await invoke("updater_install");
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

export function petAssetUrl(path?: string | null) {
  return path && isTauri() ? convertFileSrc(path) : "/pets/yanghao/spritesheet.webp";
}
