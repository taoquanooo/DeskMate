import { useEffect, useState } from "react";
import {
  Bell,
  Box,
  CircleHelp,
  ExternalLink,
  FolderOpen,
  FolderSearch,
  Github,
  Heart,
  MonitorUp,
  PawPrint,
  RefreshCw,
  RotateCcw,
  Share2,
  Trash2,
} from "lucide-react";
import pkg from "../../package.json" with { type: "json" };
import type { Reminder, ReminderSchedule } from "../domain/reminders";
import type { LocalPetV1, PetCatalogV1 } from "../domain/pets";
import type { PetSelection, SettingsV1 } from "../domain/settings";
import {
  BUILT_IN_PETS,
  PETDEX_URL,
  PET_GALLERY_URL,
  PROJECT_URL,
  type InstallProgress,
  type InstalledPet,
  type PetChangedPayload,
  type UpdateProgress,
  updateProgressText,
} from "../lib/tauri";
import { PetPreview } from "./PetPreview";
import { PetSizeSetting } from "./PetSizeSetting";
import { PetThumbnail } from "./PetThumbnail";
import { RandomActivitySettingsPanel } from "./RandomActivitySettingsPanel";
import { activityStatusText } from "../domain/activities";
import { useActivityStatus } from "../lib/useActivityStatus";
import { LocalPetTrash } from "./LocalPetTrash";
import { RoamingTimingSettings, roamingDraft } from "./RoamingTimingSettings";
import { PetCreator } from "./PetCreator";
import { PetImportPanel } from "./PetImportPanel";

export type UpdateUi = {
  state: "idle" | "checking" | "up-to-date" | "ready" | "error";
  version?: string;
  notes?: string;
  error?: string;
  source?: "github" | "mirror";
  progress?: UpdateProgress;
};

type Section = "pet" | "reminders" | "library" | "creator" | "about";

export interface SettingsAppProps {
  initialSettings: SettingsV1;
  settingsSaveError?: string | null;
  onSettingsChange?: (settings: SettingsV1) => void;
  onRecall?: () => void;
  onCheckUpdates?: () => void;
  updateUi?: UpdateUi;
  onInstallUpdate?: () => void;
  catalog?: PetCatalogV1 | null;
  catalogError?: string | null;
  catalogUpdateAvailable?: boolean;
  installedPets?: InstalledPet[];
  installProgress?: Record<string, InstallProgress>;
  onCatalogRefresh?: () => void;
  onPetInstall?: (id: string, version: string) => void;
  onPetToggle?: (id: string, version: string) => void;
  onPetUninstall?: (id: string, version: string) => void;
  onAutostartChange?: (enabled: boolean) => void;
  localPets?: LocalPetV1[];
  localPetFolder?: string;
  localPetErrors?: string[];
  onOpenLocalPetFolder?: () => void;
  onLocalPetRefresh?: () => void;
  onCustomPetsDirPick?: () => Promise<string | null>;
  onOpenPetGallery?: () => void;
  onOpenPetDex?: () => void;
  onOpenProject?: () => void;
  onShareProject?: () => Promise<"shared" | "copied" | "cancelled">;
  currentPet?: PetChangedPayload | null;
}

const NAV: Array<{ id: Section; label: string; icon: typeof PawPrint }> = [
  { id: "pet", label: "桌宠", icon: PawPrint },
  { id: "reminders", label: "活动", icon: Bell },
  { id: "library", label: "宠物库", icon: Box },
  { id: "creator", label: "做宠物", icon: PawPrint },
  { id: "about", label: "关于", icon: CircleHelp },
];

export function SettingsApp({
  initialSettings,
  settingsSaveError,
  onSettingsChange,
  onRecall,
  onCheckUpdates,
  updateUi,
  onInstallUpdate,
  catalog,
  catalogError,
  catalogUpdateAvailable = false,
  installedPets = [],
  installProgress = {},
  onCatalogRefresh,
  onPetInstall,
  onPetToggle,
  onPetUninstall,
  onAutostartChange,
  localPets = [],
  localPetFolder,
  localPetErrors = [],
  onOpenLocalPetFolder,
  onLocalPetRefresh,
  onCustomPetsDirPick,
  onOpenPetGallery,
  onOpenPetDex,
  onOpenProject,
  onShareProject,
  currentPet,
}: SettingsAppProps) {
  const [settings, setSettings] = useState(initialSettings);
  const activityStatus = useActivityStatus();
  const activityStatusLabel = activityStatusText(settings.randomActivity, activityStatus);
  const [section, setSection] = useState<Section>("pet");
  const [roamDraft, setRoamDraft] = useState(() => roamingDraft(initialSettings.pet.roamingTiming));
  useEffect(
    () => setRoamDraft(roamingDraft(settings.pet.roamingTiming)),
    [
      settings.pet.roamingTiming.walkMinSeconds,
      settings.pet.roamingTiming.walkMaxSeconds,
      settings.pet.roamingTiming.pauseMinSeconds,
      settings.pet.roamingTiming.pauseMaxSeconds,
    ],
  );
  const [activityIntervalDraft, setActivityIntervalDraft] = useState({
    min: String(initialSettings.randomActivity.customMinSeconds),
    max: String(initialSettings.randomActivity.customMaxSeconds),
  });
  useEffect(() => {
    setActivityIntervalDraft({
      min: String(settings.randomActivity.customMinSeconds),
      max: String(settings.randomActivity.customMaxSeconds),
    });
  }, [settings.randomActivity.customMinSeconds, settings.randomActivity.customMaxSeconds]);

  useEffect(() => {
    setSettings(initialSettings);
  }, [initialSettings]);

  const persist = (next: SettingsV1) => {
    setSettings(next);
    onSettingsChange?.(next);
  };

  const patchPet = (patch: Partial<SettingsV1["pet"]>) => {
    persist({ ...settings, pet: { ...settings.pet, ...patch } });
  };

  const patchReminder = (id: string, patch: Partial<Reminder>) => {
    persist({
      ...settings,
      reminders: settings.reminders.map((item) => (item.id === id ? { ...item, ...patch } : item)),
    });
  };

  return (
    <main className="settings-shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">
            <Heart size={18} fill="currentColor" />
          </span>
          <span>DeskMate</span>
        </div>
        <nav aria-label="设置导航">
          {NAV.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              className={section === id ? "nav-item active" : "nav-item"}
              onClick={() => setSection(id)}
            >
              <Icon size={19} />
              {label}
            </button>
          ))}
        </nav>
        <div className="sidebar-footer">
          <span className="status-dot" />
          <span className="sidebar-footer-info">
            运行中
            <small>DeskMate v{pkg.version}</small>
          </span>
          <button
            type="button"
            className="sidebar-check-update"
            onClick={onCheckUpdates}
            disabled={updateUi?.state === "checking"}
            title={updateUi?.state === "checking" ? updateProgressText(updateUi.progress) : undefined}
          >
            {updateUi?.state === "checking"
              ? updateUi.progress?.stage === "downloading"
                ? "下载中…"
                : updateUi.progress?.source === "mirror"
                  ? "备用渠道…"
                  : "检查中…"
              : "检查更新"}
          </button>
        </div>
      </aside>
      <section className={section === "pet" ? "settings-main settings-main-home" : "settings-main"}>
        {settingsSaveError && (
          <p className="settings-save-error" role="alert">
            {settingsSaveError}
            <small>当前显示的修改尚未写入磁盘，重启后会恢复为上次保存的设置。</small>
          </p>
        )}
        {section === "pet" && (
          <PetSettings
            settings={settings}
            patchPet={patchPet}
            activityStatusLabel={activityStatusLabel}
            onActivityToggle={(enabled) =>
              persist({ ...settings, randomActivity: { ...settings.randomActivity, enabled } })
            }
            onRecall={onRecall}
            currentPet={currentPet}
            localPets={localPets}
            catalog={catalog}
          />
        )}
        {section === "reminders" && (
          <>
            <PageHeader title="活动" subtitle="用随机动作增添活力，也可以设置定时提醒。" />
            <header className="activity-section-header">
              <h2>随机漫游</h2>
              <p>自由行走、随机停留，也可以停下来做活动。</p>
            </header>
            <ToggleSetting
              label="自动漫游"
              description="在各个屏幕的可用区域里自由走动"
              checked={settings.pet.roamingEnabled}
              onChange={(roamingEnabled) => patchPet({ roamingEnabled })}
            />
            <RangeSetting
              label="移动速度"
              value={settings.pet.speed}
              min={40}
              max={140}
              step={5}
              suffix={`${settings.pet.speed} px/s`}
              onChange={(speed) => patchPet({ speed })}
            />
            <RoamingTimingSettings
              value={settings.pet.roamingTiming}
              draft={roamDraft}
              onDraftChange={setRoamDraft}
              onSave={(roamingTiming) => patchPet({ roamingTiming })}
            />
            <RandomActivitySettingsPanel
              value={settings.randomActivity}
              statusLabel={activityStatusLabel}
              intervalDraft={activityIntervalDraft}
              onIntervalDraftChange={setActivityIntervalDraft}
              displayName={
                BUILT_IN_PETS.find((pet) => pet.id === (currentPet?.id ?? settings.selectedPet.id))
                  ?.displayName ??
                localPets.find((pet) => pet.id === (currentPet?.id ?? settings.selectedPet.id))
                  ?.displayName ??
                catalog?.pets.find((pet) => pet.id === (currentPet?.id ?? settings.selectedPet.id))
                  ?.displayName ??
                currentPet?.id ??
                settings.selectedPet.id
              }
              onChange={(randomActivity) => persist({ ...settings, randomActivity })}
              pet={currentPet ?? { ...settings.selectedPet, spriteVersionNumber: 2, spritesheetPath: null }}
            />
            <ReminderSettings
              settings={settings}
              patchReminder={patchReminder}
              onAdd={(reminder) => persist({ ...settings, reminders: [...settings.reminders, reminder] })}
              onRemove={(id) =>
                persist({ ...settings, reminders: settings.reminders.filter((item) => item.id !== id) })
              }
            />
          </>
        )}
        {section === "library" && <PageHeader title="宠物库" subtitle="选择官方宠物，或安装自己的伙伴。" />}
        <div hidden={section !== "library"}>
          <PetImportPanel
            active={section === "library"}
            folderPath={localPetFolder}
            onImported={() => onLocalPetRefresh?.()}
            onUse={(id) => onPetToggle?.(id, "local")}
          />
        </div>
        {section === "library" && (
          <PetLibrary
            catalog={catalog}
            error={catalogError}
            updateAvailable={catalogUpdateAvailable}
            selectedPets={settings.selectedPets}
            onRefresh={onCatalogRefresh}
            onInstall={onPetInstall}
            onToggle={onPetToggle}
            onUninstall={onPetUninstall}
            installedPets={installedPets}
            installProgress={installProgress}
            localPets={localPets}
            localPetFolder={localPetFolder}
            localPetErrors={localPetErrors}
            onOpenLocalPetFolder={onOpenLocalPetFolder}
            onLocalPetRefresh={onLocalPetRefresh}
            onCustomPetsDirPick={onCustomPetsDirPick}
            onOpenPetGallery={onOpenPetGallery}
            onOpenPetDex={onOpenPetDex}
          />
        )}
        {section === "creator" && <PetCreator onOpenLibrary={() => setSection("library")} />}
        {section === "about" && (
          <About
            settings={settings}
            onCheckUpdates={onCheckUpdates}
            updateUi={updateUi}
            onInstallUpdate={onInstallUpdate}
            onOpenProject={onOpenProject}
            onShareProject={onShareProject}
            onAutostartChange={(enabled) => onAutostartChange?.(enabled)}
          />
        )}
      </section>
    </main>
  );
}

function PageHeader({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <header className="page-header">
      <h1>{title}</h1>
      <p>{subtitle}</p>
    </header>
  );
}

function PetSettings({
  settings,
  activityStatusLabel,
  patchPet,
  onActivityToggle,
  onRecall,
  currentPet,
  localPets,
  catalog,
}: {
  settings: SettingsV1;
  activityStatusLabel: string;
  patchPet: (patch: Partial<SettingsV1["pet"]>) => void;
  onActivityToggle: (enabled: boolean) => void;
  onRecall?: () => void;
  currentPet?: PetChangedPayload | null;
  localPets: LocalPetV1[];
  catalog?: PetCatalogV1 | null;
}) {
  const previewPet: PetChangedPayload = currentPet ?? {
    id: settings.selectedPet.id,
    version: settings.selectedPet.version,
    spriteVersionNumber: 2,
    spritesheetPath: null,
  };
  const previewName =
    BUILT_IN_PETS.find((pet) => pet.id === previewPet.id && pet.version === previewPet.version)
      ?.displayName ??
    localPets.find((pet) => pet.id === previewPet.id)?.displayName ??
    catalog?.pets.find((pet) => pet.id === previewPet.id && pet.version === previewPet.version)
      ?.displayName ??
    previewPet.id;

  return (
    <>
      <PageHeader title="桌宠设置" subtitle="自定义你的桌面伙伴，让陪伴更合你心意。" />
      <div className="pet-settings-grid">
        <section className="pet-preview" aria-label="桌宠预览">
          <div className="preview-bubble">
            <strong>今天也一起加油吧！</strong>
            <span>正在展示当前桌宠的动画</span>
          </div>
          <PetPreview pet={previewPet} displayName={previewName} />
          <button className="button button-secondary" onClick={onRecall}>
            <RotateCcw size={16} />
            召回当前屏幕
          </button>
        </section>
        <section className="setting-list" aria-label="桌宠行为设置">
          <PetSizeSetting scale={settings.pet.scale} onChange={(scale) => patchPet({ scale })} />
          <ToggleSetting
            label="随机活动"
            description={
              settings.randomActivity.enabledActions.length === 0
                ? "未选择动作，请到“活动”页至少开启一种动作"
                : "随机播放原地动作，动作与频率可在“活动”页设置"
            }
            checked={settings.randomActivity.enabled}
            onChange={onActivityToggle}
          />
          <p className="activity-runtime-status" aria-label="随机活动运行状态">
            {activityStatusLabel}
          </p>
          <ToggleSetting
            label="始终置顶"
            description="让桌宠显示在普通窗口上方"
            checked={settings.pet.alwaysOnTop}
            onChange={(value) => patchPet({ alwaysOnTop: value })}
          />
          <ToggleSetting
            label="全屏时隐藏"
            description="演示、视频或游戏全屏时暂时休息"
            checked={settings.pet.hideInFullscreen}
            onChange={(value) => patchPet({ hideInFullscreen: value })}
          />
          <ToggleSetting
            label="点击穿透"
            description="鼠标操作直接传递给桌宠下方窗口"
            checked={settings.pet.clickThrough}
            onChange={(value) => patchPet({ clickThrough: value })}
          />
        </section>
      </div>
    </>
  );
}

function ReminderSettings({
  settings,
  patchReminder,
  onAdd,
  onRemove,
}: {
  settings: SettingsV1;
  patchReminder: (id: string, patch: Partial<Reminder>) => void;
  onAdd: (reminder: Reminder) => void;
  onRemove: (id: string) => void;
}) {
  return (
    <>
      <header className="activity-section-header">
        <h2>定时提醒</h2>
        <p>用安静的小气泡提醒你照顾好自己。</p>
      </header>
      <section className="reminder-list">
        {settings.reminders.map((reminder) => (
          <article className="reminder-row" key={reminder.id}>
            <ReminderCopyEditor reminder={reminder} onSave={(patch) => patchReminder(reminder.id, patch)} />
            <select
              className="schedule-kind"
              aria-label={`${reminder.title}计划类型`}
              value={reminder.schedule.kind}
              onChange={(event) =>
                patchReminder(reminder.id, {
                  schedule: scheduleForKind(
                    event.target.value as ReminderSchedule["kind"],
                    reminder.schedule,
                  ),
                })
              }
            >
              <option value="interval">每隔</option>
              <option value="daily">每天</option>
            </select>
            <label className="schedule-field">
              <span className="sr-only">
                {reminder.title}
                {reminder.schedule.kind === "interval" ? "间隔分钟" : "提醒时间"}
              </span>
              {reminder.schedule.kind === "interval" ? (
                <IntervalMinutesField
                  value={reminder.schedule.minutes}
                  onCommit={(minutes) =>
                    patchReminder(reminder.id, {
                      schedule: { kind: "interval", minutes },
                    })
                  }
                />
              ) : (
                <input
                  type="time"
                  value={reminder.schedule.at}
                  onChange={(event) => {
                    // An emptied time input reports "" which the backend
                    // sanitizer rejects, silently dropping the reminder.
                    if (event.target.value === "") return;
                    patchReminder(reminder.id, {
                      schedule: { kind: "daily", at: event.target.value },
                    });
                  }}
                />
              )}
            </label>
            <Switch
              label={reminder.title}
              checked={reminder.enabled}
              onChange={(value) => patchReminder(reminder.id, { enabled: value })}
            />
            <button
              className="icon-button reminder-delete"
              aria-label={`删除提醒 ${reminder.title}`}
              title="删除提醒"
              onClick={() => onRemove(reminder.id)}
            >
              <Trash2 size={15} />
            </button>
          </article>
        ))}
        <button
          className="button button-secondary add-reminder"
          onClick={() =>
            onAdd({
              id: `custom-${Date.now()}`,
              title: "自定义提醒",
              message: "休息一下吧",
              enabled: true,
              schedule: { kind: "interval", minutes: 30 },
              snoozeMinutes: 5,
            })
          }
        >
          ＋ 添加提醒
        </button>
      </section>
    </>
  );
}

function ReminderCopyEditor({
  reminder,
  onSave,
}: {
  reminder: Reminder;
  onSave: (patch: Partial<Reminder>) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(reminder.title);
  const [message, setMessage] = useState(reminder.message);
  const valid = title.trim().length > 0 && message.trim().length > 0;
  if (!editing)
    return (
      <div className="reminder-copy">
        <strong>{reminder.title}</strong>
        <span>{reminder.message}</span>
        <button
          type="button"
          className="reminder-edit-button"
          aria-label={`编辑提醒 ${reminder.title}`}
          onClick={() => {
            setTitle(reminder.title);
            setMessage(reminder.message);
            setEditing(true);
          }}
        >
          编辑内容
        </button>
      </div>
    );
  return (
    <form
      className="reminder-copy reminder-copy-editor"
      aria-label={`编辑提醒 ${reminder.title}`}
      onSubmit={(event) => {
        event.preventDefault();
        if (!valid) return;
        onSave({ title: title.trim(), message: message.trim() });
        setEditing(false);
      }}
    >
      <label>
        提醒标题
        <input autoFocus value={title} maxLength={60} onChange={(event) => setTitle(event.target.value)} />
      </label>
      <label>
        提醒内容
        <textarea
          value={message}
          maxLength={240}
          rows={2}
          onChange={(event) => setMessage(event.target.value)}
        />
      </label>
      {!valid && <small role="alert">标题和内容不能为空。</small>}
      <div>
        <button className="button button-secondary" type="submit" disabled={!valid}>
          保存内容
        </button>{" "}
        <button className="button button-secondary" type="button" onClick={() => setEditing(false)}>
          取消
        </button>
      </div>
    </form>
  );
}

function PetLibrary({
  catalog,
  error,
  updateAvailable = false,
  selectedPets,
  onRefresh,
  onInstall,
  onToggle,
  onUninstall,
  installedPets = [],
  installProgress = {},
  localPets,
  localPetFolder,
  localPetErrors,
  onOpenLocalPetFolder,
  onLocalPetRefresh,
  onCustomPetsDirPick,
  onOpenPetGallery,
  onOpenPetDex,
}: {
  catalog?: PetCatalogV1 | null;
  error?: string | null;
  updateAvailable?: boolean;
  selectedPets: PetSelection[];
  onRefresh?: () => void;
  onInstall?: (id: string, version: string) => void;
  onToggle?: (id: string, version: string) => void;
  onUninstall?: (id: string, version: string) => void;
  installedPets?: InstalledPet[];
  installProgress?: Record<string, InstallProgress>;
  localPets: LocalPetV1[];
  localPetFolder?: string;
  localPetErrors: string[];
  onOpenLocalPetFolder?: () => void;
  onLocalPetRefresh?: () => void;
  onCustomPetsDirPick?: () => Promise<string | null>;
  onOpenPetGallery?: () => void;
  onOpenPetDex?: () => void;
}) {
  const catalogPets = catalog?.pets ?? [];
  // A missing/offline catalog must not hide installed pets (including older
  // versions that are no longer listed by the current catalog).
  const pets = [
    ...catalogPets,
    ...installedPets
      .filter(
        (installed) =>
          !catalogPets.some((pet) => pet.id === installed.id && pet.version === installed.version),
      )
      .map((installed) => ({
        ...installed,
        description: "已保存在本机，离线也可使用。",
        author: "",
        assetLicense: "",
        previewUrl: undefined,
      })),
  ];
  const isSelected = (id: string, version: string) =>
    selectedPets.some((pet) => pet.id === id && pet.version === version);
  // Single-pet mode: tapping a non-active pet switches the desktop to it; the
  // active pet has nothing to toggle.
  const toggleButton = (id: string, version: string) => {
    if (isSelected(id, version)) {
      return (
        <button className="button button-secondary pet-toggle active" title="当前使用的桌宠" disabled>
          使用中
        </button>
      );
    }
    return (
      <button
        className="button button-primary"
        title="切换为当前桌宠"
        onClick={() => onToggle?.(id, version)}
      >
        使用
      </button>
    );
  };
  return (
    <>
      <aside className="pet-gallery-recommendation" aria-label="推荐宠物库">
        <div>
          <strong>推荐：Codex Pet Gallery</strong>
          <p>浏览、预览和下载社区制作的 Codex 宠物。</p>
          <small>下载后放入下方文件夹；DeskMate 会自动识别 Codex v1 / v2 图集。</small>
        </div>
        <a
          className="button button-secondary"
          href={PET_GALLERY_URL}
          onClick={(event) => {
            event.preventDefault();
            onOpenPetGallery?.();
          }}
        >
          <ExternalLink size={15} />
          浏览 Codex Pet Gallery
        </a>
        <a
          className="button button-secondary"
          href={PETDEX_URL}
          onClick={(event) => {
            event.preventDefault();
            onOpenPetDex?.();
          }}
        >
          <ExternalLink size={15} />
          打开 PetDex
        </a>
      </aside>
      <section className="local-pet-panel" aria-label="自定义宠物导入">
        <div>
          <strong>自定义宠物文件夹</strong>
          <p>每只宠物放一个子文件夹，里面放 pet.json 和 spritesheet.webp。</p>
          {localPetFolder && <code title={localPetFolder}>{localPetFolder}</code>}
        </div>
        <div className="local-pet-actions">
          <button className="button button-secondary" onClick={onOpenLocalPetFolder}>
            <FolderOpen size={15} />
            打开自定义宠物文件夹
          </button>
          <button className="button button-secondary" onClick={onLocalPetRefresh}>
            <RefreshCw size={15} />
            重新扫描
          </button>
          {onCustomPetsDirPick && (
            <button className="button button-secondary" onClick={() => void onCustomPetsDirPick()}>
              <FolderSearch size={15} />
              更改文件夹
            </button>
          )}
        </div>
      </section>
      {localPetErrors.length > 0 && (
        <div className="local-pet-errors" role="status">
          {localPetErrors.map((message, index) => (
            <span key={`${index}-${message}`}>{message}</span>
          ))}
        </div>
      )}
      <LocalPetTrash folderPath={localPetFolder} />
      {localPets.map((pet) => (
        <article className="catalog-pet-row local-pet-row" key={`${pet.id}@local`}>
          <PetThumbnail
            displayName={pet.displayName}
            spritesheetPath={pet.spritesheetPath}
            assetRevision={pet.assetRevision}
            spriteVersionNumber={pet.spriteVersionNumber}
          />
          <div className="pet-library-copy">
            <strong>{pet.displayName}</strong>
            <p>{pet.description}</p>
            <small>
              本机文件夹 · {pet.folderName} · Codex v{pet.spriteVersionNumber}
            </small>
          </div>
          <div className="pet-library-actions">
            {toggleButton(pet.id, "local")}
            <button
              className="button button-danger"
              title="移入宠物回收站，可恢复"
              aria-label={`移入回收站 ${pet.displayName}`}
              onClick={() => onUninstall?.(pet.id, "local")}
            >
              <Trash2 size={15} />
              移入回收站
            </button>
          </div>
        </article>
      ))}
      <div className="library-toolbar">
        <span>
          {error
            ? "通过 GitHub 刷新官方宠物目录。"
            : "官方 GitHub 预置宠物可刷新目录查看。宠物包在安装前会验证哈希与图集结构。"}
        </span>
        <button className="button button-secondary refresh-button" onClick={onRefresh}>
          <RefreshCw size={15} />
          刷新目录
          {updateAvailable && <span className="refresh-dot" aria-label="有新宠物可用" />}
        </button>
      </div>
      {error && (
        <p className="local-pet-errors" role="alert">
          {error}
        </p>
      )}
      {BUILT_IN_PETS.map((pet) => (
        <article className="library-row" key={`${pet.id}@${pet.version}`}>
          <PetThumbnail
            displayName={pet.displayName}
            spritesheetPath={pet.spritesheetUrl}
            spriteVersionNumber={pet.spriteVersionNumber}
          />
          <div className="pet-library-copy">
            <strong>{pet.displayName}</strong>
            <p>{pet.description}</p>
            <span className="installed-label">
              已安装 · {isSelected(pet.id, pet.version) ? "当前使用" : "可使用"}
            </span>
          </div>
          <div className="pet-library-actions">{toggleButton(pet.id, pet.version)}</div>
        </article>
      ))}
      {pets
        .filter(
          (pet) => !BUILT_IN_PETS.some((builtIn) => builtIn.id === pet.id && builtIn.version === pet.version),
        )
        .map((pet) => {
          const installed = installedPets.find((item) => item.id === pet.id && item.version === pet.version);
          const progress = installProgress[`${pet.id}@${pet.version}`];
          const percent =
            progress && progress.total > 0
              ? Math.min(100, Math.round((progress.downloaded / progress.total) * 100))
              : 0;
          return (
            <article className="catalog-pet-row" key={`${pet.id}@${pet.version}`}>
              <PetThumbnail
                displayName={pet.displayName}
                previewUrl={installed ? undefined : pet.previewUrl}
                spritesheetPath={installed?.spritesheetPath}
                spriteVersionNumber={installed?.spriteVersionNumber ?? pet.spriteVersionNumber}
              />
              <div className="pet-library-copy">
                <strong>
                  {pet.displayName} · v{pet.version}
                </strong>
                <p>{pet.description}</p>
                {pet.author && (
                  <small>
                    {pet.author} · {pet.assetLicense}
                  </small>
                )}
              </div>
              <div className="pet-library-actions">
                {installed ? (
                  <>
                    <span className="installed-label">已下载</span>
                    {toggleButton(pet.id, pet.version)}
                    <button
                      className="button button-danger"
                      title="删除"
                      onClick={() => onUninstall?.(pet.id, pet.version)}
                    >
                      <Trash2 size={15} />
                    </button>
                  </>
                ) : progress ? (
                  <div className="download-progress" role="progressbar" aria-valuenow={percent}>
                    <span>{progress.total > 0 ? `下载中 ${percent}%` : "准备下载…"}</span>
                    <div className="download-progress-bar">
                      <span style={{ width: `${percent}%` }} />
                    </div>
                  </div>
                ) : (
                  <button
                    className="button button-secondary"
                    onClick={() => onInstall?.(pet.id, pet.version)}
                  >
                    下载
                  </button>
                )}
              </div>
            </article>
          );
        })}
    </>
  );
}

function About({
  settings,
  onCheckUpdates,
  updateUi,
  onInstallUpdate,
  onAutostartChange,
  onOpenProject,
  onShareProject,
}: {
  settings: SettingsV1;
  onCheckUpdates?: () => void;
  updateUi?: UpdateUi;
  onInstallUpdate?: () => void;
  onAutostartChange: (enabled: boolean) => void;
  onOpenProject?: () => void;
  onShareProject?: () => Promise<"shared" | "copied" | "cancelled">;
}) {
  const [shareStatus, setShareStatus] = useState<"idle" | "shared" | "copied">("idle");
  const updateState = updateUi?.state ?? "idle";
  return (
    <>
      <PageHeader title="关于 DeskMate" subtitle="一个开源、安静、只属于你电脑的桌面伙伴。" />
      <div className="about-mark">
        <Heart size={32} fill="currentColor" />
      </div>
      <h2 className="about-title">DeskMate v{pkg.version}</h2>
      <p className="about-intro">陪伴、提醒和可更换宠物都在本机完成</p>
      <p className="about-copy">程序代码采用 MIT 许可证。</p>
      <div className="about-actions">
        <a
          className="button button-secondary"
          href={PROJECT_URL}
          onClick={(event) => {
            event.preventDefault();
            onOpenProject?.();
          }}
        >
          <Github size={16} />
          GitHub 开源仓库
        </a>
        <button
          className="button button-secondary"
          onClick={() =>
            void onShareProject?.().then((result) => {
              if (result === "shared" || result === "copied") setShareStatus(result);
            })
          }
        >
          <Share2 size={16} />
          {shareStatus === "copied" ? "链接已复制" : shareStatus === "shared" ? "已分享" : "一键分享"}
        </button>
        <button
          className="button button-secondary"
          onClick={onCheckUpdates}
          disabled={updateState === "checking"}
        >
          <RefreshCw size={16} />
          {updateState === "checking" ? "正在检查…" : "检查更新"}
        </button>
      </div>
      <p className="about-update-source">
        <Github size={13} />
        {updateUi?.source === "mirror" ? "当前更新来源：备用渠道。" : "当前更新来源：GitHub。"}
      </p>
      {updateState === "checking" && (
        <p className="about-update-status" role="status">
          {updateProgressText(updateUi?.progress)}
        </p>
      )}
      {updateState === "up-to-date" && (
        <p className="about-update-status" role="status">
          已是最新版本。
        </p>
      )}
      {updateState === "error" && (
        <p className="about-update-status" role="alert">
          {updateUi?.error}
        </p>
      )}
      {updateState === "ready" && (
        <div className="about-update-ready" role="status">
          <span>发现新版本 v{updateUi?.version}，已下载完成。</span>
          <button className="button button-primary" onClick={onInstallUpdate}>
            安装并重启
          </button>
        </div>
      )}
      <div className="about-setting">
        <span>
          <strong>开机时启动 DeskMate</strong>
          <small>登录 Windows 后自动出现</small>
        </span>
        <Switch
          label="开机时启动 DeskMate"
          checked={settings.autostartEnabled}
          onChange={onAutostartChange}
        />
      </div>
      <p className="about-privacy">
        <MonitorUp size={17} />
        无账号、无云同步、无遥测。你的设置只留在本机。
      </p>
    </>
  );
}

const REMINDER_MIN_MINUTES = 1;
const REMINDER_MAX_MINUTES = 1440;

function IntervalMinutesField({ value, onCommit }: { value: number; onCommit: (minutes: number) => void }) {
  const [draft, setDraft] = useState(String(value));

  useEffect(() => setDraft(String(value)), [value]);

  // Clamp on commit so an empty or out-of-range draft can never reach the
  // settings store: the backend sanitizer would silently drop such reminders.
  const commitDraft = () => {
    const parsed = Number(draft);
    if (draft.trim() === "" || !Number.isFinite(parsed)) {
      setDraft(String(value));
      return;
    }
    const next = Math.min(REMINDER_MAX_MINUTES, Math.max(REMINDER_MIN_MINUTES, Math.round(parsed)));
    setDraft(String(next));
    if (next !== value) onCommit(next);
  };

  return (
    <>
      <input
        type="number"
        min={REMINDER_MIN_MINUTES}
        max={REMINDER_MAX_MINUTES}
        step={1}
        value={draft}
        aria-label="间隔分钟"
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commitDraft}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            commitDraft();
          }
        }}
      />
      <span>分钟</span>
    </>
  );
}

function scheduleForKind(kind: ReminderSchedule["kind"], current: ReminderSchedule): ReminderSchedule {
  if (kind === current.kind) return current;
  return kind === "interval" ? { kind: "interval", minutes: 30 } : { kind: "daily", at: "15:00" };
}

function RangeSetting({
  label,
  value,
  min,
  max,
  step,
  suffix,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  suffix: string;
  onChange: (value: number) => void;
}) {
  const percentage = ((value - min) / (max - min)) * 100;
  return (
    <label className="setting-row range-row">
      <span>
        <strong>{label}</strong>
        <small>{suffix}</small>
      </span>
      <input
        aria-label={label}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        style={{ "--range-progress": `${percentage}%` } as React.CSSProperties}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
  );
}

function ToggleSetting({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <div className="setting-row toggle-row">
      <span>
        <strong>{label}</strong>
        <small>{description}</small>
      </span>
      <Switch label={label} checked={checked} onChange={onChange} />
    </div>
  );
}

function Switch({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-label={label}
      aria-checked={checked}
      className="switch"
      onClick={() => onChange(!checked)}
    >
      <span />
    </button>
  );
}
