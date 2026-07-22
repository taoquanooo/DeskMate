# Pet Interactions and Library Previews Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add direction-aware native drag animations, the approved click actions, and static previews for every built-in, local, and official pet library entry.

**Architecture:** Keep native drag direction detection in the 30Hz Rust motion engine because Windows owns the window while it is being dragged. Keep click gesture arbitration in `PetWindow`, and add a focused `PetThumbnail` component that renders either a static atlas frame or an official preview image with a fallback. Local scans expose and authorize only spritesheets that already passed manifest and atlas validation.

**Tech Stack:** Tauri 2, Rust, React 19, TypeScript, Vitest, Testing Library, CSS.

## Global Constraints

- Windows 10/11 x64 remains the only application target.
- Drag animation feedback is enabled only when `roamingEnabled` is false.
- Interaction priority is native drag, click interactions, backend status, roaming, gaze, then idle.
- Single click jumps, double click waves, and right click randomly chooses waving, waiting, or review.
- All pet library previews are static and create no animation timers.
- Invalid local pets and unvalidated files never receive asset protocol authorization.
- Existing untracked pet directories and user files must not be staged.

---

## File Structure

- `src-tauri/src/motion.rs`: pure drag direction classification alongside existing window geometry helpers.
- `src-tauri/src/runtime.rs`: native window drag sampling, animation event emission, and drag-completed signaling.
- `src/components/PetWindow.tsx`: click, double-click, right-click, and dragged-click suppression.
- `src/components/PetWindow.test.tsx`: interaction mapping and gesture priority regression coverage.
- `src-tauri/src/pets.rs`: validated local scan payload including the exact spritesheet path.
- `src-tauri/src/lib.rs`: authorize validated scan results before returning them to the frontend.
- `src/domain/pets.ts`: TypeScript local pet scan contract.
- `src/components/PetThumbnail.tsx`: static atlas/remote preview renderer and fallback.
- `src/components/PetThumbnail.test.tsx`: source selection and load failure coverage.
- `src/components/SettingsApp.tsx`: use thumbnails for built-in, local, and official library rows.
- `src/components/SettingsApp.test.tsx`: library integration coverage.
- `src/styles.css`: consistent thumbnail and library row layout.

---

### Task 1: Native drag direction animation

**Files:**

- Modify: `src-tauri/src/motion.rs`
- Modify: `src-tauri/src/runtime.rs`

**Interfaces:**

- Consumes: `previous: Option<Point>`, `current: Point`, and a physical-pixel threshold.
- Produces: `drag_direction(previous, current, threshold) -> Option<DragDirection>` and `runtime://drag-animation` with `running-left` or `running-right` without changing the backend's resumable animation state.
- Produces: `runtime://drag-moved` once native movement exceeds the threshold during a drag.
- Produces: `runtime://drag-ended` when the native drag ends so the frontend can restore the animation that was active before dragging.

- [ ] **Step 1: Write failing pure Rust tests**

Add to `src-tauri/src/motion.rs` tests:

```rust
#[test]
fn classifies_horizontal_drag_direction_and_ignores_jitter() {
    let from = Some(Point { x: 100.0, y: 50.0 });
    assert_eq!(
        drag_direction(from, Point { x: 104.0, y: 90.0 }, 2.0),
        Some(DragDirection::Right)
    );
    assert_eq!(
        drag_direction(from, Point { x: 96.0, y: 10.0 }, 2.0),
        Some(DragDirection::Left)
    );
    assert_eq!(
        drag_direction(from, Point { x: 101.0, y: 90.0 }, 2.0),
        None
    );
    assert_eq!(drag_direction(None, Point { x: 104.0, y: 90.0 }, 2.0), None);
}
```

- [ ] **Step 2: Verify the test fails for the missing interface**

Run:

```powershell
rustc --edition 2021 --test --emit=metadata --out-dir $env:TEMP src-tauri/src/motion.rs
```

Expected: compile failure because `drag_direction` and `DragDirection` do not exist.

- [ ] **Step 3: Implement the pure direction helper**

Add to `src-tauri/src/motion.rs`:

```rust
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum DragDirection {
    Left,
    Right,
}

pub fn drag_direction(
    previous: Option<Point>,
    current: Point,
    threshold: f64,
) -> Option<DragDirection> {
    let delta = current.x - previous?.x;
    if delta > threshold {
        Some(DragDirection::Right)
    } else if delta < -threshold {
        Some(DragDirection::Left)
    } else {
        None
    }
}
```

- [ ] **Step 4: Make the runtime sample native window movement**

In `start_motion_engine`, retain `last_drag_position`, `drag_direction`, `drag_moved`, and `was_dragging`. While dragging and roaming is disabled, call `window.outer_position()`, classify horizontal movement, emit a direction only when it changes, and emit `runtime://drag-moved` only once. On mouse release, clear the caches and emit `runtime://drag-ended` without replacing the resumable animation:

```rust
if dragging {
    state.moving.store(false, Ordering::Relaxed);
    target = None;
    if !settings.pet.roaming_enabled {
        if let Ok(position) = window.outer_position() {
            let current = Point { x: position.x as f64, y: position.y as f64 };
            if let Some(direction) = drag_direction(last_drag_position, current, 2.0) {
                if !drag_moved {
                    drag_moved = true;
                    let _ = app.emit("runtime://drag-moved", ());
                }
                if drag_animation != Some(direction) {
                    drag_animation = Some(direction);
                    let _ = app.emit("runtime://drag-animation", AnimationPayload {
                        state: match direction {
                            DragDirection::Left => "running-left",
                            DragDirection::Right => "running-right",
                        },
                        direction_degrees: None,
                    });
                }
            }
            last_drag_position = Some(current);
        }
    }
    was_dragging = true;
    continue;
}
if was_dragging {
    was_dragging = false;
    last_drag_position = None;
    drag_animation = None;
    drag_moved = false;
    let _ = app.emit("runtime://drag-ended", ());
}
```

- [ ] **Step 5: Verify formatting and type compilation**

Run:

```powershell
cargo fmt --manifest-path src-tauri/Cargo.toml --check
rustc --edition 2021 --test --emit=metadata --out-dir $env:TEMP src-tauri/src/motion.rs
```

Expected: both commands exit 0. Full Rust test execution remains a GitHub Actions verification because this workstation lacks the MSVC linker and Windows SDK libraries.

- [ ] **Step 6: Commit the native drag behavior**

```powershell
git add -- src-tauri/src/motion.rs src-tauri/src/runtime.rs
git commit -m "Animate native pet dragging direction"
```

---

### Task 2: Approved click and context-menu interactions

**Files:**

- Modify: `src/components/PetWindow.test.tsx`
- Modify: `src/components/PetWindow.tsx`

**Interfaces:**

- Consumes: `runtime://drag-animation`, `runtime://drag-moved`, `runtime://drag-ended`, and existing `runtime://animation` events.
- Produces: single click `jumping`, double click `waving`, and right click one of `waving | waiting | review`.

- [ ] **Step 1: Write failing interaction tests**

Extend the hoisted mocks to capture event handlers and fake timers. Add tests that assert:

```tsx
fireEvent.click(screen.getByLabelText("DeskMate 桌宠窗口"));
act(() => vi.advanceTimersByTime(230));
expect(screen.getByLabelText("桌宠正在跳跃")).toBeInTheDocument();

fireEvent.doubleClick(screen.getByLabelText("DeskMate 桌宠窗口"));
expect(screen.getByLabelText("桌宠正在挥手")).toBeInTheDocument();

vi.spyOn(Math, "random").mockReturnValue(0.5);
fireEvent.contextMenu(screen.getByLabelText("DeskMate 桌宠窗口"));
expect(screen.getByLabelText("桌宠正在等待")).toBeInTheDocument();
```

Add a separate test that invokes the captured `runtime://drag-moved` handler before the 230ms timer and verifies jumping does not start.

- [ ] **Step 2: Run tests and confirm RED**

Run:

```powershell
& '.\node_modules\.bin\vitest.CMD' run src/components/PetWindow.test.tsx
```

Expected: failures showing the existing single click waves, double click jumps, right click is unhandled, and drag movement does not cancel a click.

- [ ] **Step 3: Implement gesture arbitration**

In `PetWindow.tsx`:

- Change the delayed single-click interaction to `jumping` for 1000ms.
- Change double-click to `waving` for 900ms.
- Listen for `runtime://drag-animation`; display its direction without updating `resumeAnimation`.
- Listen for `runtime://drag-moved`; clear `singleClickTimer` and set a `dragMoved` ref.
- Listen for `runtime://drag-ended`; restore `resumeAnimation` with a fresh `startedAt` timestamp.
- Reset `dragMoved` on left pointer down; make `handleClick` consume and clear the flag without scheduling an action.
- Handle `onContextMenu`, call `preventDefault`, choose from the fixed list with `Math.floor(Math.random() * actions.length)`, and play durations matching the atlas rows.

Use this action table:

```ts
const CONTEXT_ACTIONS = [
  { state: "waving", duration: 900 },
  { state: "waiting", duration: 1_100 },
  { state: "review", duration: 1_050 },
] as const;
```

- [ ] **Step 4: Run the focused tests and full frontend suite**

Run:

```powershell
& '.\node_modules\.bin\vitest.CMD' run src/components/PetWindow.test.tsx
pnpm test
```

Expected: focused interaction tests and all frontend tests pass.

- [ ] **Step 5: Commit interactions**

```powershell
git add -- src/components/PetWindow.tsx src/components/PetWindow.test.tsx
git commit -m "Add direct pet interaction actions"
```

---

### Task 3: Validated local thumbnail paths

**Files:**

- Modify: `src-tauri/src/pets.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src/domain/pets.ts`

**Interfaces:**

- Produces: `LocalPetV1.spritesheetPath: string` in TypeScript and `LocalPetV1.spritesheet_path: PathBuf` in Rust.
- Consumes: existing validated `directory.join("spritesheet.webp")` and Tauri `asset_protocol_scope().allow_file`.

- [ ] **Step 1: Write a failing Rust scan assertion**

In the existing `scans_valid_local_pets_and_reports_invalid_folders` test, add:

```rust
assert_eq!(
    scan.pets[0].spritesheet_path,
    valid.join("spritesheet.webp")
);
```

- [ ] **Step 2: Verify the Rust contract fails to compile**

Run:

```powershell
cargo fmt --manifest-path src-tauri/Cargo.toml --check
```

Then run GitHub-equivalent metadata compilation for the file as available. Expected: the test source cannot access the missing `spritesheet_path` field.

- [ ] **Step 3: Add the validated path to the scan result**

Change the Rust and TypeScript structs:

```rust
pub struct LocalPetV1 {
    // existing fields
    pub spritesheet_path: PathBuf,
}
```

```ts
export interface LocalPetV1 {
  // existing fields
  spritesheetPath: string;
}
```

Populate the Rust field only after `validate_local_pet_directory` succeeds:

```rust
spritesheet_path: entry.path().join("spritesheet.webp"),
```

- [ ] **Step 4: Authorize only validated scan results**

After `spawn_blocking` returns a scan in `pet_local_refresh`, retain only entries whose exact file path can be authorized:

```rust
let mut authorized = Vec::with_capacity(scan.pets.len());
for pet in scan.pets {
    match app.asset_protocol_scope().allow_file(&pet.spritesheet_path) {
        Ok(()) => authorized.push(pet),
        Err(error) => scan.errors.push(format!(
            "{}：无法授权预览图集（{error}）",
            pet.folder_name
        )),
    }
}
scan.pets = authorized;
```

- [ ] **Step 5: Update TypeScript fixtures and verify contracts**

Add `spritesheetPath` to every `LocalPetV1` test fixture, then run:

```powershell
pnpm typecheck
cargo fmt --manifest-path src-tauri/Cargo.toml --check
```

Expected: both commands pass.

- [ ] **Step 6: Commit local thumbnail paths**

```powershell
git add -- src-tauri/src/pets.rs src-tauri/src/lib.rs src/domain/pets.ts src/components/SettingsApp.test.tsx
git commit -m "Expose validated local pet thumbnails"
```

---

### Task 4: Static thumbnail component and library integration

**Files:**

- Create: `src/components/PetThumbnail.tsx`
- Create: `src/components/PetThumbnail.test.tsx`
- Modify: `src/components/SettingsApp.tsx`
- Modify: `src/components/SettingsApp.test.tsx`
- Modify: `src/styles.css`

**Interfaces:**

- Consumes: `{ displayName, spritesheetPath?, spriteVersionNumber?, previewUrl? }`.
- Produces: a static accessible thumbnail that prefers `previewUrl`, otherwise renders atlas idle frame 0, and falls back to a heart/paw placeholder after image failure.

- [ ] **Step 1: Write failing component tests**

Create `PetThumbnail.test.tsx` with three cases:

```tsx
render(<PetThumbnail displayName="杨皓" spriteVersionNumber={2} />);
expect(screen.getByRole("img", { name: "杨皓预览" })).toHaveStyle({
  backgroundImage: "url(/pets/yanghao/spritesheet.webp)",
});

render(
  <PetThumbnail
    displayName="工作室小猫"
    spritesheetPath="C:\\pets\\studio-cat\\spritesheet.webp"
    spriteVersionNumber={1}
  />,
);
expect(screen.getByRole("img", { name: "工作室小猫预览" })).toHaveStyle({
  backgroundSize: "1536px 1872px",
});

render(<PetThumbnail displayName="官方宠物" previewUrl="https://example.com/preview.webp" />);
fireEvent.error(screen.getByRole("img", { name: "官方宠物预览" }));
expect(screen.getByLabelText("官方宠物预览暂不可用")).toBeInTheDocument();
```

- [ ] **Step 2: Run tests and confirm the module is missing**

Run:

```powershell
& '.\node_modules\.bin\vitest.CMD' run src/components/PetThumbnail.test.tsx
```

Expected: FAIL because `PetThumbnail` does not exist.

- [ ] **Step 3: Implement the static component**

Create a component that uses a normal `<img>` for `previewUrl`. For atlas previews, call `petAssetUrl(spritesheetPath)` and render `PetSprite` with `state="idle"`, `elapsedMs={0}`, `scale={0.42}`, and the supplied v1/v2 version. Track remote image errors with local state and render a `Heart` placeholder with an accessible label.

- [ ] **Step 4: Write failing library integration assertions**

Extend `SettingsApp.test.tsx` so the library test supplies a local `spritesheetPath` and a catalog entry with `previewUrl`, then asserts all three labels exist:

```tsx
expect(screen.getByRole("img", { name: "杨皓预览" })).toBeInTheDocument();
expect(screen.getByRole("img", { name: "工作室小猫预览" })).toBeInTheDocument();
expect(screen.getByRole("img", { name: "官方小熊预览" })).toHaveAttribute(
  "src",
  "https://example.com/bear-preview.webp",
);
```

- [ ] **Step 5: Integrate thumbnails into every row**

- Put `PetThumbnail` before the text block of every local and official `catalog-pet-row`.
- Replace the built-in library row's animated `PetSprite` with `PetThumbnail`.
- Wrap text in `.pet-library-copy` and actions in `.pet-library-actions` so selectors no longer depend on `nth-of-type`.
- Add a fixed `92px × 92px` `.pet-thumbnail` container, clip atlas frames, and use `object-fit: contain` for official images.

- [ ] **Step 6: Run focused and full verification**

Run:

```powershell
& '.\node_modules\.bin\vitest.CMD' run src/components/PetThumbnail.test.tsx src/components/SettingsApp.test.tsx
pnpm verify
```

Expected: all focused tests and the full frontend verification pass.

- [ ] **Step 7: Commit library thumbnails**

```powershell
git add -- src/components/PetThumbnail.tsx src/components/PetThumbnail.test.tsx src/components/SettingsApp.tsx src/components/SettingsApp.test.tsx src/styles.css
git commit -m "Show static previews in the pet library"
```

---

### Task 5: Release-path verification and push

**Files:**

- Verify all files committed by Tasks 1–4.

**Interfaces:**

- Consumes: the complete feature branch.
- Produces: a pushed branch with passing CI and a downloadable Windows x64 preview artifact.

- [ ] **Step 1: Run local verification from a clean index**

```powershell
pnpm verify
cargo fmt --manifest-path src-tauri/Cargo.toml --check
rustc --edition 2021 --test --emit=metadata --out-dir $env:TEMP src-tauri/src/motion.rs
git diff --check
git status -sb
```

Expected: frontend verification, Rust formatting, pure Rust metadata compilation, and diff checks pass. Only the user's previously untracked files remain outside commits.

- [ ] **Step 2: Push the existing feature branch**

```powershell
git push origin feature/deskmate-v1
```

- [ ] **Step 3: Monitor GitHub Actions**

Use the authenticated GitHub CLI to watch the newest `CI` and `Windows preview` runs for `feature/deskmate-v1`. If either fails, read `gh run view <id> --log-failed`, add a regression test or correct the failing assertion, rerun the relevant local checks, commit, and push again.

Expected: CI passes all frontend and Rust tests; Windows preview uploads a non-expired `DeskMate-Windows-x64` artifact.
