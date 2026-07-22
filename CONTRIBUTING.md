# Contributing

感谢你帮助改进 DeskMate。

1. 从 `main` 创建短生命周期分支。
2. 修改行为前先添加失败测试；修复后运行 `pnpm verify` 和 `cargo test --manifest-path src-tauri/Cargo.toml`。
3. 不要提交更新私钥、个人数据、构建缓存或未经授权的宠物素材。
4. 宠物包只能包含 `pet.json`、`spritesheet.webp` 和 `ASSET_LICENSE.txt`。
5. Pull Request 请说明 Windows/DPI/多屏测试环境与可见行为变化。

新宠物进入官方目录前必须明确素材作者、许可、最低 DeskMate 版本，并通过 SHA-256 与 Codex v2 图集校验。
