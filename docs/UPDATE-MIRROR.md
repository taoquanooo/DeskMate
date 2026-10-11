# 对象存储备用更新渠道

客户端先检查 GitHub，检查失败、超时、数据无效或安装包下载／签名校验失败时，再尝试备用渠道。检查最长 10 秒；下载只限制连接和连续无数据时间，健康的慢速下载可以继续。已发现新版后，镜像版本必须相同或更高。

## 配置公开地址

在 GitHub 仓库 Settings → Secrets and variables → Actions → Variables 添加 `DESKMATE_UPDATE_MIRROR_BASE_URL`，值为公开 HTTPS 根地址，例如 `https://download.example.com/deskmate`。客户端访问该地址下的 `latest.json`。地址在构建时写入应用；已安装的 0.2.0 不会自动获得此备用源，需要安装包含该配置的新版本。未配置时仍使用 GitHub。

客户端只公开读取文件，不存储对象存储上传密钥。不需要提供私钥给存储服务。两个渠道使用现有的 Tauri 更新签名密钥和安装流程。

## 生成镜像文件

正式 Release 构建在配置镜像地址后，额外提供 `DeskMate-Update-Mirror` artifact。它包含版本目录中的原始安装包、原始 `.sig` 和根目录 `latest.json`。预览构建不生成签名更新包，也不上传 Release。

也可以从正式 Release 下载同一安装包及 `.sig`，放到一个独立目录，执行：

```powershell
node scripts/build-update-mirror.mjs .\signed-installer .\mirror https://download.example.com/deskmate 0.3.0
```

版本号必须与安装包文件名一致，不加 `v`。不得重新压缩、修改或用预览安装包替代已签名的安装包。格式遵循 [Tauri 静态 JSON 与签名规范](https://v2.tauri.app/zh-cn/plugin/updater/)。

## 上传顺序与核验

1. 先把版本目录上传到对象存储，例如 `deskmate/0.3.0/`，保留安装包和 `.sig` 的原始字节。旧版本目录继续保留。
2. 从外网公开链接下载上传的安装包，与本地原件比较 SHA-256；检查状态码、文件大小和内容一致。安装包可长期缓存。
3. 确认版本文件可读后，最后上传根目录的 `latest.json`，使用 `application/json`，设置 `Cache-Control: no-cache`，并刷新 CDN 中旧的检查文件。
4. 用包含镜像地址的应用阻断 GitHub 访问，检查界面出现备用渠道，完成下载和签名验证后才能安装。
5. 同时测试镜像未同步、两个渠道断网和签名错误。较旧镜像不得覆盖已从 GitHub 发现的新版本；失败后“检查更新”可重试。

首次真实联调需要提供公开地址并手动上传这些文件。目前只完成客户端、生成工具与自动构建配置，没有已上线的对象存储渠道。
