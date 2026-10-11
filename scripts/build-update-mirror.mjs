import { copyFile, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

export function mirrorBase(value) {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) {
    throw new Error("镜像根地址必须是公开 HTTPS 地址，不能包含登录信息、查询或片段");
  }
  url.pathname = `${url.pathname.replace(/\/$/, "")}/`;
  return url;
}

export async function buildMirror({
  input,
  output,
  base,
  version,
  notes = "",
  pubDate = new Date().toISOString(),
}) {
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(version)) {
    throw new Error("请输入不含 v 前缀的完整版本号");
  }
  const url = mirrorBase(base);
  const names = (await readdir(input)).filter((name) => name.endsWith(".exe"));
  if (names.length !== 1) throw new Error("输入目录必须恰好包含一个 Windows 安装包");
  const name = names[0];
  if (!name.includes(`_${version}_`)) throw new Error("安装包文件名与版本号不一致");
  const signature = (await readFile(path.join(input, `${name}.sig`), "utf8")).trim();
  // Preserve Tauri's base64 signature, including its trusted comment and key ID.
  if (
    !/^[A-Za-z0-9+/]+={0,2}$/.test(signature) ||
    !Buffer.from(signature, "base64").toString("utf8").startsWith("untrusted comment:")
  ) {
    throw new Error("安装包签名无效，请使用正式构建生成的 .sig 文件");
  }
  if (!Number.isFinite(Date.parse(pubDate))) throw new Error("发布日期无效");
  const target = path.join(output, version);
  if (path.resolve(input) === path.resolve(target)) throw new Error("输出目录不能覆盖输入安装包");
  await mkdir(target, { recursive: true });
  await copyFile(path.join(input, name), path.join(target, name));
  await copyFile(path.join(input, `${name}.sig`), path.join(target, `${name}.sig`));
  const manifest = {
    version,
    notes,
    pub_date: pubDate,
    platforms: {
      "windows-x86_64": { signature, url: new URL(`${version}/${encodeURIComponent(name)}`, url).href },
    },
  };
  await writeFile(path.join(output, "latest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const [input, output, base, version] = process.argv.slice(2);
  if (!input || !output || !base || !version) {
    console.error(
      "用法：node scripts/build-update-mirror.mjs <已签名安装包目录> <输出目录> <HTTPS根地址> <版本号>",
    );
    process.exitCode = 1;
  } else {
    try {
      await buildMirror({ input, output, base, version });
      console.log(`镜像文件已生成：${path.resolve(output)}`);
    } catch (error) {
      console.error(error.message);
      process.exitCode = 1;
    }
  }
}
