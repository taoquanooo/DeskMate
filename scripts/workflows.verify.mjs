import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const workflowUrl = new URL("../.github/workflows/build-windows.yml", import.meta.url);
const previewConfigUrl = new URL("../src-tauri/tauri.preview.conf.json", import.meta.url);
const tauriConfigUrl = new URL("../src-tauri/tauri.conf.json", import.meta.url);
const cargoManifestUrl = new URL("../src-tauri/Cargo.toml", import.meta.url);
const gitAttributesUrl = new URL("../.gitattributes", import.meta.url);
const stylesUrl = new URL("../src/styles.css", import.meta.url);

test("the cloud preview workflow verifies and uploads an unsigned NSIS installer", async () => {
  const workflow = await readFile(workflowUrl, "utf8");

  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /pull_request:/);
  assert.match(workflow, /permissions:\s*\n\s+contents: read/);
  assert.match(workflow, /runs-on: windows-latest/);
  assert.match(workflow, /run: pnpm verify/);
  assert.match(workflow, /cargo test --manifest-path src-tauri\/Cargo\.toml --target x86_64-pc-windows-msvc/);
  assert.match(
    workflow,
    /pnpm tauri build --ci --config src-tauri\/tauri\.preview\.conf\.json --target x86_64-pc-windows-msvc --bundles nsis/,
  );
  assert.match(workflow, /uses: actions\/upload-artifact@v4/);
  assert.match(workflow, /name: DeskMate-Windows-x64/);
  assert.match(workflow, /src-tauri\/target\/x86_64-pc-windows-msvc\/release\/bundle\/nsis\/\*\.exe/);
  assert.match(workflow, /if-no-files-found: error/);
  assert.match(workflow, /retention-days: 14/);
});

test("the cloud preview flavor does not require updater signing secrets", async () => {
  const config = JSON.parse(await readFile(previewConfigUrl, "utf8"));

  assert.equal(config.bundle.createUpdaterArtifacts, false);
});

test("the updater plugin always has a deserializable startup config", async () => {
  const config = JSON.parse(await readFile(tauriConfigUrl, "utf8"));

  assert.equal(typeof config.plugins?.updater, "object");
  assert.notEqual(config.plugins.updater, null);
  assert.equal(typeof config.plugins.updater.pubkey, "string");
});

test("the Tauri dependency enables the asset protocol used by the app config", async () => {
  const config = JSON.parse(await readFile(tauriConfigUrl, "utf8"));
  const cargoManifest = await readFile(cargoManifestUrl, "utf8");

  assert.equal(config.app.security.assetProtocol.enable, true);
  assert.match(
    cargoManifest,
    /^tauri\s*=\s*\{[^\n]*features\s*=\s*\[[^\]]*"protocol-asset"[^\]]*\][^\n]*\}$/m,
  );
});

test("Windows checkouts keep text files in Prettier's LF format", async () => {
  const attributes = await readFile(gitAttributesUrl, "utf8");

  assert.match(attributes, /^\* text=auto eol=lf$/m);
});

test("the pet webview fills the resized native window", async () => {
  const styles = await readFile(stylesUrl, "utf8");
  const rule = styles.match(/\.pet-window\s*\{([^}]*)\}/)?.[1] ?? "";

  assert.match(rule, /width:\s*100%/);
  assert.match(rule, /height:\s*100%/);
  assert.match(rule, /display:\s*grid/);
  assert.match(rule, /place-items:\s*end center/);
  assert.doesNotMatch(rule, /width:\s*192px/);
});

test("pet-library thumbnails clip a fixed frame from the bottom center", async () => {
  const styles = await readFile(stylesUrl, "utf8");
  const rule = styles.match(/\.pet-thumbnail\s*\{([^}]*)\}/)?.[1] ?? "";

  assert.match(rule, /width:\s*92px/);
  assert.match(rule, /height:\s*92px/);
  assert.match(rule, /overflow:\s*hidden/);
  assert.match(rule, /place-items:\s*end center/);
});
