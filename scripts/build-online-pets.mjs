import { createHash } from "node:crypto";
import { copyFile, cp, mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const allowedFiles = ["ASSET_LICENSE.txt", "pet.json", "spritesheet.webp"];
const defaultMetadata = {
  version: "1.0.0",
  author: "DeskMate contributors",
  assetLicense: "All rights reserved by the respective asset owner",
  minAppVersion: "0.1.1",
};
const isGnuTar = spawnSync("tar", ["--version"], { encoding: "utf8" }).stdout.includes("GNU tar");

export function readArguments(args = process.argv.slice(2)) {
  const options = {};

  for (let index = 0; index < args.length; index += 2) {
    const name = args[index];
    const value = args[index + 1];
    if (!/^--(?:source|output|repository|release-tag)$/.test(name) || !value || value.startsWith("--")) {
      throw new Error("usage: --source <dir> --output <dir> --repository <owner/repo> --release-tag <tag>");
    }
    const key = name.slice(2).replace("release-tag", "releaseTag");
    if (options[key]) throw new Error(`duplicate argument ${name}`);
    options[key] = value;
  }

  for (const key of ["source", "output", "repository", "releaseTag"]) {
    if (!options[key]) throw new Error(`--${key === "releaseTag" ? "release-tag" : key} is required`);
  }
  if (!/^[^/]+\/[^/]+$/.test(options.repository)) throw new Error("--repository must use owner/repository");

  return options;
}

export async function buildOnlinePets({ source, output, repository, releaseTag }) {
  const sourceDirectory = resolve(source);
  const outputDirectory = resolve(output);
  const pets = await readPets(sourceDirectory);
  const stagingDirectory = await createStagingDirectory(outputDirectory);

  try {
    const packagesDirectory = join(outputDirectory, "packages");
    const pagesDirectory = join(outputDirectory, "pages");
    await Promise.all([
      mkdir(packagesDirectory, { recursive: true }),
      mkdir(join(pagesDirectory, "catalog", "v1"), { recursive: true }),
    ]);
    await Promise.all([
      copyFile(resolve("catalog/index.html"), join(pagesDirectory, "index.html")),
      copyFile(resolve("catalog/pet-placeholder.svg"), join(pagesDirectory, "pet-placeholder.svg")),
    ]);

    const catalogPets = [];
    for (const pet of pets) {
      const packageName = `${pet.id}-${pet.version}.zip`;
      const packagePath = join(packagesDirectory, packageName);
      await packagePet(pet, packagePath, stagingDirectory);
      const packageBytes = await readFile(packagePath);
      catalogPets.push({
        id: pet.id,
        version: pet.version,
        displayName: pet.displayName,
        description: pet.description,
        author: pet.author,
        assetLicense: pet.assetLicense,
        spriteVersionNumber: pet.spriteVersionNumber,
        minAppVersion: pet.minAppVersion,
        previewUrl: `https://${repository.split("/")[0]}.github.io/${repository.split("/")[1]}/pet-placeholder.svg`,
        packageUrl: `https://github.com/${repository}/releases/download/${releaseTag}/${packageName}`,
        sha256: createHash("sha256").update(packageBytes).digest("hex"),
        sizeBytes: packageBytes.length,
      });
    }

    await writeFile(
      join(pagesDirectory, "catalog", "v1", "catalog.json"),
      `${JSON.stringify({ schemaVersion: 1, generatedAt: new Date().toISOString(), pets: catalogPets }, null, 2)}\n`,
    );
    return { pets: catalogPets.length, output: outputDirectory };
  } finally {
    await rm(stagingDirectory, { force: true, recursive: true });
  }
}

async function readPets(sourceDirectory) {
  const directories = (await readdir(sourceDirectory, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  const seenVersions = new Set();
  const pets = [];

  for (const directoryName of directories) {
    const directory = join(sourceDirectory, directoryName);
    const files = (await readdir(directory)).sort();
    if (
      !files.every((file) => allowedFiles.includes(file)) ||
      !files.includes("pet.json") ||
      !files.includes("spritesheet.webp")
    ) {
      throw new Error(`${directoryName}: allowed files are ${allowedFiles.join(", ")}`);
    }

    const manifest = JSON.parse(await readFile(join(directory, "pet.json"), "utf8"));
    validateManifest(directoryName, manifest);
    const sprite = await readFile(join(directory, "spritesheet.webp"));
    if (sprite.length === 0 || sprite.length > 25 * 1024 * 1024)
      throw new Error(`${directoryName}: spritesheet size is invalid`);
    const dimensions = readWebpDimensions(sprite);
    const detectedSpriteVersion =
      dimensions.width === 1536 && dimensions.height === 1872
        ? 1
        : dimensions.width === 1536 && dimensions.height === 2288
          ? 2
          : 0;
    if (detectedSpriteVersion === 0) {
      throw new Error(`${directoryName}: spritesheet must be a Codex v1 (1536×1872) or v2 (1536×2288) atlas`);
    }
    if (
      manifest.spriteVersionNumber !== undefined &&
      manifest.spriteVersionNumber !== detectedSpriteVersion
    ) {
      throw new Error(`${directoryName}: declared spriteVersionNumber does not match the atlas`);
    }

    const pet = {
      directory,
      files,
      id: manifest.id,
      displayName: manifest.displayName,
      description: manifest.description,
      spriteVersionNumber: detectedSpriteVersion,
      version: manifest.version ?? defaultMetadata.version,
      author: manifest.author ?? defaultMetadata.author,
      assetLicense: manifest.assetLicense ?? defaultMetadata.assetLicense,
      minAppVersion: manifest.minAppVersion ?? defaultMetadata.minAppVersion,
    };
    for (const key of ["version", "author", "assetLicense", "minAppVersion"]) {
      if (typeof pet[key] !== "string" || !pet[key].trim())
        throw new Error(`${directoryName}: ${key} must be a non-empty string`);
    }
    const versionKey = `${pet.id}@${pet.version}`;
    if (seenVersions.has(versionKey)) throw new Error(`duplicate pet version ${versionKey}`);
    seenVersions.add(versionKey);
    pets.push(pet);
  }

  return pets;
}

function validateManifest(directoryName, manifest) {
  if (!manifest || typeof manifest !== "object")
    throw new Error(`${directoryName}: pet.json must be an object`);
  if (manifest.id !== directoryName) throw new Error(`${directoryName}: manifest id must match directory`);
  if (!/^[a-z0-9][a-z0-9-]*$/.test(manifest.id)) throw new Error(`${directoryName}: invalid id`);
  for (const field of ["displayName", "description"]) {
    if (typeof manifest[field] !== "string" || !manifest[field].trim())
      throw new Error(`${directoryName}: ${field} is required`);
  }
  if (manifest.spritesheetPath !== "spritesheet.webp")
    throw new Error(`${directoryName}: spritesheetPath must be spritesheet.webp`);
  if (
    manifest.spriteVersionNumber !== undefined &&
    manifest.spriteVersionNumber !== 1 &&
    manifest.spriteVersionNumber !== 2
  ) {
    throw new Error(`${directoryName}: spriteVersionNumber must be 1 or 2`);
  }
}

async function createStagingDirectory(outputDirectory) {
  await mkdir(outputDirectory, { recursive: true });
  return mkdtemp(join(outputDirectory, ".staging-"));
}

async function packagePet(pet, packagePath, stagingDirectory) {
  const petStagingDirectory = join(stagingDirectory, pet.id);
  await mkdir(petStagingDirectory);
  await Promise.all(pet.files.map((file) => cp(join(pet.directory, file), join(petStagingDirectory, file))));
  const tarArgs = [];
  if (isGnuTar) tarArgs.push("--force-local");
  tarArgs.push("-a", "-c", "-f", packagePath, "-C", petStagingDirectory, ...pet.files);
  const result = spawnSync("tar", tarArgs, { encoding: "utf8" });
  if (result.status !== 0)
    throw new Error(`failed to package ${pet.id}: ${result.stderr || result.error?.message || "tar failed"}`);
}

function readWebpDimensions(buffer) {
  if (
    buffer.subarray(0, 4).toString("ascii") !== "RIFF" ||
    buffer.subarray(8, 12).toString("ascii") !== "WEBP"
  ) {
    throw new Error("invalid WebP header");
  }
  for (let offset = 12; offset + 8 <= buffer.length;) {
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

if (resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  try {
    const result = await buildOnlinePets(readArguments());
    console.log(JSON.stringify({ ok: true, ...result }));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
