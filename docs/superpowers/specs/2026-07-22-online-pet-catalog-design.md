# DeskMate 在线宠物目录设计

## 目标

先发布一次 `v0.1.1` 兼容更新，使在线官方导入与本地导入一样自动识别 Codex v1/v2，并允许宠物包只包含 `pet.json` 和 `spritesheet.webp`。安装包内置“默认伙伴”和 Lev-neon 两只离线可用宠物；其余宠物由在线目录发现，用户点击安装后才下载到本机应用数据目录。此后新增在线官方宠物时不修改 Windows 安装包，也不重新编译 DeskMate。

## 方案比较

### 方案 A：GitHub Release 宠物包 + GitHub Pages 目录（采用）

把宠物源文件放在不会被 Vite 复制进安装包的 `online-pets/<id>/`。轻量 GitHub Action 只做校验、ZIP 打包、Release 资产上传和 Pages 目录部署，不安装 Rust，也不构建 Windows 程序。

优点：保留现有 HTTPS、SHA-256、大小和 ZIP 安全校验；完成一次 v0.1.1 后，后续宠物更新无需发布新版应用。缺点：首次需要发布一个兼容更新，GitHub 上会有一个独立的宠物资源 Release。

### 方案 B：直接从 GitHub Pages 下载宠物

结构更直观，但 v0.1.0 当前只接受 GitHub Release 下载地址，需要先修改程序并发布 v0.1.1，因此不采用。

### 方案 C：把宠物放进 `public/pets`

实现最少，但所有宠物会进入安装包，增加体积且每次新增宠物都要重新构建，因此不采用。

## 仓库结构

```text
public/
  pets/
    yanghao/
    lev-neon/

online-pets/
  <pet-id>/
    pet.json
    spritesheet.webp

catalog/
  index.html

.github/workflows/
  publish-pets.yml
```

每只宠物只要求用户维护 `pet.json` 和 `spritesheet.webp`，可选携带 `ASSET_LICENSE.txt`。目录生成器从 WebP 尺寸自动识别 `spriteVersionNumber`，并采用以下默认目录元数据：

- `version`: `1.0.0`
- `author`: `DeskMate contributors`
- `assetLicense`: `All rights reserved by the respective asset owner`
- `minAppVersion`: `0.1.0`

以后需要升级某只宠物时，可在 `pet.json` 增加或修改 `version`；运行时会把它识别为新版本。

## 发布数据流

1. 一次性发布 v0.1.1：在线包清单允许省略 `spriteVersionNumber`，安装器根据 `1536x1872` 或 `1536x2288` 自动识别 v1/v2；`ASSET_LICENSE.txt` 改为可选。
2. 合并对 `online-pets/**`、目录脚本或宠物工作流的修改到 `main`。
3. `publish-pets.yml` 逐个校验目录、清单、WebP 文件和 v1/v2 图集尺寸。
4. Action 为每只宠物生成 `<id>-<version>.zip`，计算 SHA-256 和文件大小。
5. ZIP 上传到独立的 GitHub Release 标签 `pets-v1`。
6. Action 生成完整 `catalog/v1/catalog.json`，其 `packageUrl` 指向 GitHub Release 资产。
7. Pages 部署目录页面和 JSON；宠物专用流程不会调用 Tauri、Cargo 或 Windows 构建。
8. 已安装的 DeskMate 启动约 20 秒后检查目录，此后每 6 小时检查；用户也可在宠物库手动刷新。

## 兼容与预览

- “默认伙伴”和 Lev-neon 是安装包内置宠物，断网时也能在宠物库中切换；Lev-neon 不进入 `pets-v1` 在线 ZIP。为兼容已有设置，“默认伙伴”的内部 id 仍为 `yanghao`，但界面和清单不再展示旧个人名称。
- 宠物库推荐区并列提供 Codex Pet Gallery 与 [PetDex](https://petdex.dev/)；两者只作为浏览/下载入口，不接入官方自动更新源。
- 在线官方包支持 `1536x1872` 的 v1 和 `1536x2288` 的 v2；声明版本时必须与实际尺寸一致，省略时由程序自动识别。
- ZIP 根目录必须有 `pet.json` 和 `spritesheet.webp`，可选有 `ASSET_LICENSE.txt`，禁止其他文件和路径。
- 首版在线目录使用统一的轻量占位预览图，避免要求用户额外制作预览文件；宠物安装和运行不受影响。
- 后续可选支持每个目录增加 `preview.png`，但不作为本次必需范围。

## 错误处理

- 任一宠物缺少必需文件、JSON 无效、id 与目录不符、WebP 不是有效 v1/v2 图集或版本重复时，工作流失败且不部署新目录。
- 上传或 Pages 部署失败时，线上仍保留上一份可用目录。
- 应用下载校验失败时保留上一可用宠物版本。

## 测试与验收

- 测试证明 `online-pets` 不在 `public` 中，生产前端构建不会携带新增宠物。
- Rust 测试覆盖在线 ZIP 的 v1/v2 自动识别、声明版本不匹配、可选素材许可和非法额外文件。
- TypeScript 测试覆盖目录中 `spriteVersionNumber` 为 1 或 2，并继续拒绝其他值。
- 目录生成测试覆盖 v1/v2 自动识别、默认元数据、显式版本、SHA-256、大小、HTTPS Release URL 和重复 id/version。
- 工作流测试证明宠物发布任务不包含 Rust、Cargo、Tauri 或 Windows 安装包构建。
- 完整 `pnpm verify` 通过。
- v0.1.1 可从在线 `catalog.json` 刷新、下载、安装并切换一只 v1 和一只 v2 宠物。
- v0.1.1 离线时也能选择并运行 Yanghao 与 Lev-neon，且 Lev-neon 的实际图集用于缩略图和桌宠窗口。
- v0.1.1 发布后，单独增加宠物只触发 `publish-pets.yml`，不触发应用构建或安装包发布。

## 不在本次范围

- 除一次性的 v0.1.1 兼容更新外，不因宠物目录变化发布新的 DeskMate 安装包。
- 不改变 `PetCatalogV1` 的字段集合，只把 `spriteVersionNumber` 的允许值从固定 `2` 放宽为 `1 | 2`。
- 不增加第三方宠物源或账号系统。
- 不自动授予宠物素材新的开源许可。
