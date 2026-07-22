import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PetSizeSetting } from "./PetSizeSetting";

describe("PetSizeSetting", () => {
  it("changes size from the 25% to 300% slider", () => {
    const onChange = vi.fn();
    render(<PetSizeSetting scale={1} onChange={onChange} />);

    const slider = screen.getByRole("slider", { name: "大小" });
    expect(slider).toHaveAttribute("min", "25");
    expect(slider).toHaveAttribute("max", "300");
    fireEvent.change(slider, { target: { value: "250" } });

    expect(onChange).toHaveBeenCalledWith(2.5);
  });

  it("waits for blur before committing a typed percentage and clamps it", () => {
    const onChange = vi.fn();
    render(<PetSizeSetting scale={1} onChange={onChange} />);

    const input = screen.getByRole("spinbutton", { name: "桌宠大小百分比" });
    fireEvent.change(input, { target: { value: "350" } });
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.blur(input);

    expect(input).toHaveValue(300);
    expect(onChange).toHaveBeenCalledWith(3);
  });

  it("commits with Enter and restores invalid input", () => {
    const onChange = vi.fn();
    render(<PetSizeSetting scale={1} onChange={onChange} />);

    const input = screen.getByRole("spinbutton", { name: "桌宠大小百分比" });
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "25" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onChange).toHaveBeenCalledWith(0.25);

    fireEvent.change(input, { target: { value: "" } });
    fireEvent.blur(input);
    expect(input).toHaveValue(100);
  });
});
