# DeskMate Pet Scaling and Preview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the desktop pet fully visible at 25%–300% scale, add direct percentage input, and show the currently selected pet as a fixed-size non-interactive animated preview.

**Architecture:** Keep the native pet window and sprite visual scale synchronized around a bottom-center anchor. Isolate percentage editing in `PetSizeSetting`, isolate preview timing/rendering in `PetPreview`, and keep monitor-independent geometry in pure Rust functions under `motion.rs`.

**Tech Stack:** Tauri 2, Rust 2021, React 19, TypeScript, Vitest, Testing Library, CSS.

## Global Constraints

- Supported pet scale is exactly `0.25..=3.0` (25%–300%); default remains 100%.
- Slider step is 5%; typed percentage input accepts integers and commits on Enter or blur.
- Settings preview always renders at scale 1 and never emits pet interaction events.
- Native window resize preserves the old bottom-center anchor and clamps to the current monitor work area.
- Existing Codex v1/v2 rendering and the pending exact-file asset-protocol authorization fix must remain intact.
- Do not stage the user's untracked pet folders, `.workbuddy/`, `docs/BUG-ANALYSIS.md`, `fixes.patch`, or `nut`.

---

### Task 1: Scale bounds and percentage editor

**Files:**

- Create: `src/components/PetSizeSetting.tsx`
- Create: `src/components/PetSizeSetting.test.tsx`
- Modify: `src/domain/settings.ts:45-55`
- Modify: `src/domain/settings.test.ts:9-17`
- Modify: `src-tauri/src/settings.rs:62-69,260-285`
- Modify: `src/components/SettingsApp.tsx:223-233`
- Modify: `src/styles.css:230-275`

**Interfaces:**

- Consumes: `scale: number` and `onChange(scale: number): void`.
- Produces: `PetSizeSetting({ scale, onChange })`, emitting values in `0.25..=3.0`.

- [ ] **Step 1: Write failing frontend boundary and editor tests**

```tsx
it("clamps persisted pet scale to 25% and 300%", () => {
  expect(mergeSettings({ schemaVersion: 1, pet: { scale: 0.01 } }).pet.scale).toBe(0.25);
  expect(mergeSettings({ schemaVersion: 1, pet: { scale: 9 } }).pet.scale).toBe(3);
});

it("commits a typed percentage on blur and clamps it", () => {
  const onChange = vi.fn();
  render(<PetSizeSetting scale={1} onChange={onChange} />);
  const input = screen.getByRole("spinbutton", { name: "桌宠大小百分比" });
  fireEvent.change(input, { target: { value: "350" } });
  expect(onChange).not.toHaveBeenCalled();
  fireEvent.blur(input);
  expect(onChange).toHaveBeenCalledWith(3);
});
```

- [ ] **Step 2: Run tests and confirm RED**

Run: `pnpm vitest run src/domain/settings.test.ts src/components/PetSizeSetting.test.tsx`

Expected: FAIL because the old upper bound is 1.5 and `PetSizeSetting` does not exist.

- [ ] **Step 3: Implement shared limits and editor**

```ts
export const MIN_PET_SCALE = 0.25;
export const MAX_PET_SCALE = 3;
```

```tsx
export function PetSizeSetting({ scale, onChange }: PetSizeSettingProps) {
  const percentage = Math.round(scale * 100);
  const [draft, setDraft] = useState(String(percentage));
  useEffect(() => setDraft(String(percentage)), [percentage]);
  const commit = () => {
    const parsed = Number(draft);
    if (!Number.isFinite(parsed) || draft.trim() === "") return setDraft(String(percentage));
    const next = Math.min(300, Math.max(25, Math.round(parsed)));
    setDraft(String(next));
    if (next !== percentage) onChange(next / 100);
  };
  return (
    <label className="setting-row pet-size-row">
      <span>
        <strong>大小</strong>
        <small>{percentage}%</small>
      </span>
      <span className="pet-size-controls">
        <input
          aria-label="大小"
          type="range"
          min={25}
          max={300}
          step={5}
          value={percentage}
          onChange={(event) => onChange(Number(event.target.value) / 100)}
        />
        <span className="percent-input">
          <input
            aria-label="桌宠大小百分比"
            type="number"
            min={25}
            max={300}
            step={1}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={commit}
            onKeyDown={(event) => event.key === "Enter" && event.currentTarget.blur()}
          />
          <span>%</span>
        </span>
      </span>
    </label>
  );
}
```

Use `clamp(numberOr(pet.scale, defaults.pet.scale), MIN_PET_SCALE, MAX_PET_SCALE)` in TypeScript and `self.pet.scale = self.pet.scale.clamp(0.25, 3.0);` in Rust. Replace the size `RangeSetting` in `PetSettings` with `<PetSizeSetting scale={settings.pet.scale} onChange={(scale) => patchPet({ scale })} />`.

- [ ] **Step 4: Run targeted tests and confirm GREEN**

Run: `pnpm vitest run src/domain/settings.test.ts src/components/PetSizeSetting.test.tsx src/components/SettingsApp.test.tsx`

Expected: all targeted tests pass.

- [ ] **Step 5: Commit the editor unit**

```powershell
git add src/domain/settings.ts src/domain/settings.test.ts src/components/PetSizeSetting.tsx src/components/PetSizeSetting.test.tsx src/components/SettingsApp.tsx src/styles.css src-tauri/src/settings.rs
git commit -m "Add direct desktop pet size controls"
```

### Task 2: Native window geometry and clipping fix

**Files:**

- Modify: `src-tauri/src/motion.rs`
- Modify: `src-tauri/src/lib.rs:461-472`
- Modify: `src/styles.css:678-701`
- Modify: `src/components/PetWindow.test.tsx`

**Interfaces:**

- Consumes: `Point`, `WorkArea`, old/new physical window sizes.
- Produces: `resize_around_bottom_center(position, old_width, old_height, new_width, new_height, area) -> Point`.

- [ ] **Step 1: Write failing geometry and container tests**

```rust
#[test]
fn resize_preserves_bottom_center_and_clamps_to_negative_work_area() {
    let area = WorkArea { left: -1920, top: 0, right: 0, bottom: 1040 };
    assert_eq!(
        resize_around_bottom_center(Point { x: -300.0, y: 700.0 }, 192, 208, 576, 624, area),
        Point { x: -492.0, y: 284.0 }
    );
}
```

```tsx
expect(screen.getByLabelText("DeskMate 桌宠窗口")).toHaveClass("pet-window");
```

Add this source regression test to `scripts/workflows.verify.mjs`:

```js
const stylesUrl = new URL("../src/styles.css", import.meta.url);
test("the pet webview fills the resized native window", async () => {
  const styles = await readFile(stylesUrl, "utf8");
  const rule = styles.match(/\.pet-window\s*\{([^}]*)\}/)?.[1] ?? "";
  assert.match(rule, /width:\s*100%/);
  assert.match(rule, /height:\s*100%/);
  assert.match(rule, /display:\s*grid/);
  assert.match(rule, /place-items:\s*end center/);
  assert.doesNotMatch(rule, /width:\s*192px/);
});
```

- [ ] **Step 2: Run tests and confirm RED**

Run: `pnpm vitest run src/components/PetWindow.test.tsx && node --test scripts/workflows.verify.mjs`

Expected: workflow assertion fails because `.pet-window` is still fixed at 192×208; Rust test fails in GitHub Actions until the geometry function exists.

- [ ] **Step 3: Implement geometry and synchronized container**

```rust
pub fn resize_around_bottom_center(
    position: Point,
    old_width: i32,
    old_height: i32,
    new_width: i32,
    new_height: i32,
    area: WorkArea,
) -> Point {
    clamp_to_work_area(
        Point {
            x: position.x + (old_width - new_width) as f64 / 2.0,
            y: position.y + (old_height - new_height) as f64,
        },
        area,
        new_width,
        new_height,
    )
}
```

In `apply_window_settings`, obtain the old physical position and size, current monitor work area, and scale factor; calculate the new physical size, call `set_size(LogicalSize)`, then call `set_position(PhysicalPosition)` with the pure-function result. CSS becomes:

```css
.pet-window {
  width: 100%;
  height: 100%;
  display: grid;
  place-items: end center;
  overflow: hidden;
}
```

- [ ] **Step 4: Run targeted checks and confirm GREEN**

Run: `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check`

Run: `pnpm vitest run src/components/PetWindow.test.tsx && node --test scripts/workflows.verify.mjs`

Expected: formatting and targeted tests pass. Full Rust execution remains delegated to GitHub Actions when local MSVC Build Tools are unavailable.

- [ ] **Step 5: Commit the geometry unit**

```powershell
git add src-tauri/src/motion.rs src-tauri/src/lib.rs src/styles.css src/components/PetWindow.test.tsx scripts/workflows.verify.mjs
git commit -m "Keep scaled desktop pet inside its window"
```

### Task 3: Current-pet animated preview

**Files:**

- Create: `src/components/PetPreview.tsx`
- Create: `src/components/PetPreview.test.tsx`
- Modify: `src/App.tsx`
- Modify: `src/components/SettingsApp.tsx`
- Modify: `src/components/SettingsApp.test.tsx`
- Modify: `src/styles.css`

**Interfaces:**

- Consumes: `PetChangedPayload`, optional display name, and existing `petAssetUrl`.
- Produces: `PetPreview({ pet, displayName })`, fixed at scale 1 and cycling through idle/waving/jumping without interaction events.

- [ ] **Step 1: Write failing animation and selected-pet tests**

```tsx
it("keeps the preview at 100% and cycles without interaction", () => {
  vi.useFakeTimers();
  render(<PetPreview pet={customPet} displayName="工作室小猫" />);
  expect(screen.getByRole("img")).toHaveStyle({ transform: "scale(1)" });
  expect(screen.getByText("工作室小猫 · local")).toBeInTheDocument();
  act(() => vi.advanceTimersByTime(3200));
  expect(screen.getByLabelText("桌宠正在挥手")).toBeInTheDocument();
  expect(tauriMocks.emitEvent).not.toHaveBeenCalled();
  vi.useRealTimers();
});
```

Add this `App` integration test after extending the hoisted Tauri mocks with `petCurrent` and `listenEvent`:

```tsx
it("updates the settings preview when the selected pet changes", async () => {
  let changed: ((payload: PetChangedPayload) => void) | undefined;
  tauriMocks.petCurrent.mockResolvedValue({
    id: "studio-cat",
    version: "local",
    spriteVersionNumber: 2,
    spritesheetPath: "D:\\pets\\studio-cat\\spritesheet.webp",
  });
  tauriMocks.listenEvent.mockImplementation(async (event, handler) => {
    if (event === "pet://changed") changed = handler;
    return () => undefined;
  });
  settingsGetMock.mockResolvedValue({ ...structuredClone(DEFAULT_SETTINGS), onboardingComplete: true });
  render(<App />);
  expect(await screen.findByText("studio-cat · local")).toBeInTheDocument();
  act(() =>
    changed?.({
      id: "new-cat",
      version: "local",
      spriteVersionNumber: 1,
      spritesheetPath: "D:\\pets\\new-cat\\spritesheet.webp",
    }),
  );
  expect(await screen.findByText("new-cat · local")).toBeInTheDocument();
});
```

- [ ] **Step 2: Run tests and confirm RED**

Run: `pnpm vitest run src/components/PetPreview.test.tsx src/components/SettingsApp.test.tsx src/App.test.tsx`

Expected: FAIL because `PetPreview` and the current-pet settings props do not exist.

- [ ] **Step 3: Implement preview and data flow**

```tsx
const PREVIEW_SEGMENTS = [
  { state: "idle", duration: 3000 },
  { state: "waving", duration: 900 },
  { state: "idle", duration: 600 },
  { state: "jumping", duration: 1000 },
  { state: "idle", duration: 500 },
] as const;
```

`PetPreview` increments elapsed time every 100ms, derives the active segment and segment-local elapsed time, renders `PetSprite` without a scale prop, and clears its interval on unmount. Before replacing a non-built-in background URL, it preloads that URL with `new Image()` and updates the last-known-good appearance only from `onload`; `onerror` leaves the prior appearance unchanged. Its test replaces `globalThis.Image` with a controllable fake and verifies both success and failure paths. `App` loads `petCurrent()`, listens to `pet://changed`, and passes the payload to `SettingsApp`. `SettingsApp` resolves the display name from built-in data, `localPets`, or `catalog`, then renders the preview.

- [ ] **Step 4: Run targeted tests and confirm GREEN**

Run: `pnpm vitest run src/components/PetPreview.test.tsx src/components/SettingsApp.test.tsx src/App.test.tsx`

Expected: all preview and integration tests pass.

- [ ] **Step 5: Commit the preview unit**

```powershell
git add src/components/PetPreview.tsx src/components/PetPreview.test.tsx src/components/SettingsApp.tsx src/components/SettingsApp.test.tsx src/App.tsx src/App.test.tsx src/styles.css
git commit -m "Animate the selected pet in settings preview"
```

### Task 4: Integrate pending asset fix and verify release path

**Files:**

- Modify: `src-tauri/src/lib.rs`
- Create: `src-tauri/src/pet_asset_scope.rs`
- Test: all project checks and GitHub Actions.

**Interfaces:**

- Consumes: validated selected spritesheet `Path`.
- Produces: exact-file runtime authorization before `pet://changed` or `pet_current` returns the path.

- [ ] **Step 1: Preserve the existing RED/GREEN regression evidence**

The pending test in `pet_asset_scope.rs` must assert that the exact selected spritesheet path is passed to the authorization callback. The previous RED run failed with unresolved `authorize_selected_asset`; the GREEN metadata compile exits 0 after the helper is added.

- [ ] **Step 2: Run the complete local verification set**

Run: `pnpm verify`

Run: `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check`

Run: `rustc --edition 2021 --test --emit=metadata --out-dir "$env:TEMP" src-tauri/src/pet_asset_scope.rs`

Run: `cargo metadata --manifest-path src-tauri/Cargo.toml --locked --no-deps --format-version 1`

Expected: every command exits 0. Do not claim a local Rust link/test run because this machine lacks MSVC `link.exe` and Windows SDK libraries.

- [ ] **Step 3: Review the final diff and stage only owned files**

Run: `git diff --check`

Run: `git status --short`

Expected: only implementation/test/docs files are staged; user pet folders and unrelated untracked files remain untouched.

- [ ] **Step 4: Commit and push implementation**

```powershell
git add -- src/domain/settings.ts src/domain/settings.test.ts src/components/PetSizeSetting.tsx src/components/PetSizeSetting.test.tsx src/components/PetPreview.tsx src/components/PetPreview.test.tsx src/components/SettingsApp.tsx src/components/SettingsApp.test.tsx src/components/PetWindow.test.tsx src/App.tsx src/App.test.tsx src/styles.css scripts/workflows.verify.mjs src-tauri/src/settings.rs src-tauri/src/motion.rs src-tauri/src/lib.rs src-tauri/src/pet_asset_scope.rs docs/superpowers/plans/2026-07-22-pet-scaling-preview.md
git commit -m "Fix pet scaling and animate settings preview"
git push
```

Expected: push updates `feature/deskmate-v1` and triggers CI plus unsigned Windows preview build.

- [ ] **Step 5: Cloud and manual acceptance**

GitHub Actions must pass `cargo test --manifest-path src-tauri/Cargo.toml` and the Windows preview build. Install the resulting preview and verify custom pet selection plus 25%, 100%, and 300% sizes at monitor edges. No manual check is required before the implementation commit; manual packaged-app verification occurs after the cloud build.
