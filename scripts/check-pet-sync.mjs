import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

// The release pipeline packages assets/pets/yanghao, but the app renders
// public/pets/yanghao (Vite's public directory). These two copies must stay
// byte-identical, otherwise the installed app would display different sprites
// than what the catalog distributes. This check fails loudly on any drift.
const pairs = [
  ["assets/pets/yanghao/pet.json", "public/pets/yanghao/pet.json"],
  ["assets/pets/yanghao/spritesheet.webp", "public/pets/yanghao/spritesheet.webp"],
];

let ok = true;
for (const [a, b] of pairs) {
  const [left, right] = await Promise.all([readFile(resolve(a)), readFile(resolve(b))]);
  if (!left.equals(right)) {
    console.error(`MISMATCH: ${a} and ${b} differ`);
    ok = false;
  } else {
    console.log(`OK: ${a} === ${b}`);
  }
}

if (!ok) {
  console.error(
    "\nassets/pets/yanghao and public/pets/yanghao are out of sync.\nUpdate both copies (release source and runtime asset) so they match.",
  );
  process.exit(1);
}
console.log("pet assets are in sync");
