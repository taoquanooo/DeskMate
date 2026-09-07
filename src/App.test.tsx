import { DEFAULT_SETTINGS } from "./domain/settings";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PetChangedPayload } from "./lib/tauri";
import type { PetCatalogV1 } from "./domain/pets";

const tauriMocks = vi.hoisted(() => ({
  listenEvent: vi.fn(),
  petCurrent: vi.fn(),
  settingsGet: vi.fn(),
  settingsPatch: vi.fn(),
  petCatalogGet: vi.fn(),
  petCatalogRefresh: vi.fn(),
  installedPets: vi.fn(),
  petInstall: vi.fn(),
}));

vi.mock("./lib/tauri", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./lib/tauri")>()),
  listenEvent: tauriMocks.listenEvent,
  petCurrent: tauriMocks.petCurrent,
  settingsGet: tauriMocks.settingsGet,
  settingsPatch: tauriMocks.settingsPatch,
  petCatalogGet: tauriMocks.petCatalogGet,
  petCatalogRefresh: tauriMocks.petCatalogRefresh,
  installedPets: tauriMocks.installedPets,
  petInstall: tauriMocks.petInstall,
}));

import { App, loadInitialSettings } from "./App";

const cachedCatalog: PetCatalogV1 = {
  schemaVersion: 1,
  generatedAt: "2026-09-06T00:00:00Z",
  pets: [
    {
      id: "cached-bear",
      version: "1.0.0",
      displayName: "缓存小熊",
      description: "已缓存的官方宠物",
      author: "DeskMate",
      assetLicense: "MIT",
      spriteVersionNumber: 2,
      minAppVersion: "0.1.1",
      previewUrl: "https://example.com/bear.png",
      packageUrl: "https://github.com/taoquanooo/DeskMate/releases/download/pets-v1/cached-bear-1.0.0.zip",
      sha256: "a".repeat(64),
      sizeBytes: 1024,
    },
  ],
};

const downloadedBear = {
  id: "cached-bear",
  version: "1.0.0",
  displayName: "缓存小熊",
  spriteVersionNumber: 2 as const,
  spritesheetPath: "/pets/cached-bear/spritesheet.webp",
};

describe("DeskMate settings startup", () => {
  it("persists activity preferences through IPC and reloads them without changing the pet scale", async () => {
    let saved = {
      ...structuredClone(DEFAULT_SETTINGS),
      onboardingComplete: true,
      pet: { ...DEFAULT_SETTINGS.pet, scale: 0.8, roamingEnabled: false },
    };
    tauriMocks.settingsGet.mockImplementation(async () => structuredClone(saved));
    tauriMocks.settingsPatch.mockImplementation(async (patch) => {
      saved = { ...saved, ...patch };
      return structuredClone(saved);
    });
    const first = render(<App />);
    fireEvent.click(await screen.findByRole("switch", { name: "随机活动" }));
    await act(async () => undefined);
    fireEvent.click(screen.getByRole("button", { name: "活动" }));
    fireEvent.change(screen.getByRole("combobox", { name: "活动频率" }), { target: { value: "active" } });
    await act(async () => undefined);
    expect(saved.randomActivity).toMatchObject({ enabled: true, frequency: "active" });
    expect(saved.pet).toMatchObject({ scale: 0.8, roamingEnabled: false });
    first.unmount();
    render(<App />);
    expect(await screen.findByRole("switch", { name: "随机活动" })).toHaveAttribute("aria-checked", "true");
    fireEvent.click(screen.getByRole("button", { name: "活动" }));
    expect(screen.getByRole("combobox", { name: "活动频率" })).toHaveValue("active");
  });
  beforeEach(() => {
    tauriMocks.settingsGet.mockReset();
    tauriMocks.petCurrent.mockReset();
    tauriMocks.listenEvent.mockReset();
    tauriMocks.settingsPatch.mockReset();
    tauriMocks.petCatalogGet.mockReset().mockResolvedValue(null);
    tauriMocks.petCatalogRefresh.mockReset().mockRejectedValue(new Error("offline"));
    tauriMocks.installedPets.mockReset().mockResolvedValue([]);
    tauriMocks.petInstall.mockReset().mockResolvedValue(undefined);
    tauriMocks.settingsPatch.mockResolvedValue(structuredClone(DEFAULT_SETTINGS));
    tauriMocks.petCurrent.mockResolvedValue({
      id: "yanghao",
      version: "1.0.0",
      spriteVersionNumber: 2,
      spritesheetPath: null,
    });
    tauriMocks.listenEvent.mockResolvedValue(() => undefined);
    window.history.replaceState({}, "", "/?view=settings");
  });

  it("opens the saved catalog offline without a manual refresh", async () => {
    tauriMocks.settingsGet.mockResolvedValue({
      ...structuredClone(DEFAULT_SETTINGS),
      onboardingComplete: true,
    });
    tauriMocks.petCatalogGet.mockResolvedValue(cachedCatalog);
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "宠物库" }));

    expect(await screen.findByText("缓存小熊 · v1.0.0")).toBeInTheDocument();
    expect(tauriMocks.petCatalogRefresh).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "刷新目录" }));
    await screen.findByText(/offline/);
    expect(screen.getByText("缓存小熊 · v1.0.0")).toBeInTheDocument();
  });

  it("fills a first-run library when the background catalog arrives", async () => {
    let catalogChanged: ((value: PetCatalogV1) => void) | undefined;
    tauriMocks.settingsGet.mockResolvedValue({
      ...structuredClone(DEFAULT_SETTINGS),
      onboardingComplete: true,
    });
    tauriMocks.listenEvent.mockImplementation(async (event, handler) => {
      if (event === "catalog://updated") catalogChanged = handler;
      return () => undefined;
    });
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "宠物库" }));
    act(() => catalogChanged?.(cachedCatalog));
    expect(await screen.findByText("缓存小熊 · v1.0.0")).toBeInTheDocument();
  });

  it("keeps downloaded pets usable with no catalog", async () => {
    tauriMocks.settingsGet.mockResolvedValue({
      ...structuredClone(DEFAULT_SETTINGS),
      onboardingComplete: true,
    });
    tauriMocks.installedPets.mockResolvedValue([downloadedBear]);
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "宠物库" }));
    const row = (await screen.findByText("缓存小熊 · v1.0.0")).closest("article")!;
    expect(within(row).getByRole("button", { name: "使用" })).toBeEnabled();
    expect(within(row).getByRole("img", { name: "缓存小熊预览" })).toHaveStyle({
      backgroundImage: "url(/pets/cached-bear/spritesheet.webp)",
    });
  });

  it("finishes a download even if the installed event was missed and the catalog is offline", async () => {
    tauriMocks.settingsGet.mockResolvedValue({
      ...structuredClone(DEFAULT_SETTINGS),
      onboardingComplete: true,
    });
    tauriMocks.petCatalogGet.mockResolvedValue(cachedCatalog);
    tauriMocks.installedPets.mockResolvedValueOnce([]).mockResolvedValue([downloadedBear]);
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "宠物库" }));
    const row = (await screen.findByText("缓存小熊 · v1.0.0")).closest("article")!;
    fireEvent.click(within(row).getByRole("button", { name: "下载" }));
    expect(await within(row).findByText("已下载")).toBeInTheDocument();
    expect(within(row).queryByRole("progressbar")).not.toBeInTheDocument();
    expect(tauriMocks.petCatalogRefresh).not.toHaveBeenCalled();
  });

  it("does not hide a newly installed pet when a slower startup scan finishes", async () => {
    let finishStartupScan!: (pets: (typeof downloadedBear)[]) => void;
    tauriMocks.settingsGet.mockResolvedValue({
      ...structuredClone(DEFAULT_SETTINGS),
      onboardingComplete: true,
    });
    tauriMocks.petCatalogGet.mockResolvedValue(cachedCatalog);
    tauriMocks.installedPets
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finishStartupScan = resolve;
          }),
      )
      .mockResolvedValue([downloadedBear]);
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "宠物库" }));
    const row = (await screen.findByText("缓存小熊 · v1.0.0")).closest("article")!;
    fireEvent.click(within(row).getByRole("button", { name: "下载" }));
    await within(row).findByText("已下载");
    await act(async () => finishStartupScan([]));
    expect(within(row).getByText("已下载")).toBeInTheDocument();
    expect(within(row).getByRole("button", { name: "使用" })).toBeEnabled();
  });

  it("keeps a background catalog update when an older cache response arrives later", async () => {
    let finishCache!: (catalog: PetCatalogV1 | null) => void;
    let catalogChanged: ((catalog: PetCatalogV1) => void) | undefined;
    tauriMocks.settingsGet.mockResolvedValue({
      ...structuredClone(DEFAULT_SETTINGS),
      onboardingComplete: true,
    });
    tauriMocks.petCatalogGet.mockImplementation(
      () =>
        new Promise((resolve) => {
          finishCache = resolve;
        }),
    );
    tauriMocks.listenEvent.mockImplementation(async (event, handler) => {
      if (event === "catalog://updated") catalogChanged = handler;
      return () => undefined;
    });
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "宠物库" }));
    act(() => catalogChanged?.(cachedCatalog));
    await act(async () => finishCache(null));
    expect(screen.getByText("缓存小熊 · v1.0.0")).toBeInTheDocument();
  });

  it("recovers when the first settings request races native startup", async () => {
    tauriMocks.settingsGet
      .mockRejectedValueOnce(new Error("state not ready"))
      .mockResolvedValueOnce(structuredClone(DEFAULT_SETTINGS));

    await expect(loadInitialSettings()).resolves.toEqual(DEFAULT_SETTINGS);
    expect(tauriMocks.settingsGet).toHaveBeenCalledTimes(2);
  });

  it("shows a useful error instead of spinning forever", async () => {
    tauriMocks.settingsGet.mockRejectedValue(new Error("native settings unavailable"));
    window.history.replaceState({}, "", "/?view=settings");

    render(<App />);

    expect(await screen.findByRole("alert")).toHaveTextContent("无法加载设置");
    expect(screen.queryByLabelText("正在加载 DeskMate")).not.toBeInTheDocument();
  });

  it("copies the GitHub link when native sharing is unavailable", async () => {
    tauriMocks.settingsGet.mockResolvedValue({
      ...structuredClone(DEFAULT_SETTINGS),
      onboardingComplete: true,
    });
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    Object.defineProperty(navigator, "share", { configurable: true, value: undefined });
    window.history.replaceState({}, "", "/?view=settings");

    render(<App />);
    await screen.findByRole("heading", { name: "桌宠设置" });
    fireEvent.click(screen.getByRole("button", { name: "关于" }));
    fireEvent.click(screen.getByRole("button", { name: "一键分享" }));

    expect(await screen.findByRole("button", { name: "链接已复制" })).toBeInTheDocument();
    expect(writeText).toHaveBeenCalledWith("https://github.com/taoquanooo/DeskMate");
  });

  it("falls back to a selection copy when clipboard permission is denied", async () => {
    tauriMocks.settingsGet.mockResolvedValue({
      ...structuredClone(DEFAULT_SETTINGS),
      onboardingComplete: true,
    });
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: vi.fn().mockRejectedValue(new Error("permission denied")) },
    });
    Object.defineProperty(navigator, "share", { configurable: true, value: undefined });
    const execCommand = vi.fn().mockReturnValue(true);
    Object.defineProperty(document, "execCommand", { configurable: true, value: execCommand });
    window.history.replaceState({}, "", "/?view=settings");

    render(<App />);
    await screen.findByRole("heading", { name: "桌宠设置" });
    fireEvent.click(screen.getByRole("button", { name: "关于" }));
    fireEvent.click(screen.getByRole("button", { name: "一键分享" }));

    expect(await screen.findByRole("button", { name: "链接已复制" })).toBeInTheDocument();
    expect(execCommand).toHaveBeenCalledWith("copy");
  });

  it("shows a visible error when saving settings fails", async () => {
    tauriMocks.settingsGet.mockResolvedValue({
      ...structuredClone(DEFAULT_SETTINGS),
      onboardingComplete: true,
    });
    tauriMocks.settingsPatch.mockRejectedValue(new Error("disk full"));
    window.history.replaceState({}, "", "/?view=settings");

    render(<App />);
    await screen.findByRole("heading", { name: "桌宠设置" });
    fireEvent.click(screen.getByRole("switch", { name: "自动漫游" }));

    expect(await screen.findByText(/保存设置失败/)).toBeInTheDocument();
    expect(screen.getByText(/disk full/)).toBeInTheDocument();
  });

  it("updates the settings preview when the selected pet changes", async () => {
    let changed: ((payload: PetChangedPayload) => void) | undefined;
    tauriMocks.settingsGet.mockResolvedValue({
      ...structuredClone(DEFAULT_SETTINGS),
      onboardingComplete: true,
    });
    tauriMocks.petCurrent.mockResolvedValue({
      id: "studio-cat",
      version: "local",
      spriteVersionNumber: 2,
      spritesheetPath: "D:\\pets\\studio-cat\\spritesheet.webp",
    });
    tauriMocks.listenEvent.mockImplementation(async (event, handler) => {
      if (event === "pet://changed") changed = handler;
      return () => undefined;
    });
    window.history.replaceState({}, "", "/?view=settings");

    render(<App />);

    expect(await screen.findByText("studio-cat · local")).toBeInTheDocument();
    act(() =>
      changed?.({
        id: "new-cat",
        version: "local",
        spriteVersionNumber: 1,
        spritesheetPath: "D:\\pets\\new-cat\\spritesheet.webp",
      }),
    );
    expect(await screen.findByText("new-cat · local")).toBeInTheDocument();
  });
});
