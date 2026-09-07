import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LocalPetTrash } from "./LocalPetTrash";
const mocks = vi.hoisted(() => ({ list: vi.fn(), restore: vi.fn(), listen: vi.fn() }));
vi.mock("../lib/tauri", () => ({
  petTrashList: mocks.list,
  petTrashRestore: mocks.restore,
  listenEvent: mocks.listen,
}));
const pet = { id: "entry-1", displayName: "小猫", folderName: "my-cat", deletedAt: 12345 };
beforeEach(() => {
  mocks.list.mockReset().mockResolvedValue([pet]);
  mocks.restore.mockReset().mockResolvedValue(undefined);
  mocks.listen.mockReset().mockResolvedValue(() => undefined);
});
describe("local pet recovery", () => {
  it("restores a deleted custom pet and confirms recovery", async () => {
    render(<LocalPetTrash folderPath="D:/pets" />);
    fireEvent.click(screen.getByText("宠物回收站"));
    fireEvent.click(await screen.findByRole("button", { name: "恢复 小猫" }));
    await screen.findByText(/已恢复“小猫”/);
    expect(mocks.restore).toHaveBeenCalledWith("entry-1");
    expect(screen.queryByRole("button", { name: "恢复 小猫" })).not.toBeInTheDocument();
  });
  it("keeps the entry recoverable if the destination already exists", async () => {
    mocks.restore.mockRejectedValue(new Error("原位置已有同名文件夹"));
    render(<LocalPetTrash />);
    fireEvent.click(screen.getByText("宠物回收站"));
    fireEvent.click(await screen.findByRole("button", { name: "恢复 小猫" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("同名文件夹");
    expect(screen.getByRole("button", { name: "恢复 小猫" })).toBeEnabled();
  });
  it("refreshes on deletion without allowing an older scan to replace new entries", async () => {
    let receive!: () => void;
    let initial!: (entries: (typeof pet)[]) => void;
    mocks.listen.mockImplementation(async (event, handler) => {
      if (event === "pet://uninstalled") receive = handler;
      return () => undefined;
    });
    mocks.list
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            initial = resolve;
          }),
      )
      .mockResolvedValue([pet]);
    render(<LocalPetTrash />);
    fireEvent.click(screen.getByText("宠物回收站"));
    await act(async () => undefined);
    await act(async () => receive());
    await screen.findByRole("button", { name: "恢复 小猫" });
    await act(async () => initial([]));
    await waitFor(() => expect(screen.getByRole("button", { name: "恢复 小猫" })).toBeInTheDocument());
  });
});
