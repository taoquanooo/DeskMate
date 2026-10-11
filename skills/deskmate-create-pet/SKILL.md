---
name: deskmate-create-pet
description: 为 DeskMate 桌宠从角色描述或参考图片制作透明动画图集、pet.json 和可安装 ZIP，或校验修复现有宠物包。
---

# 制作 DeskMate 宠物

使用用户的角色描述或参考图片制作一个可由 DeskMate 导入的宠物包。保留角色轮廓、颜色和服装的一致性；先确认角色设计，再完成动作。使用当前 AI 工具可用的图像生成能力，不要求用户在 DeskMate 配置 API。

生成前阅读 [图集规范](references/atlas.md)。默认输出 Codex v2 图集，v1 仅用于兼容旧素材。DeskMate 的宠物是图片和清单，不需要编写运行时代码。

1. 从用户输入确定英文小写 ID、显示名称和描述。ID 用小写字母、数字、短横线，首字符必须是字母或数字。
2. 先展示角色参考图。制作九行标准动作和十六个注视方向，保持同一角色、透明背景、脚底位置一致。不要把网格线、文字、阴影底板或其他角色画进图集。
3. 每帧整理成透明 PNG，按图集规范放入帧文件夹。允许用图像工具生成一行动作后切分；不得凭空复制同一张静态图充当所有动作。无法提供动画素材时说明缺少哪一行。
4. 使用 `scripts/pet_tools.py assemble` 组装图集；它会保持纵横比，将角色放在帧底部中央并留边距。使用清单模板写入角色名称和描述。
5. 执行 `validate`，检查透明通道、尺寸、必须的动作帧和清单。再用当前工具展示 idle、行走、跳跃、挥手和注视的动画或连续帧，检查角色是否跳位、裁切、变形。
6. 执行 `pack` 生成 ZIP。交付 ZIP、预览和简短安装说明：DeskMate → 宠物库 → 选择 ZIP 或拖入 ZIP。只在用户要求时发布或上传宠物。

## 命令

需要 Python 3.10+ 和 Pillow；缺少 Pillow 时安装 `python -m pip install Pillow`。

```text
python scripts/pet_tools.py assemble frames my-pet --id studio-cat --name 工作室小猫 --description 安静陪伴工作的伙伴
python scripts/pet_tools.py validate my-pet
python scripts/pet_tools.py pack my-pet studio-cat.zip
```

宠物目录只放 `pet.json`、`spritesheet.webp` 和可选的 `ASSET_LICENSE.txt`。制作过程文件、提示词和 skill 本身放在目录之外。压缩包与解压内容各不超过 25 MiB。

修复已有素材时先执行校验，针对错误修改。不要覆盖用户唯一的原始图片或源文件；新产物输出到另一个目录。
