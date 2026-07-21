import { useState } from "react";
import { Bell, Box, CircleHelp, Heart, MonitorUp, PawPrint, RefreshCw, RotateCcw } from "lucide-react";
import type { Reminder, ReminderSchedule } from "../domain/reminders";
import type { PetCatalogV1 } from "../domain/pets";
import type { SettingsV1 } from "../domain/settings";
import { PetSprite } from "./PetSprite";

type Section = "pet" | "reminders" | "library" | "about";

export interface SettingsAppProps {
  initialSettings: SettingsV1;
  onSettingsChange?: (settings: SettingsV1) => void;
  onRecall?: () => void;
  onCheckUpdates?: () => void;
  catalog?: PetCatalogV1 | null;
  catalogError?: string | null;
  onCatalogRefresh?: () => void;
  onPetInstall?: (id: string, version: string) => void;
  onPetSelect?: (id: string, version: string) => void;
  onAutostartChange?: (enabled: boolean) => void;
}

const NAV: Array<{ id: Section; label: string; icon: typeof PawPrint }> = [
  { id: "pet", label: "桌宠", icon: PawPrint },
  { id: "reminders", label: "提醒", icon: Bell },
  { id: "library", label: "宠物库", icon: Box },
  { id: "about", label: "关于", icon: CircleHelp },
];

export function SettingsApp({
  initialSettings,
  onSettingsChange,
  onRecall,
  onCheckUpdates,
  catalog,
  catalogError,
  onCatalogRefresh,
  onPetInstall,
  onPetSelect,
  onAutostartChange,
}: SettingsAppProps) {
  const [settings, setSettings] = useState(initialSettings);
  const [section, setSection] = useState<Section>("pet");

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
          运行中
          <small>DeskMate v0.1.0</small>
        </div>
      </aside>
      <section className="settings-main">
        {section === "pet" && <PetSettings settings={settings} patchPet={patchPet} onRecall={onRecall} />}
        {section === "reminders" && (
          <ReminderSettings
            settings={settings}
            patchReminder={patchReminder}
            onAdd={(reminder) => persist({ ...settings, reminders: [...settings.reminders, reminder] })}
          />
        )}
        {section === "library" && (
          <PetLibrary
            catalog={catalog}
            error={catalogError}
            selected={settings.selectedPet}
            onRefresh={onCatalogRefresh}
            onInstall={onPetInstall}
            onSelect={onPetSelect}
          />
        )}
        {section === "about" && (
          <About
            settings={settings}
            onCheckUpdates={onCheckUpdates}
            onAutostartChange={(enabled) => {
              persist({ ...settings, autostartEnabled: enabled });
              onAutostartChange?.(enabled);
            }}
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
  patchPet,
  onRecall,
}: {
  settings: SettingsV1;
  patchPet: (patch: Partial<SettingsV1["pet"]>) => void;
  onRecall?: () => void;
}) {
  return (
    <>
      <PageHeader title="桌宠设置" subtitle="自定义你的桌面伙伴，让陪伴更合你心意。" />
      <div className="pet-settings-grid">
        <section className="pet-preview" aria-label="桌宠预览">
          <div className="preview-bubble">
            <strong>今天也一起加油吧！</strong>
            <span>点我会和你打招呼</span>
          </div>
          <div className="sprite-stage">
            <PetSprite state="idle" elapsedMs={380} scale={settings.pet.scale} />
          </div>
          <div className="pet-identity">
            <strong>杨皓 · v1.0.0</strong>
            <span>
              <i className="status-dot" />
              已是最新版本
            </span>
          </div>
          <button className="button button-secondary" onClick={onRecall}>
            <RotateCcw size={16} />
            召回当前屏幕
          </button>
        </section>
        <section className="setting-list" aria-label="桌宠行为设置">
          <RangeSetting
            label="大小"
            value={settings.pet.scale}
            min={0.75}
            max={1.5}
            step={0.05}
            suffix={`${Math.round(settings.pet.scale * 100)}%`}
            onChange={(value) => patchPet({ scale: value })}
          />
          <RangeSetting
            label="移动速度"
            value={settings.pet.speed}
            min={40}
            max={140}
            step={5}
            suffix={`${settings.pet.speed} px/s`}
            onChange={(value) => patchPet({ speed: value })}
          />
          <ToggleSetting
            label="自动漫游"
            description="在各个屏幕的可用区域里自由走动"
            checked={settings.pet.roamingEnabled}
            onChange={(value) => patchPet({ roamingEnabled: value })}
          />
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
}: {
  settings: SettingsV1;
  patchReminder: (id: string, patch: Partial<Reminder>) => void;
  onAdd: (reminder: Reminder) => void;
}) {
  return (
    <>
      <PageHeader title="提醒设置" subtitle="用安静的小气泡提醒你照顾好自己。" />
      <section className="reminder-list">
        {settings.reminders.map((reminder) => (
          <article className="reminder-row" key={reminder.id}>
            <div className="reminder-copy">
              <strong>{reminder.title}</strong>
              <span>{reminder.message}</span>
            </div>
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
                <>
                  <input
                    type="number"
                    min={1}
                    max={1440}
                    value={reminder.schedule.minutes}
                    onChange={(event) =>
                      patchReminder(reminder.id, {
                        schedule: { kind: "interval", minutes: Number(event.target.value) },
                      })
                    }
                  />
                  <span>分钟</span>
                </>
              ) : (
                <input
                  type="time"
                  value={reminder.schedule.at}
                  onChange={(event) =>
                    patchReminder(reminder.id, { schedule: { kind: "daily", at: event.target.value } })
                  }
                />
              )}
            </label>
            <Switch
              label={reminder.title}
              checked={reminder.enabled}
              onChange={(value) => patchReminder(reminder.id, { enabled: value })}
            />
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

function PetLibrary({
  catalog,
  error,
  selected,
  onRefresh,
  onInstall,
  onSelect,
}: {
  catalog?: PetCatalogV1 | null;
  error?: string | null;
  selected: SettingsV1["selectedPet"];
  onRefresh?: () => void;
  onInstall?: (id: string, version: string) => void;
  onSelect?: (id: string, version: string) => void;
}) {
  const pets = catalog?.pets ?? [];
  return (
    <>
      <PageHeader title="宠物库" subtitle="从 DeskMate 官方目录选择你的桌面伙伴。" />
      <div className="library-toolbar">
        <span>
          {error ? "暂时无法连接官方目录，内置宠物仍可使用。" : "宠物包在安装前会验证哈希与图集结构。"}
        </span>
        <button className="button button-secondary" onClick={onRefresh}>
          <RefreshCw size={15} />
          刷新目录
        </button>
      </div>
      <article className="library-row">
        <PetSprite state="waving" elapsedMs={140} scale={0.5} />
        <div>
          <strong>杨皓</strong>
          <p>友善的骑行伙伴</p>
          <span className="installed-label">
            已安装 · {selected.id === "yanghao" ? "当前使用" : "可使用"}
          </span>
        </div>
        {selected.id !== "yanghao" && (
          <button className="button button-primary" onClick={() => onSelect?.("yanghao", "1.0.0")}>
            使用
          </button>
        )}
      </article>
      {pets
        .filter((pet) => !(pet.id === "yanghao" && pet.version === "1.0.0"))
        .map((pet) => (
          <article className="catalog-pet-row" key={`${pet.id}@${pet.version}`}>
            <div>
              <strong>
                {pet.displayName} · v{pet.version}
              </strong>
              <p>{pet.description}</p>
              <small>
                {pet.author} · {pet.assetLicense}
              </small>
            </div>
            <div>
              <button className="button button-secondary" onClick={() => onInstall?.(pet.id, pet.version)}>
                下载
              </button>
              <button className="button button-primary" onClick={() => onSelect?.(pet.id, pet.version)}>
                使用
              </button>
            </div>
          </article>
        ))}
    </>
  );
}

function About({
  settings,
  onCheckUpdates,
  onAutostartChange,
}: {
  settings: SettingsV1;
  onCheckUpdates?: () => void;
  onAutostartChange: (enabled: boolean) => void;
}) {
  return (
    <>
      <PageHeader title="关于 DeskMate" subtitle="一个开源、安静、只属于你电脑的桌面伙伴。" />
      <div className="about-mark">
        <Heart size={32} fill="currentColor" />
      </div>
      <h2 className="about-title">DeskMate v0.1.0</h2>
      <p className="about-copy">程序代码采用 MIT 许可证；杨皓宠物素材采用独立素材许可。</p>
      <button className="button button-secondary" onClick={onCheckUpdates}>
        <RefreshCw size={16} />
        检查更新
      </button>
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
