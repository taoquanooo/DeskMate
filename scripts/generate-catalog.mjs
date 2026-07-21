import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const options = parseArgs(process.argv.slice(2));
for (const name of ["owner", "repo", "tag", "package", "preview", "out"]) {
  if (!options[name]) throw new Error(`--${name} is required`);
}

const manifest = JSON.parse(await readFile(resolve("assets/pets/yanghao/pet.json"), "utf8"));
const packagePath = resolve(options.package);
const previewPath = resolve(options.preview);
const packageBytes = await readFile(packagePath);
const sizeBytes = (await stat(packagePath)).size;
const base = `https://github.com/${options.owner}/${options.repo}/releases/download/${encodeURIComponent(options.tag)}`;
const catalog = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  pets: [
    {
      id: manifest.id,
      version: "1.0.0",
      displayName: manifest.displayName,
      description: manifest.description,
      author: "DeskMate Studio",
      assetLicense: "Yanghao Pet Asset License",
      spriteVersionNumber: 2,
      minAppVersion: "0.1.0",
      previewUrl: `${base}/${encodeURIComponent(previewPath.split(/[\\/]/).at(-1))}`,
      packageUrl: `${base}/${encodeURIComponent(packagePath.split(/[\\/]/).at(-1))}`,
      sha256: createHash("sha256").update(packageBytes).digest("hex"),
      sizeBytes,
    },
  ],
};

const output = resolve(options.out);
await mkdir(dirname(output), { recursive: true });
await writeFile(output, `${JSON.stringify(catalog, null, 2)}\n`);
console.log(`Generated ${output}`);

function parseArgs(args) {
  const result = {};
  for (let index = 0; index < args.length; index += 2) {
    result[args[index].replace(/^--/, "")] = args[index + 1];
  }
  return result;
}
