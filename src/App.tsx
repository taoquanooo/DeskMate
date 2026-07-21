import { useEffect, useState } from "react";
import type { SettingsV1 } from "./domain/settings";
import type { PetCatalogV1 } from "./domain/pets";
import { Onboarding, type OnboardingChoice } from "./components/Onboarding";
import { PetWindow } from "./components/PetWindow";
import { ReminderBubble } from "./components/ReminderBubble";
import { SettingsApp } from "./components/SettingsApp";
import {
  autostartSet,
  emitEvent,
  hideCurrentWindow,
  listenEvent,
  petRecall,
  petCatalogRefresh,
  petInstall,
  petSelect,
  settingsGet,
  settingsPatch,
  updaterCheck,
  type BubblePayload,
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
  const [catalog, setCatalog] = useState<PetCatalogV1 | null>(null);
  const [catalogError, setCatalogError] = useState<string | null>(null);

  useEffect(() => {
    void settingsGet().then(setSettings);
  }, []);
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
    setSettings(await settingsPatch(next));
    await autostartSet(choice.autostartEnabled);
  };

  if (forceOnboarding || !settings.onboardingComplete) return <Onboarding onFinish={finishOnboarding} />;
  const refreshCatalog = async () => {
    try {
      setCatalog(await petCatalogRefresh());
      setCatalogError(null);
    } catch (error) {
      setCatalogError(String(error));
    }
  };
  return (
    <SettingsApp
      initialSettings={settings}
      onSettingsChange={(next) => {
        setSettings(next);
        void settingsPatch(next);
      }}
      onRecall={() => void petRecall()}
      onCheckUpdates={() => void updaterCheck()}
      catalog={catalog}
      catalogError={catalogError}
      onCatalogRefresh={() => void refreshCatalog()}
      onPetInstall={(id, version) => void petInstall(id, version).then(refreshCatalog)}
      onPetSelect={(id, version) =>
        void petSelect(id, version).then(() => setSettings({ ...settings, selectedPet: { id, version } }))
      }
      onAutostartChange={(enabled) => void autostartSet(enabled)}
    />
  );
}

function BubbleWindow() {
  const [payload, setPayload] = useState<BubblePayload>({
    reminderIds: ["stretch"],
    title: "起来走走吧",
    message: "活动一下肩颈和双腿",
  });
  useEffect(() => {
    let unlisten: () => void = () => undefined;
    void listenEvent<BubblePayload>("bubble://show", setPayload).then((dispose) => {
      unlisten = dispose;
    });
    return () => unlisten();
  }, []);
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
