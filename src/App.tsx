import { useEffect, useRef, useState } from "react";
import type { SettingsV1 } from "./domain/settings";
import type { LocalPetScanV1, PetCatalogV1 } from "./domain/pets";
import { Onboarding, type OnboardingChoice } from "./components/Onboarding";
import { PetWindow } from "./components/PetWindow";
import { ReminderBubble } from "./components/ReminderBubble";
import { SettingsApp, type UpdateUi } from "./components/SettingsApp";
import {
  autostartSet,
  customPetsDirPick,
  emitEvent,
  hideCurrentWindow,
  installedPets,
  listenEvent,
  petRecall,
  petCatalogRefresh,
  petCatalogGet,
  catalogStatus,
  petCurrent,
  petInstall,
  petUninstall,
  openPetGalleryUrl,
  openPetDexUrl,
  petLocalFolderOpen,
  petLocalRefresh,
  petSelectionSet,
  openProjectUrl,
  shareProject,
  settingsGet,
  settingsPatch,
  updaterCheck,
  updaterInstall,
  type BubblePayload,
  type InstallProgress,
  type InstalledPet,
  type PetChangedPayload,
  type UpdateStatus,
  type UpdateProgress,
} from "./lib/tauri";

type View = "settings" | "pet" | "bubble" | "onboarding";

export function App() {
  const view = getView();
  if (view === "pet") return <PetWindow />;
  if (view === "bubble") return <BubbleWindow />;
  return <SettingsWindow forceOnboarding={view === "onboarding"} />;
}

function SettingsWindow({ forceOnboarding }: { forceOnboarding: boolean }) {
  const [settings, setSettings] = useState<SettingsV1 | null>(null);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [settingsSaveError, setSettingsSaveError] = useState<string | null>(null);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [catalog, setCatalog] = useState<PetCatalogV1 | null>(null);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [catalogUpdateAvailable, setCatalogUpdateAvailable] = useState(false);
  const [localPetScan, setLocalPetScan] = useState<LocalPetScanV1>({
    folderPath: "",
    pets: [],
    errors: [],
  });
  const [updateUi, setUpdateUi] = useState<UpdateUi>({ state: "idle" });
  const [currentPet, setCurrentPet] = useState<PetChangedPayload | null>(null);
  const settingsPatchSeq = useRef(0);
  const [installedPetList, setInstalledPetList] = useState<InstalledPet[]>([]);
  const installedScanSeq = useRef(0);
  const [installProgress, setInstallProgress] = useState<Record<string, InstallProgress>>({});

  useEffect(() => {
    let active = true;
    setSettingsError(null);
    void loadInitialSettings().then(
      (loaded) => active && setSettings(loaded),
      (error) => active && setSettingsError(String(error)),
    );
    return () => {
      active = false;
    };
  }, [loadAttempt]);

  useEffect(() => {
    if (!settings?.onboardingComplete) return;
    let active = true;
    let disposeUpdate: (() => void) | undefined;
    let disposeCatalog: (() => void) | undefined;
    let catalogChanged = false;
    // Subscribe before reading the cache so a first background refresh cannot
    // be lost, or be replaced by an older in-flight cache response.
    void listenEvent<PetCatalogV1>("catalog://updated", (next) => {
      catalogChanged = true;
      if (active) {
        setCatalog(next);
        setCatalogError(null);
      }
    })
      .then(async (dispose) => {
        if (!active) {
          dispose();
          return;
        }
        disposeCatalog = dispose;
        const cached = await petCatalogGet();
        if (active && !catalogChanged) setCatalog(cached);
      })
      .catch((error) => {
        if (active) setCatalogError(`无法读取宠物目录缓存：${String(error)}`);
      });
    // Check the initial red-dot state from the backend (it knows whether the
    // on-disk cache is newer than what the user last acknowledged).
    void catalogStatus().then(
      (available) => active && setCatalogUpdateAvailable(available),
      () => undefined,
    );
    // Listen for the background refresh discovering new content.
    void listenEvent<void>("catalog://update-available", () => {
      if (active) setCatalogUpdateAvailable(true);
    }).then((dispose) => {
      if (active) disposeUpdate = dispose;
      else dispose();
    });
    return () => {
      active = false;
      disposeUpdate?.();
      disposeCatalog?.();
    };
  }, [settings?.onboardingComplete]);

  useEffect(() => {
    if (!settings?.onboardingComplete) return;
    let active = true;
    void petLocalRefresh().then(
      (scan) => active && setLocalPetScan(scan),
      (error) =>
        active &&
        setLocalPetScan((current) => ({
          ...current,
          errors: [`无法扫描自定义宠物：${String(error)}`],
        })),
    );
    return () => {
      active = false;
    };
  }, [settings?.onboardingComplete]);

  useEffect(() => {
    let disposedReady: (() => void) | undefined;
    let disposedError: (() => void) | undefined;
    let disposedProgress: (() => void) | undefined;
    let disposedChecked: (() => void) | undefined;
    let cancelled = false;
    void listenEvent<UpdateStatus>("update://ready", (status) => {
      setUpdateUi({ state: "ready", version: status.version, notes: status.notes, source: status.source });
    }).then((dispose) => {
      if (cancelled) dispose();
      else disposedReady = dispose;
    });
    void listenEvent<string>("update://error", (error) => {
      setUpdateUi((current) =>
        current.state === "ready" ? current : { state: "error", error: `检查更新失败：${String(error)}` },
      );
    }).then((dispose) => {
      if (cancelled) dispose();
      else disposedError = dispose;
    });
    void listenEvent<UpdateProgress>("update://progress", (progress) => {
      if (!cancelled)
        setUpdateUi((current) =>
          current.state === "ready" ? current : { state: "checking", progress, source: progress.source },
        );
    }).then((dispose) => {
      if (cancelled) dispose();
      else disposedProgress = dispose;
    });
    void listenEvent<UpdateStatus>("update://checked", (status) => {
      if (!cancelled && !status.available)
        setUpdateUi((current) =>
          current.state === "ready" ? current : { state: "up-to-date", source: status.source },
        );
    }).then((dispose) => {
      if (cancelled) dispose();
      else disposedChecked = dispose;
    });
    return () => {
      cancelled = true;
      disposedReady?.();
      disposedError?.();
      disposedProgress?.();
      disposedChecked?.();
    };
  }, []);

  useEffect(() => {
    let active = true;
    let disposeChanged: (() => void) | undefined;
    // Register the listener before fetching the current pet: a pet switch
    // landing between the fetch and a later subscription would otherwise be
    // lost and the UI would keep rendering a stale pet.
    void listenEvent<PetChangedPayload>("pet://changed", (pet) => {
      if (active) setCurrentPet(pet);
    }).then((dispose) => {
      if (active) disposeChanged = dispose;
      else dispose();
    });
    void petCurrent().then(
      (pet) => active && setCurrentPet(pet),
      () => undefined,
    );
    return () => {
      active = false;
      disposeChanged?.();
    };
  }, []);

  useEffect(() => {
    if (!settings?.onboardingComplete) return;
    let active = true;
    let disposedInstalled: (() => void) | undefined;
    let disposedProgress: (() => void) | undefined;
    let disposedUninstalled: (() => void) | undefined;
    let disposedRestored: (() => void) | undefined;
    const refreshInstalled = async () => {
      const request = ++installedScanSeq.current;
      try {
        const list = await installedPets();
        if (active && request === installedScanSeq.current) setInstalledPetList(list);
      } catch (error) {
        if (active && request === installedScanSeq.current) {
          setCatalogError(`无法读取已下载宠物：${String(error)}`);
        }
      }
    };
    void refreshInstalled();
    void listenEvent<{ id: string; version: string }>("pet://installed", (payload) => {
      if (!active) return;
      setInstallProgress((current) => {
        const next = { ...current };
        delete next[`${payload.id}@${payload.version}`];
        return next;
      });
      void refreshInstalled();
    }).then((dispose) => {
      if (active) disposedInstalled = dispose;
      else dispose();
    });
    void listenEvent<{ id: string; version: string }>("pet://uninstalled", () => {
      if (!active) return;
      void refreshInstalled();
      void refreshLocalPets();
    }).then((dispose) => {
      if (active) disposedUninstalled = dispose;
      else dispose();
    });
    void listenEvent<InstallProgress>("pet://install-progress", (progress) => {
      if (!active) return;
      setInstallProgress((current) => ({
        ...current,
        [`${progress.id}@${progress.version}`]: progress,
      }));
    }).then((dispose) => {
      if (active) disposedProgress = dispose;
      else dispose();
    });
    void listenEvent("pet://restored", () => {
      if (active) void refreshLocalPets();
    }).then((dispose) => {
      if (active) disposedRestored = dispose;
      else dispose();
    });
    return () => {
      active = false;
      disposedInstalled?.();
      disposedProgress?.();
      disposedUninstalled?.();
      disposedRestored?.();
    };
  }, [settings?.onboardingComplete]);

  if (settingsError)
    return (
      <div className="app-load-error" role="alert">
        <strong>无法加载设置</strong>
        <span>DeskMate 还没有准备好，请稍后重试。</span>
        <button type="button" onClick={() => setLoadAttempt((attempt) => attempt + 1)}>
          重新加载
        </button>
      </div>
    );
  if (!settings)
    return (
      <div className="app-loading" aria-label="正在加载 DeskMate">
        <span />
      </div>
    );

  const finishOnboarding = async (choice: OnboardingChoice) => {
    const next = {
      ...settings,
      onboardingComplete: true,
      autostartEnabled: choice.autostartEnabled,
      reminders: settings.reminders.map((item) => ({
        ...item,
        enabled: choice.reminderIds.includes(item.id),
      })),
    };
    try {
      const patched = await settingsPatch(next);
      setSettings(patched);
    } catch (error) {
      setSettingsError(`初始化未完成：${String(error)}`);
      return;
    }
    // A failed autostart registration must not gate the whole onboarding:
    // settings are already saved, so surface it as a recoverable banner.
    try {
      await autostartSet(choice.autostartEnabled);
    } catch (error) {
      setSettingsSaveError(`开机自启设置失败：${String(error)}`);
    }
  };

  const persistSettings = (next: SettingsV1) => {
    setSettings(next);
    setSettingsSaveError(null);
    // Pet selection is managed by the dedicated `pet_selection_set` command
    // (which also syncs windows). If we send `selectedPet`/`selectedPets` as
    // part of a generic settings patch, the in-flight request can carry a
    // stale selection and overwrite a concurrent pet switch. Strip them from
    // the patch so the backend keeps whatever is currently in its state.
    const { selectedPet: _omitPet, selectedPets: _omitPets, ...patch } = next;
    // Slider drags fire many patches in a row and their responses can arrive
    // out of order; adopting an older response makes the UI snap back
    // mid-drag. Only the latest request is allowed to replace the state.
    const request = ++settingsPatchSeq.current;
    void settingsPatch(patch).then(
      (sanitized) => {
        if (request !== settingsPatchSeq.current) return;
        // Keep the locally owned selection: the patch response may have been
        // computed before a concurrent `petSelectionSet` committed, and
        // adopting its stale list would undo the user's pet switch.
        setSettings((current) =>
          current
            ? { ...sanitized, selectedPet: current.selectedPet, selectedPets: current.selectedPets }
            : sanitized,
        );
      },
      // A failed save must be visible: the in-memory UI already shows the
      // new value, so silently swallowing the error would let the user
      // believe their change reached the disk.
      (error) => setSettingsSaveError(`保存设置失败：${String(error)}`),
    );
  };

  if (forceOnboarding || !settings.onboardingComplete) return <Onboarding onFinish={finishOnboarding} />;
  const refreshLocalPets = async () => {
    try {
      setLocalPetScan(await petLocalRefresh());
    } catch (error) {
      setLocalPetScan((current) => ({
        ...current,
        errors: [`无法扫描自定义宠物：${String(error)}`],
      }));
    }
  };
  const refreshCatalog = async () => {
    try {
      setCatalog(await petCatalogRefresh());
      setCatalogError(null);
      setCatalogUpdateAvailable(false);
    } catch (error) {
      setCatalogError(String(error));
    }
  };
  const checkUpdates = async () => {
    setUpdateUi({ state: "checking" });
    try {
      const status = await updaterCheck();
      if (status.available) {
        if (status.downloaded) {
          setUpdateUi({
            state: "ready",
            version: status.version,
            notes: status.notes,
            source: status.source,
          });
        } else {
          // The check itself worked; only the download failed. The periodic
          // check will retry staging it.
          setUpdateUi({
            state: "error",
            error: `发现新版本 v${status.version ?? ""}，但下载失败，稍后将自动重试`,
          });
        }
      } else {
        setUpdateUi({ state: "up-to-date", source: status.source });
      }
    } catch (error) {
      // The full message is composed here so the UI never blames the wrong
      // action (e.g. showing "check failed" for a failed install).
      setUpdateUi({ state: "error", error: `检查更新失败：${String(error)}` });
    }
  };
  const installUpdate = () => {
    void updaterInstall().catch((error) =>
      setUpdateUi({ state: "error", error: `安装更新失败：${String(error)}` }),
    );
  };
  return (
    <SettingsApp
      initialSettings={settings}
      settingsSaveError={settingsSaveError}
      currentPet={currentPet}
      onSettingsChange={persistSettings}
      onAutostartChange={(enabled) => {
        persistSettings({ ...settings, autostartEnabled: enabled });
        // The system registration can fail independently of the settings
        // save (e.g. registry access denied); surface it instead of letting
        // the switch silently disagree with the OS.
        void autostartSet(enabled).catch((error) =>
          setSettingsSaveError(`开机自启设置失败：${String(error)}`),
        );
      }}
      onRecall={() => void petRecall()}
      onCheckUpdates={() => void checkUpdates()}
      updateUi={updateUi}
      onInstallUpdate={installUpdate}
      catalog={catalog}
      catalogError={catalogError}
      catalogUpdateAvailable={catalogUpdateAvailable}
      installedPets={installedPetList}
      installProgress={installProgress}
      onCatalogRefresh={() => void refreshCatalog()}
      onPetInstall={(id, version) => {
        setInstallProgress((current) => ({
          ...current,
          [`${id}@${version}`]: { id, version, downloaded: 0, total: 0 },
        }));
        setCatalogError(null);
        void petInstall(id, version)
          .then(
            async () => {
              // Command completion is authoritative even if the event listener
              // was not ready. Installation does not need another network fetch.
              const request = ++installedScanSeq.current;
              try {
                const list = await installedPets();
                if (request === installedScanSeq.current) setInstalledPetList(list);
              } catch (error) {
                if (request === installedScanSeq.current) {
                  setCatalogError(`宠物已安装，但无法读取已下载列表：${String(error)}`);
                }
              }
            },
            (error) => {
              setCatalogError(`安装失败：${String(error)}`);
            },
          )
          .finally(() => {
            setInstallProgress((current) => {
              const next = { ...current };
              delete next[`${id}@${version}`];
              return next;
            });
          });
      }}
      onPetToggle={(id, version) => {
        // Single-pet mode: switching replaces the desktop pet outright.
        void petSelectionSet({ id, version }).then(
          (pet) =>
            setSettings((current) =>
              current ? { ...current, selectedPet: pet, selectedPets: [pet] } : current,
            ),
          (error) => setCatalogError(`切换宠物失败：${String(error)}`),
        );
      }}
      onPetUninstall={(id, version) =>
        void petUninstall(id, version).catch((error) => setCatalogError(`删除失败：${String(error)}`))
      }
      localPets={localPetScan.pets}
      localPetFolder={localPetScan.folderPath}
      localPetErrors={localPetScan.errors}
      onOpenLocalPetFolder={() => void petLocalFolderOpen().then(refreshLocalPets)}
      onLocalPetRefresh={() => void refreshLocalPets()}
      onCustomPetsDirPick={async () => {
        const picked = await customPetsDirPick();
        if (picked) {
          await refreshLocalPets();
          setSettings((current) => (current ? { ...current, customPetsDir: picked } : current));
        }
        return picked;
      }}
      onOpenPetGallery={() => void openPetGalleryUrl()}
      onOpenPetDex={() => void openPetDexUrl()}
      onOpenProject={() => void openProjectUrl()}
      onShareProject={shareProject}
    />
  );
}

export async function loadInitialSettings(): Promise<SettingsV1> {
  const retryDelays = [0, 150, 300];
  let lastError: unknown;
  for (const delayMs of retryDelays) {
    if (delayMs > 0) await new Promise((resolve) => window.setTimeout(resolve, delayMs));
    try {
      return await settingsGet();
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

function BubbleWindow() {
  const [payload, setPayload] = useState<BubblePayload | null>(null);
  useEffect(() => {
    let disposed: (() => void) | undefined;
    let cancelled = false;
    void listenEvent<BubblePayload>("bubble://show", setPayload).then((dispose) => {
      if (cancelled) dispose();
      else disposed = dispose;
    });
    return () => {
      cancelled = true;
      disposed?.();
    };
  }, []);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      void hideCurrentWindow();
    }, 30_000);
    return () => window.clearTimeout(timer);
  }, [payload]);
  if (!payload) return null;
  const finish = async (action: "complete" | "snooze" | "dismiss") => {
    await emitEvent("bubble://action", { action, reminderIds: payload.reminderIds });
    await hideCurrentWindow();
  };
  return (
    <ReminderBubble
      title={payload.title}
      message={payload.message}
      snoozeMinutes={payload.snoozeMinutes}
      onComplete={() => void finish("complete")}
      onSnooze={() => void finish("snooze")}
      onDismiss={() => void finish("dismiss")}
    />
  );
}

function getView(): View {
  const requested = new URLSearchParams(window.location.search).get("view");
  if (requested === "pet" || requested === "bubble" || requested === "onboarding") return requested;
  const label = document.documentElement.dataset.windowLabel;
  if (label === "pet" || label === "bubble") return label;
  return "settings";
}
