# DeskMate 在线宠物目录设计

## 目标

新增官方宠物时不修改 Windows 安装包，也不重新编译 DeskMate。安装包只保留杨皓作为离线兜底；其余宠物由现有在线目录发现，用户点击安装后才下载到本机应用数据目录。

## 方案比较

### 方案 A：GitHub Release 宠物包 + GitHub Pages 目录（采用）

把宠物源文件放在不会被 Vite 复制进安装包的 `online-pets/<id>/`。轻量 GitHub Action 只做校验、ZIP 打包、Release 资产上传和 Pages 目录部署，不安装 Rust，也不构建 Windows 程序。

优点：兼容已经发布的 v0.1.0；无需发布新版应用；继续使用现有 HTTPS、SHA-256、大小和 ZIP 安全校验。缺点：GitHub 上会有一个独立的宠物资源 Release。

### 方案 B：直接从 GitHub Pages 下载宠物

结构更直观，但 v0.1.0 当前只接受 GitHub Release 下载地址，需要先修改程序并发布 v0.1.1，因此不采用。

### 方案 C：把宠物放进 `public/pets`

实现最少，但所有宠物会进入安装包，增加体积且每次新增宠物都要重新构建，因此不采用。

## 仓库结构

```text
online-pets/
  <pet-id>/
    pet.json
    spritesheet.webp

catalog/
  index.html

.github/workflows/
  publish-pets.yml
```

每只宠物仍只要求用户维护 `pet.json` 和 `spritesheet.webp`。目录生成器采用以下默认目录元数据：

- `version`: `1.0.0`
- `author`: `DeskMate contributors`
- `assetLicense`: `All rights reserved by the respective asset owner`
- `minAppVersion`: `0.1.0`

以后需要升级某只宠物时，可在 `pet.json` 增加或修改 `version`；运行时会把它识别为新版本。

## 发布数据流

1. 合并对 `online-pets/**`、目录脚本或宠物工作流的修改到 `main`。
2. `publish-pets.yml` 逐个校验目录、清单、WebP 文件和 v2 图集尺寸。
3. Action 为每只宠物生成 `<id>-<version>.zip`，计算 SHA-256 和文件大小。
4. ZIP 上传到独立的 GitHub Release 标签 `pets-v1`。
5. Action 生成完整 `catalog/v1/catalog.json`，其 `packageUrl` 指向 GitHub Release 资产。
6. Pages 部署目录页面和 JSON；不会调用 Tauri、Cargo 或 Windows 构建。
7. 已安装的 DeskMate 启动约 20 秒后检查目录，此后每 6 小时检查；用户也可在宠物库手动刷新。

## 兼容与预览

- 在线官方包继续遵守 v2 严格校验；缺少 `spriteVersionNumber` 的已确认 v2 宠物在迁移时补为 `2`。
- 首版在线目录使用统一的轻量占位预览图，避免要求用户额外制作预览文件；宠物安装和运行不受影响。
- 后续可选支持每个目录增加 `preview.png`，但不作为本次必需范围。

## 错误处理

- 任一宠物缺少文件、JSON 无效、id 与目录不符、WebP 无效或版本重复时，工作流失败且不部署新目录。
- 上传或 Pages 部署失败时，线上仍保留上一份可用目录。
- 应用下载校验失败时保留上一可用宠物版本。

## 测试与验收

- 测试证明 `online-pets` 不在 `public` 中，生产前端构建不会携带新增宠物。
- 目录生成测试覆盖默认元数据、显式版本、SHA-256、大小、HTTPS Release URL 和重复 id/version。
- 工作流测试证明宠物发布任务不包含 Rust、Cargo、Tauri 或 Windows 安装包构建。
- 完整 `pnpm verify` 通过。
- 合并后在线 `catalog.json` 能列出 7 只新增宠物，v0.1.0 可刷新、下载、安装和切换其中一只。

## 不在本次范围

- 不发布新的 DeskMate 安装包。
- 不修改应用在线目录协议。
- 不增加第三方宠物源或账号系统。
- 不自动授予宠物素材新的开源许可。
