import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
const exportSkill = vi.hoisted(() => vi.fn());
vi.mock("../lib/tauri", () => ({ petSkillExport: exportSkill }));
import { PetCreator } from "./PetCreator";
it("exports the bundled skill offline, copies the prompt and opens pet installation", async () => {
  exportSkill.mockResolvedValue("C:/Downloads/deskmate-create-pet.zip");
  const copy = vi.fn().mockResolvedValue(undefined),
    library = vi.fn();
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: copy } });
  render(<PetCreator onOpenLibrary={library} />);
  fireEvent.click(screen.getByRole("button", { name: "下载制作 skill" }));
  expect(await screen.findByRole("status")).toHaveTextContent("deskmate-create-pet.zip");
  fireEvent.click(screen.getByRole("button", { name: "复制提示词" }));
  expect(await screen.findByRole("button", { name: "提示词已复制" })).toBeInTheDocument();
  expect(copy).toHaveBeenCalledWith(expect.stringContaining("1536×2288"));
  fireEvent.click(screen.getByRole("button", { name: "前往宠物库安装" }));
  expect(library).toHaveBeenCalledTimes(1);
});
