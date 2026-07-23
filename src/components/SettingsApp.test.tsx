import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "../domain/settings";
import { SettingsApp } from "./SettingsApp";

describe("SettingsApp", () => {
  it("matches the approved desktop settings information architecture", () => {
    render(<SettingsApp initialSettings={DEFAULT_SETTINGS} />);
    expect(screen.getByRole("heading", { name: "桌宠设置" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "桌宠" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "提醒" })).toBeInTheDocument();
    expect(screen.getByText("默认伙伴 · v1.0.0")).toBeInTheDocument();
  });

  it("persists a changed roaming preference", () => {
    const onSettingsChange = vi.fn();
    render(<SettingsApp initialSettings={DEFAULT_SETTINGS} onSettingsChange={onSettingsChange} />);
    fireEvent.click(screen.getByRole("switch", { name: "自动漫游" }));
    expect(onSettingsChange).toHaveBeenCalledWith(
      expect.objectContaining({ pet: expect.objectContaining({ roamingEnabled: false }) }),
    );
  });

  it("keeps the preview at 100% while changing the desktop pet size", () => {
    render(<SettingsApp initialSettings={DEFAULT_SETTINGS} />);
    const preview = screen.getByRole("img");
    expect(preview).toHaveStyle({ transform: "scale(1)" });

    fireEvent.change(screen.getByRole("slider", { name: "大小" }), { target: { value: "300" } });
    expect(preview).toHaveStyle({ transform: "scale(1)" });
  });

  it("opens the reminder editor from the navigation", () => {
    render(<SettingsApp initialSettings={DEFAULT_SETTINGS} />);
    fireEvent.click(screen.getByRole("button", { name: "提醒" }));
    expect(screen.getByRole("heading", { name: "提醒设置" })).toBeInTheDocument();
    expect(screen.getByText("看看远处")).toBeInTheDocument();
  });

  it("labels a daily reminder with its time purpose", () => {
    render(<SettingsApp initialSettings={DEFAULT_SETTINGS} />);
    fireEvent.click(screen.getByRole("button", { name: "提醒" }));
    fireEvent.change(screen.getByRole("combobox", { name: "喝口水吧计划类型" }), {
      target: { value: "daily" },
    });
    expect(screen.getByLabelText("喝口水吧提醒时间")).toHaveAttribute("type", "time");
  });

  it("shows both bundled pets, excludes duplicate catalog entries, and opens both recommendations", () => {
    const onOpenLocalPetFolder = vi.fn();
    const onLocalPetRefresh = vi.fn();
    const onOpenPetGallery = vi.fn();
    const onOpenPetDex = vi.fn();
    render(
      <SettingsApp
        initialSettings={DEFAULT_SETTINGS}
        catalog={{
          schemaVersion: 1,
          generatedAt: "2026-07-22T00:00:00.000Z",
          pets: [
            {
              id: "yanghao",
              version: "1.0.0",
              displayName: "duplicate default",
              description: "should not appear",
              author: "DeskMate",
              assetLicense: "CC-BY-4.0",
              spriteVersionNumber: 2,
              minAppVersion: "0.1.0",
              previewUrl: "https://example.com/default-preview.webp",
              packageUrl: "https://example.com/default.zip",
              sha256: "a".repeat(64),
              sizeBytes: 1024,
            },
            {
              id: "lev-neon",
              version: "1.0.0",
              displayName: "duplicate Lev-neon",
              description: "should not appear",
              author: "DeskMate",
              assetLicense: "CC-BY-4.0",
              spriteVersionNumber: 2,
              minAppVersion: "0.1.0",
              previewUrl: "https://example.com/lev-preview.webp",
              packageUrl: "https://example.com/lev.zip",
              sha256: "a".repeat(64),
              sizeBytes: 1024,
            },
            {
              id: "official-bear",
              version: "1.0.0",
              displayName: "官方小熊",
              description: "来自官方目录",
              author: "DeskMate",
              assetLicense: "CC-BY-4.0",
              spriteVersionNumber: 2,
              minAppVersion: "0.1.0",
              previewUrl: "https://example.com/bear-preview.webp",
              packageUrl: "https://example.com/bear.zip",
              sha256: "a".repeat(64),
              sizeBytes: 1024,
            },
          ],
        }}
        localPets={[
          {
            id: "studio-cat",
            version: "local",
            displayName: "工作室小猫",
            description: "来自自定义宠物文件夹",
            folderName: "studio-cat",
            spriteVersionNumber: 2,
            spritesheetPath: "C:\\pets\\studio-cat\\spritesheet.webp",
          },
        ]}
        localPetFolder="C:\\Users\\tester\\AppData\\Roaming\\studio.deskmate.app\\custom-pets"
        onOpenLocalPetFolder={onOpenLocalPetFolder}
        onLocalPetRefresh={onLocalPetRefresh}
        onOpenPetGallery={onOpenPetGallery}
        {...({ onOpenPetDex } as object)}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "宠物库" }));
    expect(screen.getByRole("img", { name: "默认伙伴预览" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Lev-neon预览" })).toBeInTheDocument();
    expect(
      screen.getByText("一只温暖机灵、认真打磨工具，也懂得等待确认和复盘的金黄色小探索兽。"),
    ).toBeInTheDocument();
    expect(screen.queryByText("duplicate default")).not.toBeInTheDocument();
    expect(screen.queryByText("duplicate Lev-neon")).not.toBeInTheDocument();
    expect(screen.getByRole("img", { name: "工作室小猫预览" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "官方小熊预览" })).toHaveAttribute(
      "src",
      "https://example.com/bear-preview.webp",
    );
    fireEvent.click(screen.getByRole("button", { name: "打开自定义宠物文件夹" }));
    fireEvent.click(screen.getByRole("button", { name: "重新扫描" }));
    const galleryLink = screen.getByRole("link", { name: "浏览 Codex Pet Gallery" });
    expect(galleryLink).toHaveAttribute("href", "https://codex-pet.org/zh/");
    fireEvent.click(galleryLink);
    const petDexLink = screen.getByRole("link", { name: "打开 PetDex" });
    expect(petDexLink).toHaveAttribute("href", "https://petdex.dev/");
    fireEvent.click(petDexLink);
    expect(onOpenLocalPetFolder).toHaveBeenCalledOnce();
    expect(onLocalPetRefresh).toHaveBeenCalledOnce();
    expect(onOpenPetGallery).toHaveBeenCalledOnce();
    expect(onOpenPetDex).toHaveBeenCalledOnce();
  });

  it("links to GitHub and offers one-click sharing in About", async () => {
    const onOpenProject = vi.fn();
    const onShareProject = vi.fn().mockResolvedValue("copied");
    render(
      <SettingsApp
        initialSettings={DEFAULT_SETTINGS}
        onOpenProject={onOpenProject}
        onShareProject={onShareProject}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "关于" }));
    expect(screen.getByText("陪伴、提醒和可更换宠物都在本机完成")).toBeInTheDocument();
    const projectLink = screen.getByRole("link", { name: "GitHub 开源仓库" });
    expect(projectLink).toHaveAttribute("href", "https://github.com/taoquanooo/DeskMate");
    fireEvent.click(projectLink);
    fireEvent.click(screen.getByRole("button", { name: "一键分享" }));
    expect(onOpenProject).toHaveBeenCalledOnce();
    expect(onShareProject).toHaveBeenCalledOnce();
    expect(await screen.findByRole("button", { name: "链接已复制" })).toBeInTheDocument();
  });
});
