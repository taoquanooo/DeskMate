import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PetSprite } from "./PetSprite";

describe("PetSprite", () => {
  it("renders the 270-degree look cell from row 10 column 4", () => {
    render(<PetSprite state="look" directionDegrees={270} elapsedMs={0} />);
    const sprite = screen.getByLabelText("杨皓正在看向 270°");
    expect(sprite).toHaveAttribute("data-row", "10");
    expect(sprite).toHaveAttribute("data-column", "4");
  });

  it("uses the requested animation row and elapsed frame", () => {
    render(<PetSprite state="waving" elapsedMs={140} />);
    const sprite = screen.getByLabelText("杨皓正在挥手");
    expect(sprite).toHaveAttribute("data-row", "3");
    expect(sprite).toHaveAttribute("data-column", "1");
  });
});
