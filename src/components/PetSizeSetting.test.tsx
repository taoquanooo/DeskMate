import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
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

    expect(input).toHaveValue(350);
    expect(onChange).toHaveBeenCalledWith(3.5);
  });

  it("accepts custom sizes beyond the slider range but bounds them", () => {
    const onChange = vi.fn();
    const Controlled = () => {
      const [scale, setScale] = useState(1);
      return (
        <PetSizeSetting
          scale={scale}
          onChange={(next) => {
            setScale(next);
            onChange(next);
          }}
        />
      );
    };
    render(<Controlled />);

    const input = screen.getByRole("spinbutton", { name: "桌宠大小百分比" });
    fireEvent.change(input, { target: { value: "800" } });
    fireEvent.blur(input);
    expect(onChange).toHaveBeenCalledWith(8);

    const slider = screen.getByRole("slider", { name: "大小" });
    // The thumb stays pinned inside its own 25–300 track.
    expect(slider).toHaveValue("300");
  });

  it("rejects sizes that would make the pet window disappear", () => {
    const onChange = vi.fn();
    render(<PetSizeSetting scale={1} onChange={onChange} />);

    const input = screen.getByRole("spinbutton", { name: "桌宠大小百分比" });
    fireEvent.change(input, { target: { value: "0" } });
    fireEvent.blur(input);
    expect(input).toHaveValue(10);
    expect(onChange).toHaveBeenCalledWith(0.1);

    fireEvent.change(input, { target: { value: "5000" } });
    fireEvent.blur(input);
    expect(input).toHaveValue(1000);
    expect(onChange).toHaveBeenLastCalledWith(10);
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
