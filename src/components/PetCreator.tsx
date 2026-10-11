import { useState } from "react";
import { petSkillExport } from "../lib/tauri";

const PROMPT = `请使用 deskmate-create-pet skill 为 DeskMate 制作动画宠物。
角色名称：【填写名称】
角色描述或参考图片：【填写外貌、颜色、服装、性格，或附上参考图片】
请先展示角色设计，再制作一致的透明动画图集。
默认采用 Codex v2：1536×2288，8×11 格，每格 192×208。
包含 idle、左右行走、挥手、跳跃、懊恼、等待、原地忙碌、庆祝及十六向注视。
请按 skill 的图集规范校验并打包 pet.json、spritesheet.webp 和可选授权文件，交付可直接导入 DeskMate 的 ZIP 和动画预览。`;

export function PetCreator({ onOpenLibrary }: { onOpenLibrary: () => void }) {
  const [copied, setCopied] = useState(false);
  const [saved, setSaved] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  return (
    <div className="pet-creator">
      <header className="page-header">
        <h1>开发宠物</h1>
        <p>用自己的 AI 工具制作动画伙伴，再一键安装到 DeskMate。</p>
      </header>
      <section className="creator-card">
        <h2>下载制作 skill</h2>
        <p>deskmate-create-pet 包含制作指导、图集规范、清单模板和校验／打包脚本，随应用内置，离线可下载。</p>
        <button
          className="button button-primary"
          disabled={saving}
          onClick={() => {
            setSaving(true);
            setError("");
            void petSkillExport()
              .then((path) => {
                if (path) setSaved(path);
              })
              .catch((cause) => setError(String(cause)))
              .finally(() => setSaving(false));
          }}
        >
          {saving ? "正在保存…" : "下载制作 skill"}
        </button>
        {saved && (
          <p role="status">
            已保存：<code>{saved}</code>
          </p>
        )}
      </section>
      <section className="creator-card">
        <h2>三步制作与安装</h2>
        <ol>
          <li>
            <strong>准备角色</strong>
            <p>写下外貌、配色和性格，或准备一张参考图片。先让 AI 展示角色设计，再制作动作。</p>
          </li>
          <li>
            <strong>使用 skill</strong>
            <p>
              解压后把 deskmate-create-pet 文件夹放进 AI 工具的 skills 目录，或向工具提供 SKILL.md
              和配套文件。制作脚本需要 Python 3.10+ 与 Pillow。
            </p>
          </li>
          <li>
            <strong>校验并安装</strong>
            <p>让 AI 执行脚本校验、生成 ZIP，再到宠物库选择 ZIP 或直接拖入。检查行走、跳跃和注视是否完整。</p>
          </li>
        </ol>
        <button className="button button-secondary" onClick={onOpenLibrary}>
          前往宠物库安装
        </button>
      </section>
      <section className="creator-card">
        <h2>复制制作提示词</h2>
        <label className="creator-prompt-label">
          填写角色信息后发给 AI
          <textarea readOnly value={PROMPT} rows={9} />
        </label>
        <button
          className="button button-secondary"
          onClick={() => {
            setError("");
            if (!navigator.clipboard) {
              setError("无法复制，请手动选择上方提示词复制");
              return;
            }
            void navigator.clipboard
              .writeText(PROMPT)
              .then(() => setCopied(true))
              .catch(() => setError("无法复制，请手动选择上方提示词复制"));
          }}
        >
          {copied ? "提示词已复制" : "复制提示词"}
        </button>
      </section>
      {error && (
        <p role="alert" className="local-pet-errors">
          {error}
        </p>
      )}
    </div>
  );
}
