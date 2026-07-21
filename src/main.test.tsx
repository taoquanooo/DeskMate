import { expect, it, vi } from "vitest";

vi.mock("./App", () => ({ App: () => <div>pet</div> }));

it("keeps the native pet window background transparent", async () => {
  window.history.replaceState({}, "", "/?view=pet");
  document.documentElement.className = "";
  document.body.className = "";
  document.body.innerHTML = '<div id="root"></div>';

  await import("./main");

  expect(document.documentElement).toHaveClass("view-pet");
  expect(getComputedStyle(document.documentElement).backgroundColor).toBe("rgba(0, 0, 0, 0)");
});
