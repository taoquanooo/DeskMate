import { useEffect, useState } from "react";
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
  petCurrent,
  petInstall,
  petUninstall,
  openPetGalleryUrl,
  openPetDexUrl,
  petLocalFolderOpen,
  petLocalRefresh,
  petSelect,
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
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [catalog, setCatalog] = useState<PetCatalogV1 | null>(null);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [localPetScan, setLocalPetScan] = useState<LocalPetScanV1>({
    folderPath: "",
    pets: [],
    errors: [],
  });
  const [updateUi, setUpdateUi] = useState<UpdateUi>({ state: "idle" });
  const [currentPet, setCurrentPet] = useState<PetChangedPayload | null>(null);
  const [installedPetList, setInstalledPetList] = useState<InstalledPet[]>([]);
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
    let cancelled = false;
    void listenEvent<UpdateStatus>("update://ready", (status) => {
      setUpdateUi({ state: "ready", version: status.version, notes: status.notes });
    }).then((dispose) => {
      if (cancelled) dispose();
      else disposedReady = dispose;
    });
    void listenEvent<string>("update://error", (error) => {
      setUpdateUi((current) =>
        current.state === "ready" ? current : { state: "error", error: String(error) },
      );
    }).then((dispose) => {
      if (cancelled) dispose();
      else disposedError = dispose;
    });
    return () => {
      cancelled = true;
      disposedReady?.();
      disposedError?.();
    };
  }, []);

  useEffect(() => {
    let active = true;
    let disposeChanged: (() => void) | undefined;
    void petCurrent().then(
      (pet) => active && setCurrentPet(pet),
      () => undefined,
    );
    void listenEvent<PetChangedPayload>("pet://changed", (pet) => {
      if (active) setCurrentPet(pet);
    }).then((dispose) => {
      if (active) disposeChanged = dispose;
      else dispose();
    });
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
    const refreshInstalled = async () => {
      try {
        const list = await installedPets();
        if (active) setInstalledPetList(list);
      } catch {
        // best-effort: installed list is supplemental
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
    return () => {
      active = false;
      disposedInstalled?.();
      disposedProgress?.();
      disposedUninstalled?.();
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
      await autostartSet(choice.autostartEnabled);
      setSettings(patched);
    } catch (error) {
      setSettingsError(`初始化未完成：${String(error)}`);
    }
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
    } catch (error) {
      setCatalogError(String(error));
    }
  };
  const checkUpdates = async () => {
    setUpdateUi({ state: "checking" });
    try {
      const status = await updaterCheck();
      if (status.available) {
        setUpdateUi({ state: "ready", version: status.version, notes: status.notes });
      } else {
        setUpdateUi({ state: "up-to-date" });
      }
    } catch (error) {
      setUpdateUi({ state: "error", error: String(error) });
    }
  };
  const installUpdate = () => {
    void updaterInstall().catch((error) => setUpdateUi({ state: "error", error: String(error) }));
  };
  return (
    <SettingsApp
      initialSettings={settings}
      currentPet={currentPet}
      onSettingsChange={(next) => {
        setSettings(next);
        void settingsPatch(next).then(
          (sanitized) => setSettings(sanitized),
          () => undefined,
        );
      }}
      onRecall={() => void petRecall()}
      onCheckUpdates={() => void checkUpdates()}
      updateUi={updateUi}
      onInstallUpdate={installUpdate}
      catalog={catalog}
      catalogError={catalogError}
      installedPets={installedPetList}
      installProgress={installProgress}
      onCatalogRefresh={() => void refreshCatalog()}
      onPetInstall={(id, version) => {
        setInstallProgress((current) => ({
          ...current,
          [`${id}@${version}`]: { id, version, downloaded: 0, total: 0 },
        }));
        void petInstall(id, version).then(
          () => refreshCatalog(),
          (error) => {
            setInstallProgress((current) => {
              const next = { ...current };
              delete next[`${id}@${version}`];
              return next;
            });
            setCatalogError(`安装失败：${String(error)}`);
          },
        );
      }}
      onPetSelect={(id, version) =>
        void petSelect(id, version).then(
          () => setSettings((current) => (current ? { ...current, selectedPet: { id, version } } : current)),
          (error) => setCatalogError(`切换宠物失败：${String(error)}`),
        )
      }
      onPetUninstall={(id, version) =>
        void petUninstall(id, version).catch((error) => setCatalogError(`删除失败：${String(error)}`))
      }
      onAutostartChange={(enabled) => void autostartSet(enabled)}
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
