import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PetThumbnail } from "./PetThumbnail";

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
});
