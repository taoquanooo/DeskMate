import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildMirror, mirrorBase } from "./build-update-mirror.mjs";

test("mirror generation preserves the signed installer and signature at a versioned HTTPS URL", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "deskmate-mirror-"));
  try {
    const input = path.join(root, "input"),
      output = path.join(root, "output");
    await mkdir(input);
    const name = "DeskMate_0.3.0_x64-setup.exe";
    const signature = Buffer.from("untrusted comment: signature fixture\nsignature\n").toString("base64");
    await writeFile(path.join(input, name), "installer fixture");
    await writeFile(path.join(input, `${name}.sig`), `${signature}\n`);
    const manifest = await buildMirror({
      input,
      output,
      base: "https://example.com/deskmate",
      version: "0.3.0",
    });
    assert.equal(manifest.platforms["windows-x86_64"].url, `https://example.com/deskmate/0.3.0/${name}`);
    assert.equal(manifest.platforms["windows-x86_64"].signature, signature);
    assert.equal(await readFile(path.join(output, "0.3.0", name), "utf8"), "installer fixture");
    assert.deepEqual(JSON.parse(await readFile(path.join(output, "latest.json"))), manifest);
    await assert.rejects(
      buildMirror({ input, output, base: "https://example.com", version: "0.4.0" }),
      /版本号不一致/,
    );
    await writeFile(path.join(input, `${name}.sig`), "bad signature");
    await assert.rejects(
      buildMirror({ input, output, base: "https://example.com", version: "0.3.0" }),
      /签名无效/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("mirror configuration rejects insecure or credential-bearing URLs", () => {
  for (const base of [
    "http://example.com",
    "https://user:pass@example.com",
    "https://example.com?token=secret",
    "https://example.com/#hash",
    "",
  ]) {
    assert.throws(() => mirrorBase(base));
  }
});
