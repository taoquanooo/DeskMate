import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { PetSizeSetting } from "./PetSizeSetting";

describe("PetSizeSetting", () => {
  it("changes size from the slider across the full 10%–1000% range", () => {
    const onChange = vi.fn();
    render(<PetSizeSetting scale={1} onChange={onChange} />);

    const slider = screen.getByRole("slider", { name: "大小" });
    expect(slider).toHaveAttribute("min", "10");
    expect(slider).toHaveAttribute("max", "1000");
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

  it("slider stays in sync with custom typed values across the whole range", () => {
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
    const slider = screen.getByRole("slider", { name: "大小" });

    // Type a large custom value; the slider must reflect it (not pin to an
    // earlier max) so the user can drag it back down smoothly.
    fireEvent.change(input, { target: { value: "800" } });
    fireEvent.blur(input);
    expect(onChange).toHaveBeenCalledWith(8);
    expect(slider).toHaveValue("800");

    // Drag the slider back down — this must actually move the value instead
    // of being stuck because the slider's max was lower than the current value.
    fireEvent.change(slider, { target: { value: "300" } });
    expect(onChange).toHaveBeenCalledWith(3);
    expect(input).toHaveValue(300);
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

  it("labels the controls with the pet name when several pets share the desktop", () => {
    const onChange = vi.fn();
    render(<PetSizeSetting scale={1.5} onChange={onChange} name="尧世渊" />);

    const slider = screen.getByRole("slider", { name: "尧世渊大小" });
    const input = screen.getByRole("spinbutton", { name: "尧世渊大小百分比" });
    expect(screen.getByText("大小 · 尧世渊")).toBeInTheDocument();

    fireEvent.change(slider, { target: { value: "200" } });
    expect(onChange).toHaveBeenCalledWith(2);
    expect(input).toHaveValue(150);
  });
});
