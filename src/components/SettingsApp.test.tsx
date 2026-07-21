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
    expect(screen.getByText("杨皓 · v1.0.0")).toBeInTheDocument();
  });

  it("persists a changed roaming preference", () => {
    const onSettingsChange = vi.fn();
    render(<SettingsApp initialSettings={DEFAULT_SETTINGS} onSettingsChange={onSettingsChange} />);
    fireEvent.click(screen.getByRole("switch", { name: "自动漫游" }));
    expect(onSettingsChange).toHaveBeenCalledWith(
      expect.objectContaining({ pet: expect.objectContaining({ roamingEnabled: false }) }),
    );
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

  it("shows scanned custom pets and folder controls in the library", () => {
    const onOpenLocalPetFolder = vi.fn();
    const onLocalPetRefresh = vi.fn();
    const onOpenPetGallery = vi.fn();
    render(
      <SettingsApp
        initialSettings={DEFAULT_SETTINGS}
        localPets={[
          {
            id: "studio-cat",
            version: "local",
            displayName: "工作室小猫",
            description: "来自自定义宠物文件夹",
            folderName: "studio-cat",
          },
        ]}
        localPetFolder="C:\\Users\\tester\\AppData\\Roaming\\studio.deskmate.app\\custom-pets"
        onOpenLocalPetFolder={onOpenLocalPetFolder}
        onLocalPetRefresh={onLocalPetRefresh}
        onOpenPetGallery={onOpenPetGallery}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "宠物库" }));
    expect(screen.getByText("工作室小猫")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "打开自定义宠物文件夹" }));
    fireEvent.click(screen.getByRole("button", { name: "重新扫描" }));
    const galleryLink = screen.getByRole("link", { name: "浏览 Codex Pet Gallery" });
    expect(galleryLink).toHaveAttribute("href", "https://codex-pet.org/zh/");
    fireEvent.click(galleryLink);
    expect(onOpenLocalPetFolder).toHaveBeenCalledOnce();
    expect(onLocalPetRefresh).toHaveBeenCalledOnce();
    expect(onOpenPetGallery).toHaveBeenCalledOnce();
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
