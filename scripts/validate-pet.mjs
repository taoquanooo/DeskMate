import { readFile, readdir, stat } from "node:fs/promises";
import { resolve } from "node:path";

const directory = resolve(process.argv[2] ?? "assets/pets/yanghao");
const allowed = ["ASSET_LICENSE.txt", "pet.json", "spritesheet.webp"];
const names = (await readdir(directory)).sort();
assert(
  JSON.stringify(names) === JSON.stringify(allowed),
  `pet folder must contain only: ${allowed.join(", ")}`,
);

const manifest = JSON.parse(await readFile(resolve(directory, "pet.json"), "utf8"));
assert(typeof manifest.id === "string" && /^[a-z0-9][a-z0-9-]*$/.test(manifest.id), "invalid pet id");
assert(typeof manifest.displayName === "string" && manifest.displayName.trim(), "displayName is required");
assert(typeof manifest.description === "string" && manifest.description.trim(), "description is required");
assert(manifest.spriteVersionNumber === 2, "spriteVersionNumber must be 2");
assert(manifest.spritesheetPath === "spritesheet.webp", "spritesheetPath must be spritesheet.webp");

const spritesheetPath = resolve(directory, "spritesheet.webp");
const metadata = await stat(spritesheetPath);
assert(metadata.size > 0 && metadata.size <= 25 * 1024 * 1024, "spritesheet size is invalid");
const dimensions = readWebpDimensions(await readFile(spritesheetPath));
assert(
  dimensions.width === 1536 && dimensions.height === 2288,
  `expected 1536x2288, got ${dimensions.width}x${dimensions.height}`,
);
assert(
  (await readFile(resolve(directory, "ASSET_LICENSE.txt"), "utf8")).trim(),
  "ASSET_LICENSE.txt is empty",
);

console.log(
  JSON.stringify({
    ok: true,
    id: manifest.id,
    spriteVersionNumber: 2,
    ...dimensions,
    sizeBytes: metadata.size,
  }),
);

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
    if (type === "VP8X" && size >= 10) {
      return { width: buffer.readUIntLE(data + 4, 3) + 1, height: buffer.readUIntLE(data + 7, 3) + 1 };
    }
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
