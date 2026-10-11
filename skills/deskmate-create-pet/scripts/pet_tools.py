"""Validate, assemble and package DeskMate pets. Requires Python 3.10+ and Pillow."""
import argparse
import json
from pathlib import Path
import re
import zipfile
from PIL import Image

ROWS = [
    ("idle", 6), ("running-right", 8), ("running-left", 8), ("waving", 4),
    ("jumping", 5), ("failed", 8), ("waiting", 6), ("running", 6),
    ("review", 6), ("look-a", 8), ("look-b", 8),
]
LIMIT = 25 * 1024 * 1024
ALLOWED = {"pet.json", "spritesheet.webp", "ASSET_LICENSE.txt"}


def require(condition, message):
    if not condition:
        raise ValueError(message)


def validate(directory):
    directory = Path(directory)
    files = list(directory.iterdir())
    require(all(p.is_file() and not p.is_symlink() and p.name in ALLOWED for p in files), "宠物目录只能包含清单、图集及可选授权文件")
    require({"pet.json", "spritesheet.webp"} <= {p.name for p in files}, "缺少 pet.json 或 spritesheet.webp")
    require(sum(p.stat().st_size for p in files) <= LIMIT, "解压内容超过 25 MiB")
    require((directory / "pet.json").stat().st_size <= 64 * 1024, "清单过大")
    manifest = json.loads((directory / "pet.json").read_text(encoding="utf-8"))
    require(isinstance(manifest, dict), "清单必须是 JSON 对象")
    pet_id = manifest.get("id", "")
    require(isinstance(pet_id, str) and re.fullmatch(r"[a-z0-9][a-z0-9-]*", pet_id), "ID 无效")
    require(pet_id != "yanghao", "yanghao 是内置宠物保留 ID，请使用自己的 ID")
    require(all(isinstance(manifest.get(key), str) and manifest[key].strip() for key in ["displayName", "description"]), "名称和描述不能为空")
    require(manifest.get("spritesheetPath") == "spritesheet.webp", "图集路径必须是 spritesheet.webp")
    with Image.open(directory / "spritesheet.webp") as image:
        require(image.format == "WEBP" and image.mode == "RGBA", "图集必须是透明 WebP")
        version = { (1536, 1872): 1, (1536, 2288): 2 }.get(image.size)
        require(version is not None, "图集尺寸不兼容")
        require(manifest.get("spriteVersionNumber", version) == version, "清单版本与图集尺寸不一致")
        alpha = image.getchannel("A")
        require(alpha.getextrema()[0] < 255, "图集没有透明背景")
        for row, (name, count) in enumerate(ROWS[:9 if version == 1 else 11]):
            for column in range(count):
                cell = alpha.crop((column * 192, row * 208, (column + 1) * 192, (row + 1) * 208))
                require(cell.getbbox() is not None, f"缺少 {name} 第 {column + 1} 帧")
    if (directory / "ASSET_LICENSE.txt").exists():
        require((directory / "ASSET_LICENSE.txt").read_text(encoding="utf-8").strip(), "授权文件不能为空")
    return manifest


def assemble(args):
    destination = Path(args.output)
    require(re.fullmatch(r"[a-z0-9][a-z0-9-]*", args.id), "ID 无效")
    require(args.name.strip() and args.description.strip(), "名称和描述不能为空")
    require(not destination.exists(), "输出文件夹已存在，请使用新文件夹")
    atlas = Image.new("RGBA", (1536, 2288))
    for row, (name, count) in enumerate(ROWS):
        frames = []
        for index in range(1, count + 1):
            with Image.open(Path(args.frames) / name / f"{index:02}.png") as image:
                require(image.mode == "RGBA" and image.getchannel("A").getextrema()[0] < 255, f"{name}/{index:02}.png 需要透明背景")
                frames.append(image.copy())
        # Scale entire frame canvases together; preserve internal movement/baselines.
        require(len({image.size for image in frames}) == 1, f"{name} 帧画布尺寸需要一致")
        width, height = frames[0].size
        ratio = min(180 / width, 196 / height)
        for column, image in enumerate(frames):
            size = (max(1, round(width * ratio)), max(1, round(height * ratio)))
            image = image.resize(size, Image.Resampling.LANCZOS)
            atlas.alpha_composite(image, (column * 192 + (192 - size[0]) // 2, row * 208 + 202 - size[1]))
    destination.mkdir(parents=True)
    atlas.save(destination / "spritesheet.webp", format="WEBP", lossless=True)
    manifest = {"id": args.id, "displayName": args.name, "description": args.description, "spriteVersionNumber": 2, "spritesheetPath": "spritesheet.webp"}
    (destination / "pet.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return validate(destination)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    check = sub.add_parser("validate")
    check.add_argument("directory")
    pack = sub.add_parser("pack")
    pack.add_argument("directory")
    pack.add_argument("output")
    assembly = sub.add_parser("assemble")
    assembly.add_argument("frames")
    assembly.add_argument("output")
    for field in ["id", "name", "description"]:
        assembly.add_argument(f"--{field}", required=True)
    args = parser.parse_args()
    if args.command == "assemble":
        result = assemble(args)
    else:
        result = validate(args.directory)
        if args.command == "pack":
            output = Path(args.output)
            require(output.resolve().parent != Path(args.directory).resolve(), "ZIP 放在宠物目录之外")
            require(not output.exists(), "输出 ZIP 已存在，请使用新文件名")
            with zipfile.ZipFile(output, "x", zipfile.ZIP_DEFLATED) as package:
                for path in sorted(Path(args.directory).iterdir()):
                    package.write(path, path.name)
            require(output.stat().st_size <= LIMIT, "ZIP 超过 25 MiB")
    print(json.dumps({"ok": True, **result}, ensure_ascii=False))


if __name__ == "__main__":
    try:
        main()
    except (ValueError, OSError, json.JSONDecodeError) as error:
        raise SystemExit(f"校验失败：{error}")
