import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const repositoryRoot = new URL("..", import.meta.url);
const expectedIds = [
  "agumon-baby-flame",
  "blue-guga",
  "caocao-bear",
  "hwjin-black",
  "hwjin-white",
  "ikkun",
  "lansha",
];
const v1Ids = new Set(["blue-guga", "ikkun"]);

test("builds the official online-pet catalog and release packages", async () => {
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
      { cwd: repositoryRoot, encoding: "utf8" },
    );

    assert.equal(result.status, 0, result.stderr || result.stdout);

    const catalog = JSON.parse(
      await readFile(join(output, "pages", "catalog", "v1", "catalog.json"), "utf8"),
    );
    assert.equal(catalog.schemaVersion, 1);
    assert.equal(catalog.pets.length, expectedIds.length);
    assert.deepEqual(
      catalog.pets.map((pet) => pet.id),
      expectedIds,
    );

    for (const pet of catalog.pets) {
      const expectedVersion = v1Ids.has(pet.id) ? 1 : 2;
      assert.equal(
        pet.spriteVersionNumber,
        expectedVersion,
        `${pet.id} should detect as v${expectedVersion}`,
      );
    }

    const packages = await readdir(join(output, "packages"));
    assert.equal(packages.length, expectedIds.length);

    for (const pet of catalog.pets) {
      const packagePath = join(output, "packages", `${pet.id}-${pet.version}.zip`);
      const packageBytes = await readFile(packagePath);

      assert.match(
        pet.packageUrl,
        new RegExp(
          `^https://github\\.com/taoquanooo/DeskMate/releases/download/pets-v1/${pet.id}-${pet.version}\\.zip$`,
        ),
      );
      assert.match(pet.sha256, /^[a-f0-9]{64}$/);
      assert.equal(pet.sha256, createHash("sha256").update(packageBytes).digest("hex"));
      assert.equal(pet.sizeBytes, packageBytes.length);
      assert.ok(pet.sizeBytes > 0);
      assert.equal(
        pet.previewUrl,
        "https://taoquanooo.github.io/DeskMate/pet-placeholder.svg",
      );
    }

    for (const id of expectedIds) {
      await assert.rejects(stat(new URL(`../public/pets/${id}`, import.meta.url)));
    }
  } finally {
    await rm(output, { force: true, recursive: true });
  }
});

test("rejects a declared sprite version that does not match the atlas", async () => {
  const tempSource = await mkdtemp(join(tmpdir(), "deskmate-mismatch-"));
  try {
    const petDir = join(tempSource, "mismatch-pet");
    await mkdir(petDir, { recursive: true });
    await copyFile(
      new URL("../online-pets/blue-guga/spritesheet.webp", import.meta.url),
      join(petDir, "spritesheet.webp"),
    );
    await writeFile(join(petDir, "pet.json"), JSON.stringify({
      id: "mismatch-pet",
      displayName: "Mismatch",
      description: "v1 atlas with v2 declared",
      spriteVersionNumber: 2,
      spritesheetPath: "spritesheet.webp",
    }));
    const tempOutput = join(tempSource, "output");
    const result = spawnSync(process.execPath, [
      "scripts/build-online-pets.mjs",
      "--source", tempSource,
      "--output", tempOutput,
      "--repository", "taoquanooo/DeskMate",
      "--release-tag", "pets-v1",
    ], { cwd: repositoryRoot, encoding: "utf8" });

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /declared spriteVersionNumber does not match the atlas/);
  } finally {
    await rm(tempSource, { force: true, recursive: true });
  }
});

test("rejects an explicit null sprite version", async () => {
  const tempSource = await mkdtemp(join(tmpdir(), "deskmate-null-ver-"));
  try {
    const petDir = join(tempSource, "null-version-pet");
    await mkdir(petDir, { recursive: true });
    await copyFile(
      new URL("../online-pets/blue-guga/spritesheet.webp", import.meta.url),
      join(petDir, "spritesheet.webp"),
    );
    await writeFile(join(petDir, "pet.json"), JSON.stringify({
      id: "null-version-pet",
      displayName: "Null",
      description: "explicit null sprite version",
      spriteVersionNumber: null,
      spritesheetPath: "spritesheet.webp",
    }));
    const tempOutput = join(tempSource, "output");
    const result = spawnSync(process.execPath, [
      "scripts/build-online-pets.mjs",
      "--source", tempSource,
      "--output", tempOutput,
      "--repository", "taoquanooo/DeskMate",
      "--release-tag", "pets-v1",
    ], { cwd: repositoryRoot, encoding: "utf8" });

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /spriteVersionNumber must be 1 or 2/);
  } finally {
    await rm(tempSource, { force: true, recursive: true });
  }
});
