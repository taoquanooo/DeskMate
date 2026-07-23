import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PetSprite } from "./PetSprite";

describe("PetSprite", () => {
  it("renders the 270-degree look cell from row 10 column 4", () => {
    render(<PetSprite state="look" directionDegrees={270} elapsedMs={0} />);
    const sprite = screen.getByLabelText("桌宠正在看向 270°");
    expect(sprite).toHaveAttribute("data-row", "10");
    expect(sprite).toHaveAttribute("data-column", "4");
  });

  it("uses the requested animation row and elapsed frame", () => {
    render(<PetSprite state="waving" elapsedMs={140} />);
    const sprite = screen.getByLabelText("桌宠正在挥手");
    expect(sprite).toHaveAttribute("data-row", "3");
    expect(sprite).toHaveAttribute("data-column", "1");
  });

  it("falls back to idle when a Codex v1 pet receives a look state", () => {
    render(<PetSprite state="look" directionDegrees={270} elapsedMs={390} spriteVersionNumber={1} />);
    const sprite = screen.getByRole("img");
    expect(sprite).toHaveAttribute("data-row", "0");
    expect(sprite).toHaveAttribute("data-column", "2");
    expect(sprite).toHaveStyle({ backgroundSize: "1536px 1872px" });
  });

  it("sizes the layout box by the requested scale so the window never clips the sprite", () => {
    render(<PetSprite state="idle" elapsedMs={0} scale={2.5} />);
    const sprite = screen.getByRole("img");
    expect(sprite).toHaveStyle({
      width: "480px",
      height: "520px",
      backgroundSize: "3840px 5720px",
    });
  });
});
