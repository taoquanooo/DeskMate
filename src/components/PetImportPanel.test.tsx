import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  prepare: vi.fn(),
  commit: vi.fn(),
  cancel: vi.fn(),
  pick: vi.fn(),
  drop: vi.fn(),
  listen: vi.fn(),
}));
vi.mock("../lib/tauri", async (original) => ({
  ...(await original<typeof import("../lib/tauri")>()),
  petImportPrepare: mocks.prepare,
  petImportCommit: mocks.commit,
  petImportCancel: mocks.cancel,
  petImportPick: mocks.pick,
  listenFileDrop: mocks.drop,
  listenEvent: mocks.listen,
}));
import { PetImportPanel } from "./PetImportPanel";
const pet = { token: "staged", id: "bear", displayName: "小熊", conflict: null };
beforeEach(() => {
  vi.resetAllMocks();
  mocks.prepare.mockResolvedValue(pet);
  mocks.commit.mockResolvedValue("bear");
  mocks.cancel.mockResolvedValue(undefined);
  mocks.pick.mockResolvedValue("C:/pets/bear.zip");
  mocks.drop.mockResolvedValue(() => {});
  mocks.listen.mockResolvedValue(() => {});
});
it("installs HTTPS URLs, refreshes the library and allows using the new pet", async () => {
  const imported = vi.fn(),
    use = vi.fn();
  render(<PetImportPanel active onImported={imported} onUse={use} />);
  const link = screen.getByLabelText("宠物 ZIP 链接");
  fireEvent.change(link, { target: { value: "http://example.com/bear.zip" } });
  expect(screen.getByRole("button", { name: "下载安装" })).toBeDisabled();
  fireEvent.change(link, { target: { value: "https://example.com/bear.zip" } });
  fireEvent.click(screen.getByRole("button", { name: "下载安装" }));
  expect(await screen.findByText("小熊 安装完成")).toBeInTheDocument();
  expect(mocks.prepare).toHaveBeenCalledWith(expect.any(String), {
    kind: "url",
    url: "https://example.com/bear.zip",
  });
  expect(mocks.commit).toHaveBeenCalledWith("staged", false);
  expect(imported).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole("button", { name: "使用此宠物" }));
  expect(use).toHaveBeenCalledWith("bear");
});
it("requires replacement confirmation, cancellation leaves the existing pet untouched", async () => {
  mocks.prepare.mockResolvedValue({ ...pet, conflict: "已有小熊" });
  render(<PetImportPanel active onImported={vi.fn()} onUse={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: /点击选择 ZIP/ }));
  expect(await screen.findByRole("alertdialog", { name: "确认替换宠物" })).toBeInTheDocument();
  expect(mocks.commit).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "取消" }));
  expect(await screen.findByText("已取消，现有宠物未改变")).toBeInTheDocument();
  expect(mocks.cancel).toHaveBeenCalledWith("staged");
  fireEvent.click(screen.getByRole("button", { name: /点击选择 ZIP/ }));
  await screen.findByRole("alertdialog");
  fireEvent.click(screen.getByRole("button", { name: "替换并保留旧宠物" }));
  await screen.findByText("小熊 安装完成");
  expect(mocks.commit).toHaveBeenCalledWith("staged", true);
});
it("accepts native drop paths and reports errors without installing invalid packages", async () => {
  mocks.prepare.mockRejectedValue(new Error("ZIP 路径越界"));
  render(<PetImportPanel active onImported={vi.fn()} onUse={vi.fn()} />);
  await waitFor(() => expect(mocks.drop).toHaveBeenCalled());
  await act(async () => mocks.drop.mock.calls[0]![0](["C:/pets/bear.zip"]));
  expect(mocks.prepare).toHaveBeenCalledWith(expect.any(String), { kind: "file", path: "C:/pets/bear.zip" });
  expect(screen.getByRole("alert")).toHaveTextContent("ZIP 路径越界");
  expect(mocks.commit).not.toHaveBeenCalled();
});
it("reports a progress subscription failure and still allows importing a local ZIP", async () => {
  mocks.listen.mockRejectedValue(new Error("listener unavailable"));
  render(<PetImportPanel active onImported={vi.fn()} onUse={vi.fn()} />);
  expect(await screen.findByRole("alert")).toHaveTextContent("无法显示安装进度");
  fireEvent.click(screen.getByRole("button", { name: /点击选择 ZIP/ }));
  expect(await screen.findByText("小熊 安装完成")).toBeInTheDocument();
});
it("handles cleanup after an in-flight commit has already consumed the import token", async () => {
  let finish: () => void = () => {};
  mocks.commit.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  mocks.cancel.mockRejectedValue(new Error("任务已经提交"));
  const view = render(<PetImportPanel active onImported={vi.fn()} onUse={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: /点击选择 ZIP/ }));
  await waitFor(() => expect(mocks.commit).toHaveBeenCalledWith("staged", false));
  view.unmount();
  await act(async () => finish());
  expect(mocks.cancel).toHaveBeenCalledWith("staged");
});
