import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/tauri", () => ({
  petAssetUrl: (path?: string | null) => path ?? "/pets/yanghao/spritesheet.webp",
}));

import { PetThumbnail } from "./PetThumbnail";

class ControlledImage {
  static images: ControlledImage[] = [];
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  src = "";

  constructor() {
    ControlledImage.images.push(this);
  }

  static fail(url: string) {
    ControlledImage.images
      .filter((image) => image.src === url)
      .at(-1)
      ?.onerror?.();
  }

  static load(url: string) {
    ControlledImage.images
      .filter((image) => image.src === url)
      .at(-1)
      ?.onload?.();
  }
}

afterEach(() => {
  ControlledImage.images = [];
  vi.unstubAllGlobals();
});

describe("PetThumbnail", () => {
  it("renders the built-in pet's static idle atlas frame", () => {
    render(<PetThumbnail displayName="杨皓" spriteVersionNumber={2} />);

    expect(screen.getByRole("img", { name: "杨皓预览" })).toHaveStyle({
      backgroundImage: "url(/pets/yanghao/spritesheet.webp)",
    });
  });

  it("uses the supplied v1 atlas dimensions", () => {
    render(
      <PetThumbnail
        displayName="工作室小猫"
        spritesheetPath="C:\\pets\\studio-cat\\spritesheet.webp"
        spriteVersionNumber={1}
      />,
    );

    expect(screen.getByRole("img", { name: "工作室小猫预览" })).toHaveStyle({
      backgroundSize: "1536px 1872px",
    });
  });

  it("shows an accessible placeholder when an official preview fails", () => {
    render(<PetThumbnail displayName="官方宠物" previewUrl="https://example.com/preview.webp" />);

    fireEvent.error(screen.getByRole("img", { name: "官方宠物预览" }));

    expect(screen.getByLabelText("官方宠物预览暂不可用")).toBeInTheDocument();
  });

  it("clears an atlas failure after a different request returns to a repaired atlas", () => {
    vi.stubGlobal("Image", ControlledImage);
    const { rerender } = render(
      <PetThumbnail displayName="本机宠物" spritesheetPath="atlas-a.webp" spriteVersionNumber={2} />,
    );

    act(() => ControlledImage.fail("atlas-a.webp"));
    expect(screen.getByLabelText("本机宠物预览暂不可用")).toBeInTheDocument();

    rerender(<PetThumbnail displayName="本机宠物" spritesheetPath="atlas-b.webp" spriteVersionNumber={2} />);
    rerender(<PetThumbnail displayName="本机宠物" spritesheetPath="atlas-a.webp" spriteVersionNumber={2} />);
    act(() => ControlledImage.load("atlas-a.webp"));

    expect(screen.getByRole("img", { name: "本机宠物预览" })).toBeInTheDocument();
  });

  it("clears an official preview failure after a different URL returns to a repaired preview", () => {
    const { rerender } = render(
      <PetThumbnail displayName="官方宠物" previewUrl="https://example.com/a.webp" />,
    );

    fireEvent.error(screen.getByRole("img", { name: "官方宠物预览" }));
    expect(screen.getByLabelText("官方宠物预览暂不可用")).toBeInTheDocument();

    rerender(<PetThumbnail displayName="官方宠物" previewUrl="https://example.com/b.webp" />);
    rerender(<PetThumbnail displayName="官方宠物" previewUrl="https://example.com/a.webp" />);
    fireEvent.load(screen.getByRole("img", { name: "官方宠物预览" }));

    expect(screen.getByRole("img", { name: "官方宠物预览" })).toBeInTheDocument();
  });
});
