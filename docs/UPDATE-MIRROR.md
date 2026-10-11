# COS 手动更新源

每次更新只需要手动上传两个文件：签名安装包和配套的 `latest.json`。客户端自动检查、下载并校验签名，你不需要部署服务器或向客户端提供 COS 密钥。

## 首次配置一次地址

COS 的 `DeskMate` 目录设置为公有读私有写。在 GitHub 仓库 Settings → Secrets and variables → Actions → Variables 设置 `DESKMATE_UPDATE_MIRROR_BASE_URL`：

```text
https://web-cdn-1253886381.cos.ap-chengdu.myqcloud.com/DeskMate/
```

地址在构建时写入应用，安装包含该地址的新构建后生效。以后更新不需要重复配置。未配置时仍只使用 GitHub。

## 每次更新上传两个文件

签名构建自动提供 `DeskMate-Update-Mirror` 下载产物。正式 Release 和配置了签名密钥的预览构建都会生成它。解压后直接得到这两个文件；签名已写入 JSON，不需要上传 `.sig` 或创建版本子目录：

```text
DeskMate/
  DeskMate_版本号_x64-setup.exe
  latest.json
```

1. 先把安装包上传到 COS 的 `DeskMate` 目录，保留原文件名和内容。
2. 确认安装包公开链接能下载，再上传并覆盖同目录的 `latest.json`。
3. `latest.json` 设置 `Content-Type: application/json`、`Cache-Control: no-cache`。使用 CDN 时同步刷新这个文件的缓存。

每个安装包的文件名包含版本号，因此旧包和新包可以放在同一目录，不会相互覆盖。不要直接上传 GitHub 原有的 `latest.json`，其中的下载地址可能仍指向 GitHub；使用 `DeskMate-Update-Mirror` 中自动生成的 COS 版本即可。

## 软件行为与验证

软件先检查 GitHub，检查失败、超时、数据无效或下载／签名校验失败时自动切换 COS。发现新版后自动下载，安装仍需用户点击确认。COS 尚未同步的新版本不会降级已经发现的更新。

用浏览器无痕窗口打开 `https://web-cdn-1253886381.cos.ap-chengdu.myqcloud.com/DeskMate/latest.json`，检查其中的安装包地址无需登录即可下载。然后阻断 GitHub 访问，在软件中完成一次备用检查、下载和签名验证。

预览构建不发布 Release。没有配置签名密钥时，只生成普通预览安装包，不能用于 COS 自动更新。COS 上传包保持原始安装包和签名，不要自行修改 `latest.json` 中的版本号来让预览包触发更新。签名格式遵循 [Tauri 更新规范](https://v2.tauri.app/zh-cn/plugin/updater/)。
