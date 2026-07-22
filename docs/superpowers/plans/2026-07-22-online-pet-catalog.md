# Online Pet Catalog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish one v0.1.1 compatibility update for online Codex v1/v2 imports, then publish future official pets through GitHub without putting them in or rebuilding the Windows installer.

**Architecture:** Rust package validation is aligned with the existing local v1/v2 detector, with `ASSET_LICENSE.txt` optional and the installed sprite version detected from the actual atlas. Pet sources then live under `online-pets/<id>` outside Vite's `public` directory; a dependency-free Node builder packages them and a lightweight GitHub Actions workflow uploads ZIPs to `pets-v1` and deploys Pages.

**Tech Stack:** Node.js ESM, Node test runner, PowerShell/bsdtar-compatible ZIP creation, GitHub Actions, GitHub CLI, GitHub Releases, GitHub Pages.

## Global Constraints

- The Windows installer keeps only `public/pets/yanghao` as the offline fallback.
- After the one-time v0.1.1 compatibility release, pet-only changes must not invoke Cargo, Rust, Tauri, NSIS, or a Windows application build.
- The catalog field set and GitHub Release URL allowlist remain unchanged; `spriteVersionNumber` accepts only `1 | 2`.
- Each online pet requires only `pet.json` and `spritesheet.webp`; `ASSET_LICENSE.txt` is optional.
- Online packages may be v1 (`1536x1872`) or v2 (`1536x2288`); a declared manifest version must match the decoded atlas, and omission triggers detection.
- Catalog packages use HTTPS URLs under `github.com/<owner>/<repo>/releases/download/pets-v1/`.
- No new license is granted to pet artwork.

---

### Task 1: Online Package v1/v2 Compatibility

**Files:**
- Modify: `src-tauri/src/pets.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src/domain/pets.ts`
- Modify: `src/domain/pets.test.ts`

**Interfaces:**
- Consumes: online ZIPs containing required `pet.json`, required `spritesheet.webp`, and optional `ASSET_LICENSE.txt`.
- Produces: package validation that detects sprite version `1 | 2`, catalog validation accepting `1 | 2`, and installed-pet resolution that reports the detected version offline.

- [ ] **Step 1: Write failing Rust package tests**

Add tests in `src-tauri/src/pets.rs` proving that a ZIP with a v1 atlas and no `ASSET_LICENSE.txt` validates, a v2 ZIP with the optional license validates, a declared version that conflicts with the atlas fails, and an unexpected file still fails. Use the existing `write_v1_spritesheet` and `write_v2_spritesheet` helpers.

```rust
#[test]
fn package_accepts_detected_v1_without_asset_license() {
    // Build pet.json without spriteVersionNumber and a 1536x1872 spritesheet.
    // Assert validate_package(...) == Ok(()).
}

#[test]
fn package_rejects_declared_version_mismatch() {
    // Declare spriteVersionNumber 2 with a 1536x1872 spritesheet.
    // Assert InvalidSpritesheet.
}
```

- [ ] **Step 2: Run Rust tests and verify RED**

Run: `cargo test --manifest-path src-tauri/Cargo.toml pets::tests`

Expected: FAIL because package validation requires all three files, the manifest requires version 2, and the package validator only accepts v2.

- [ ] **Step 3: Write failing frontend catalog tests**

In `src/domain/pets.test.ts`, add one catalog with `spriteVersionNumber: 1` and assert it validates, then add an entry with `3` and assert rejection.

- [ ] **Step 4: Run frontend tests and verify RED**

Run: `pnpm test -- src/domain/pets.test.ts`

Expected: the v1 catalog test fails with `spriteVersionNumber must be 2`.

- [ ] **Step 5: Implement minimal Rust compatibility**

In `src-tauri/src/pets.rs`:

```rust
pub const ALLOWED_FILES: [&str; 3] = ["pet.json", "spritesheet.webp", "ASSET_LICENSE.txt"];
const REQUIRED_PACKAGE_FILES: [&str; 2] = ["pet.json", "spritesheet.webp"];

pub struct PetManifestV2 {
    // existing id/display_name/description fields
    #[serde(default)]
    pub sprite_version_number: Option<u8>,
    // existing spritesheet_path field
}
```

- Require only `REQUIRED_PACKAGE_FILES` in `validate_package`; continue rejecting paths not in `ALLOWED_FILES`.
- Parse the manifest first and pass its optional declared version to `validate_local_spritesheet`, which detects and fully validates v1/v2.
- In `extract_validated_package`, always copy required files and copy `ASSET_LICENSE.txt` only when present.
- Expose a focused directory loader that reuses `validate_local_pet_directory` and returns the detected version for an exact installed directory.
- In `validate_catalog`, accept only `sprite_version_number == 1 || sprite_version_number == 2`.

In `src-tauri/src/lib.rs`, replace the official-pet hardcoded sprite version `2` in `resolve_pet_payload` with the detected version returned by that exact installed-directory loader.

- [ ] **Step 6: Implement minimal TypeScript compatibility**

Change only the catalog entry contract and validator:

```ts
export interface PetCatalogEntryV1 {
  // existing fields
  spriteVersionNumber: 1 | 2;
}

if (value.spriteVersionNumber !== 1 && value.spriteVersionNumber !== 2) {
  throw new Error("spriteVersionNumber must be 1 or 2");
}
```

Keep the built-in `PetManifestV2` contract unchanged because it describes the packaged Yanghao fallback, not downloaded ZIP parsing.

- [ ] **Step 7: Run focused tests and verify GREEN**

Run: `cargo test --manifest-path src-tauri/Cargo.toml pets::tests`

Expected: all pet package tests pass.

Run: `pnpm test -- src/domain/pets.test.ts`

Expected: all pet domain tests pass.

- [ ] **Step 8: Commit compatibility**

```powershell
git add -- src-tauri/src/pets.rs src-tauri/src/lib.rs src/domain/pets.ts src/domain/pets.test.ts
git commit -m "Support v1 pets in the online catalog"
```

---

### Task 2: Online Pet Builder and Source Migration

**Files:**

- Create: `scripts/online-pets.test.mjs`
- Create: `scripts/build-online-pets.mjs`
- Create: `catalog/pet-placeholder.svg`
- Create: `online-pets/*/pet.json`
- Create: `online-pets/*/spritesheet.webp`
- Remove: `public/pets/{agumon-baby-flame,blue-guga,caocao-bear,hwjin-black,hwjin-white,ikkun,lansha}/**`
- Modify: `package.json`

**Interfaces:**

- Consumes: `online-pets/<id>/pet.json`, `online-pets/<id>/spritesheet.webp`, optional `ASSET_LICENSE.txt`.
- Produces: CLI `node scripts/build-online-pets.mjs --source <dir> --output <dir> --repository <owner/repo> --release-tag pets-v1` and `<output>/pages/catalog/v1/catalog.json`, `<output>/packages/*.zip`.

- [ ] **Step 1: Write the failing builder test**

Create `scripts/online-pets.test.mjs` with a test that runs the wished-for CLI against the repository sources:

```js
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

test("builds seven online pets without placing them in Vite public assets", async () => {
  const output = await mkdtemp(join(tmpdir(), "deskmate-online-pets-"));
  try {
    const result = spawnSync(
      process.execPath,
      [
        "scripts/build-online-pets.mjs",
        "--source",
        "online-pets",
        "--output",
        output,
        "--repository",
        "taoquanooo/DeskMate",
        "--release-tag",
        "pets-v1",
      ],
      { cwd: resolve("."), encoding: "utf8" },
    );
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const catalog = JSON.parse(
      await readFile(join(output, "pages", "catalog", "v1", "catalog.json"), "utf8"),
    );
    assert.equal(catalog.schemaVersion, 1);
    assert.equal(catalog.pets.length, 7);
    assert.equal((await readdir(join(output, "packages"))).length, 7);
    for (const pet of catalog.pets) {
      assert.match(
        pet.packageUrl,
        /^https:\/\/github\.com\/taoquanooo\/DeskMate\/releases\/download\/pets-v1\//,
      );
      assert.match(pet.sha256, /^[a-f0-9]{64}$/);
      assert.ok(pet.sizeBytes > 0);
    }
    for (const id of catalog.pets.map((pet) => pet.id)) {
      assert.equal((await readdir(resolve("public", "pets"))).includes(id), false);
    }
  } finally {
    await rm(output, { recursive: true, force: true });
  }
});
```

Change `package.json` so `test:workflows` runs both workflow and online-pet tests:

```json
"test:workflows": "node --test scripts/workflows.verify.mjs scripts/online-pets.test.mjs"
```

- [ ] **Step 2: Run the test and verify RED**

Run: `pnpm test:workflows`

Expected: the online-pet test fails because `scripts/build-online-pets.mjs` and `online-pets` do not exist.

- [ ] **Step 3: Move the seven sources outside `public`**

Use `git mv` for the seven tracked directories from `public/pets/<id>` to `online-pets/<id>`. Preserve the v1 manifests for `blue-guga` and `ikkun`; do not add a false v2 declaration.

- [ ] **Step 4: Implement the minimal builder**

Create `scripts/build-online-pets.mjs` with these focused functions and CLI:

```js
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const ALLOWED_FILES = ["ASSET_LICENSE.txt", "pet.json", "spritesheet.webp"];

export function readArguments(argv) {
  if (argv.length % 2 !== 0) throw new Error(`missing value for ${argv.at(-1)}`);
  const values = new Map();
  for (let index = 0; index < argv.length; index += 2) values.set(argv[index], argv[index + 1]);
  return {
    source: resolve(values.get("--source") ?? "online-pets"),
    output: resolve(values.get("--output") ?? "online-pets-dist"),
    repository: values.get("--repository") ?? process.env.GITHUB_REPOSITORY,
    releaseTag: values.get("--release-tag") ?? "pets-v1",
  };
}

export async function buildOnlinePets(options) {
  assert(/^[-\w.]+\/[-\w.]+$/.test(options.repository ?? ""), "repository must be owner/name");
  const [owner, repo] = options.repository.split("/");
  const directories = (await readdir(options.source, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .sort((left, right) => left.name.localeCompare(right.name));
  assert(directories.length > 0, "online-pets contains no pet directories");

  await rm(options.output, { recursive: true, force: true });
  const packagesDirectory = join(options.output, "packages");
  const pagesDirectory = join(options.output, "pages");
  await mkdir(packagesDirectory, { recursive: true });
  await mkdir(join(pagesDirectory, "catalog", "v1"), { recursive: true });
  await copyFile(resolve("catalog", "index.html"), join(pagesDirectory, "index.html"));
  await copyFile(resolve("catalog", "pet-placeholder.svg"), join(pagesDirectory, "pet-placeholder.svg"));

  const pets = [];
  const seen = new Set();
  for (const directory of directories) {
    const sourceDirectory = join(options.source, directory.name);
    const names = (await readdir(sourceDirectory)).sort();
    assert(
      names.includes("pet.json") && names.includes("spritesheet.webp"),
      `${directory.name} is incomplete`,
    );
    assert(
      names.every((name) => ALLOWED_FILES.includes(name)),
      `${directory.name} contains unexpected files`,
    );
    const manifest = JSON.parse(await readFile(join(sourceDirectory, "pet.json"), "utf8"));
    assert(manifest.id === directory.name, `${directory.name} manifest id mismatch`);
    assert(
      typeof manifest.displayName === "string" && manifest.displayName.trim(),
      `${directory.name} displayName is required`,
    );
    assert(
      typeof manifest.description === "string" && manifest.description.trim(),
      `${directory.name} description is required`,
    );
    assert(manifest.spritesheetPath === "spritesheet.webp", `${directory.name} spritesheetPath is invalid`);
    const version = manifest.version ?? "1.0.0";
    assert(/^\d+\.\d+\.\d+$/.test(version), `${directory.name} version must be semver`);
    const key = `${manifest.id}@${version}`;
    assert(!seen.has(key), `duplicate online pet ${key}`);
    seen.add(key);

    const spritesheet = await readFile(join(sourceDirectory, "spritesheet.webp"));
    const dimensions = readWebpDimensions(spritesheet);
    const detectedSpriteVersion =
      dimensions.width === 1536 && dimensions.height === 1872
        ? 1
        : dimensions.width === 1536 && dimensions.height === 2288
          ? 2
          : 0;
    assert(detectedSpriteVersion !== 0, `${directory.name} must be a Codex v1 or v2 atlas`);
    assert(
      manifest.spriteVersionNumber === undefined ||
        manifest.spriteVersionNumber === detectedSpriteVersion,
      `${directory.name} declared sprite version does not match the atlas`,
    );

    const stagingDirectory = join(options.output, "staging", directory.name);
    await mkdir(stagingDirectory, { recursive: true });
    const packageNames = names.filter((name) => ALLOWED_FILES.includes(name));
    for (const name of packageNames)
      await copyFile(join(sourceDirectory, name), join(stagingDirectory, name));
    const zipName = `${manifest.id}-${version}.zip`;
    const zipPath = join(packagesDirectory, zipName);
    const archive = spawnSync("tar", ["-a", "-c", "-f", zipPath, "-C", stagingDirectory, ...packageNames], {
      encoding: "utf8",
    });
    assert(archive.status === 0, archive.stderr || `could not create ${zipName}`);
    const zip = await readFile(zipPath);
    const sizeBytes = (await stat(zipPath)).size;
    const sha256 = createHash("sha256").update(zip).digest("hex");
    pets.push({
      id: manifest.id,
      version,
      displayName: manifest.displayName,
      description: manifest.description,
      author: manifest.author ?? "DeskMate contributors",
      assetLicense: manifest.assetLicense ?? "All rights reserved by the respective asset owner",
      spriteVersionNumber: detectedSpriteVersion,
      minAppVersion: manifest.minAppVersion ?? "0.1.0",
      previewUrl: `https://${owner}.github.io/${repo}/pet-placeholder.svg`,
      packageUrl: `https://github.com/${options.repository}/releases/download/${options.releaseTag}/${encodeURIComponent(zipName)}`,
      sha256,
      sizeBytes,
    });
  }

  const catalog = { schemaVersion: 1, generatedAt: new Date().toISOString(), pets };
  await writeFile(
    join(pagesDirectory, "catalog", "v1", "catalog.json"),
    `${JSON.stringify(catalog, null, 2)}\n`,
  );
  await rm(join(options.output, "staging"), { recursive: true, force: true });
  return { catalog, packages: pets.map((pet) => `${pet.id}-${pet.version}.zip`) };
}

function readWebpDimensions(buffer) {
  assert(
    buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WEBP",
    "invalid WebP header",
  );
  let offset = 12;
  while (offset + 8 <= buffer.length) {
    const type = buffer.subarray(offset, offset + 4).toString("ascii");
    const size = buffer.readUInt32LE(offset + 4);
    const data = offset + 8;
    if (type === "VP8X" && size >= 10)
      return { width: buffer.readUIntLE(data + 4, 3) + 1, height: buffer.readUIntLE(data + 7, 3) + 1 };
    if (type === "VP8L" && size >= 5 && buffer[data] === 0x2f) {
      const bits = buffer.readUInt32LE(data + 1);
      return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
    }
    if (
      type === "VP8 " &&
      size >= 10 &&
      buffer[data + 3] === 0x9d &&
      buffer[data + 4] === 0x01 &&
      buffer[data + 5] === 0x2a
    ) {
      return {
        width: buffer.readUInt16LE(data + 6) & 0x3fff,
        height: buffer.readUInt16LE(data + 8) & 0x3fff,
      };
    }
    offset = data + size + (size % 2);
  }
  throw new Error("WebP dimensions not found");
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  buildOnlinePets(readArguments(process.argv.slice(2))).then(
    ({ catalog }) => console.log(JSON.stringify({ ok: true, pets: catalog.pets.length })),
    (error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    },
  );
}
```

Catalog defaults are exact:

```js
const entry = {
  id: manifest.id,
  version: manifest.version ?? "1.0.0",
  displayName: manifest.displayName,
  description: manifest.description,
  author: manifest.author ?? "DeskMate contributors",
  assetLicense: manifest.assetLicense ?? "All rights reserved by the respective asset owner",
  spriteVersionNumber: detectedSpriteVersion,
  minAppVersion: manifest.minAppVersion ?? "0.1.0",
  previewUrl: `https://${owner}.github.io/${repo}/pet-placeholder.svg`,
  packageUrl: `https://github.com/${repository}/releases/download/${releaseTag}/${encodeURIComponent(zipName)}`,
  sha256,
  sizeBytes,
};
```

Create `catalog/pet-placeholder.svg` as a small neutral DeskMate heart/paw placeholder with no embedded external assets.

- [ ] **Step 5: Run the test and verify GREEN**

Run: `pnpm test:workflows`

Expected: both test files pass; generated catalog contains seven entries and seven ZIP packages.

- [ ] **Step 6: Commit the builder**

```powershell
git add -- package.json scripts/online-pets.test.mjs scripts/build-online-pets.mjs catalog/pet-placeholder.svg online-pets public/pets
git commit -m "Build official pets outside the installer"
```

---

### Task 3: Lightweight Pet Publishing Workflow

**Files:**

- Create: `.github/workflows/publish-pets.yml`
- Modify: `scripts/workflows.verify.mjs`

**Interfaces:**

- Consumes: Task 2 CLI and generated `online-pets-dist/packages`, `online-pets-dist/pages`.
- Produces: GitHub Release tag `pets-v1` assets and the deployed Pages catalog.

- [ ] **Step 1: Write the failing workflow contract test**

Append this behavioral test to `scripts/workflows.verify.mjs`:

```js
test("the online pet workflow publishes catalog assets without rebuilding DeskMate", async () => {
  const workflow = await readFile(".github/workflows/publish-pets.yml", "utf8");
  assert.match(workflow, /online-pets\/\*\*/);
  assert.match(workflow, /build-online-pets\.mjs/);
  assert.match(workflow, /gh release upload/);
  assert.match(workflow, /actions\/deploy-pages@v4/);
  assert.doesNotMatch(workflow, /cargo|rust-toolchain|tauri-action|NSIS/i);
});
```

- [ ] **Step 2: Run the workflow test and verify RED**

Run: `node --test scripts/workflows.verify.mjs`

Expected: FAIL because `.github/workflows/publish-pets.yml` does not exist.

- [ ] **Step 3: Implement the lightweight workflow**

Create `.github/workflows/publish-pets.yml`:

```yaml
name: Publish pets

on:
  workflow_dispatch:
  push:
    branches: [main]
    paths:
      - "online-pets/**"
      - "catalog/index.html"
      - "catalog/pet-placeholder.svg"
      - "scripts/build-online-pets.mjs"
      - ".github/workflows/publish-pets.yml"

permissions:
  contents: write
  pages: write
  id-token: write

concurrency:
  group: publish-pets
  cancel-in-progress: false

jobs:
  publish:
    runs-on: windows-latest
    environment:
      name: github-pages
      url: ${{ steps.pages.outputs.page_url }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - name: Build online pet packages and catalog
        run: node scripts/build-online-pets.mjs --source online-pets --output online-pets-dist --repository "${{ github.repository }}" --release-tag pets-v1
      - name: Create pet asset release if needed
        shell: pwsh
        env:
          GH_TOKEN: ${{ github.token }}
        run: |
          gh release view pets-v1 *> $null
          if ($LASTEXITCODE -ne 0) {
            gh release create pets-v1 --title "DeskMate online pets" --notes "Download assets used by the DeskMate online pet catalog."
          }
      - name: Upload versioned pet packages
        shell: pwsh
        env:
          GH_TOKEN: ${{ github.token }}
        run: gh release upload pets-v1 online-pets-dist/packages/*.zip --clobber
      - uses: actions/configure-pages@v5
      - uses: actions/upload-pages-artifact@v3
        with:
          path: online-pets-dist/pages
      - id: pages
        uses: actions/deploy-pages@v4
```

- [ ] **Step 4: Run workflow tests and verify GREEN**

Run: `pnpm test:workflows`

Expected: all workflow and online-pet tests pass.

- [ ] **Step 5: Commit the workflow**

```powershell
git add -- .github/workflows/publish-pets.yml scripts/workflows.verify.mjs
git commit -m "Publish online pets without app builds"
```

---

### Task 4: Version, Documentation, Regression Verification, and PR Update

**Files:**

- Modify: `package.json`
- Modify: `src-tauri/Cargo.toml`
- Modify: `src-tauri/tauri.conf.json`
- Modify: `src/components/SettingsApp.tsx`
- Modify: `README.md`
- Verify: all files changed by Tasks 1-3

**Interfaces:**

- Consumes: the compatibility update, builder, and workflow from Tasks 1-3.
- Produces: DeskMate v0.1.1 metadata, contributor-facing publishing documentation, and a verified PR.

- [ ] **Step 1: Bump the one-time compatibility release to v0.1.1**

Change every application version surface from `0.1.0` to `0.1.1`:

- root `package.json`
- `src-tauri/Cargo.toml` (and the DeskMate package entry in `Cargo.lock` if Cargo refreshes it)
- `src-tauri/tauri.conf.json`
- both visible version labels in `src/components/SettingsApp.tsx`

Do not create or push the `v0.1.1` tag yet; the tag is created only after the PR is merged and CI is green.

- [ ] **Step 2: Document the two-file workflow and compatibility boundary**

Add a short `在线官方宠物` section to `README.md`:

```markdown
### 在线官方宠物

官方宠物源文件放在 `online-pets/<pet-id>/`，每只宠物只需要 `pet.json` 和 `spritesheet.webp`，也可附带 `ASSET_LICENSE.txt`。DeskMate v0.1.1 起，在线官方宠物与本地导入一样兼容 Codex v1/v2 图集。合并到 `main` 后，轻量 GitHub Actions 会自动生成 ZIP、上传宠物资源 Release 并刷新 Pages 目录；v0.1.1 发布后，单独增加或更新宠物不会重新构建 Windows 安装包。

更新已有宠物时，在 `pet.json` 中提高 `version` 后再提交。宠物素材不自动适用本仓库的 MIT 代码许可，发布者必须确认自己拥有分发权限。
```

- [ ] **Step 3: Run fresh complete verification**

Run: `pnpm verify`

Expected: formatting, TypeScript, application tests, Rust compatibility tests, workflow/online-pet tests, bundled Yanghao validation, pet sync and Vite production build all pass.

Run: `cargo test --manifest-path src-tauri/Cargo.toml`

Expected: all Rust tests pass, including the online v1/v2 package tests.

Run: `git diff --check`

Expected: exit 0 with no whitespace errors.

Run: `git status -sb`

Expected: only intended tracked changes plus the user's pre-existing unrelated untracked files; no added official pet remains under `public/pets`.

- [ ] **Step 4: Commit version and documentation**

```powershell
git add -- package.json src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/tauri.conf.json src/components/SettingsApp.tsx README.md
git commit -m "Prepare DeskMate v0.1.1 compatibility release"
```

- [ ] **Step 5: Push and update PR #3**

```powershell
git push
gh pr edit 3 --title "Publish official pets from the online catalog" --body "Prepares the one-time DeskMate v0.1.1 compatibility update, moves seven official pets outside Vite public assets, and adds a lightweight Release/Pages publishing workflow. Online packages support Codex v1/v2; after v0.1.1, pet-only updates no longer require a DeskMate installer build."
```

- [ ] **Step 6: Verify GitHub checks**

Run: `gh pr checks 3 --watch`

Expected: required CI checks pass. After merge, create the signed `v0.1.1` application Release once; future pet-only changes use `pets-v1` and do not create application releases.
