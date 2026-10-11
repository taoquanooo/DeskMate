import { useEffect, useRef, useState } from "react";
import {
  listenEvent,
  listenFileDrop,
  petImportCancel,
  petImportCommit,
  petImportPick,
  petImportPrepare,
  type ImportPreview,
  type ImportProgress,
  type ImportSource,
} from "../lib/tauri";

export function PetImportPanel({
  active,
  folderPath,
  onImported,
  onUse,
}: {
  active: boolean;
  folderPath?: string;
  onImported: () => void;
  onUse: (id: string) => void;
}) {
  const [url, setUrl] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [hover, setHover] = useState(false);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [installed, setInstalled] = useState<ImportPreview | null>(null);
  const task = useRef<string | null>(null);
  const pending = useRef<string | null>(null);
  const mounted = useRef(true);
  const onImportedRef = useRef(onImported);
  onImportedRef.current = onImported;
  const validUrl = (() => {
    try {
      const parsed = new URL(url.trim());
      return parsed.protocol === "https:" && !parsed.username && !parsed.password;
    } catch {
      return false;
    }
  })();
  const commit = async (pet: ImportPreview, replace: boolean) => {
    setBusy(true);
    setMessage("正在安装…");
    setError("");
    try {
      await petImportCommit(pet.token, replace);
      pending.current = null;
      onImportedRef.current();
      if (mounted.current) {
        setInstalled(pet);
        setPreview(null);
        setMessage(`${pet.displayName} 安装完成`);
      }
    } catch (cause) {
      pending.current = null;
      if (mounted.current) {
        setError(String(cause));
        setPreview(null);
        setMessage("");
      }
    } finally {
      task.current = null;
      if (mounted.current) setBusy(false);
    }
  };
  const begin = async (source: ImportSource) => {
    if (task.current || pending.current) return;
    const id = crypto.randomUUID();
    task.current = id;
    setBusy(true);
    setError("");
    setInstalled(null);
    setMessage(source.kind === "url" ? "正在下载…" : "正在校验 ZIP…");
    try {
      const pet = await petImportPrepare(id, source);
      if (!mounted.current) {
        await petImportCancel(pet.token);
        return;
      }
      pending.current = pet.token;
      if (pet.conflict) {
        setPreview(pet);
        setBusy(false);
        setMessage("");
      } else await commit(pet, false);
    } catch (cause) {
      if (mounted.current) {
        setError(String(cause));
        setMessage("");
        setBusy(false);
      }
      task.current = null;
    }
  };
  const beginRef = useRef(begin);
  beginRef.current = begin;
  useEffect(() => {
    mounted.current = true;
    let stopped = false;
    let disposeProgress: (() => void) | undefined;
    void listenEvent<ImportProgress>("pet://import-progress", (progress) => {
      if (!mounted.current || progress.taskId !== task.current) return;
      setMessage(
        progress.stage === "validating"
          ? "正在校验宠物文件…"
          : progress.total
            ? `正在下载… ${Math.min(100, Math.round((progress.downloaded / progress.total) * 100))}%`
            : `正在下载… ${(progress.downloaded / 1024 / 1024).toFixed(1)} MiB`,
      );
    })
      .then((dispose) => {
        if (stopped) dispose();
        else disposeProgress = dispose;
      })
      .catch((cause) => {
        if (!stopped) setError(`无法显示安装进度：${String(cause)}`);
      });
    return () => {
      mounted.current = false;
      stopped = true;
      disposeProgress?.();
      // Commit may have already consumed the token when this view closes.
      if (pending.current) void petImportCancel(pending.current).catch(() => {});
    };
  }, []);
  useEffect(() => {
    if (!active) {
      setHover(false);
      return;
    }
    let stopped = false;
    let dispose: (() => void) | undefined;
    void listenFileDrop((paths) => {
      const path = paths[0];
      if (paths.length !== 1 || !path || !/\.zip$/i.test(path)) {
        setError("请一次拖入一个 ZIP 压缩包");
        return;
      }
      void beginRef.current({ kind: "file", path });
    }, setHover)
      .then((unlisten) => {
        if (stopped) unlisten();
        else dispose = unlisten;
      })
      .catch((cause) => {
        if (!stopped) setError(`无法启用拖放：${String(cause)}`);
      });
    return () => {
      stopped = true;
      dispose?.();
    };
  }, [active]);
  return (
    <section className={`pet-import-panel ${hover ? "drop-hover" : ""}`} aria-label="安装宠物">
      <h2>安装宠物</h2>
      <p>粘贴 ZIP 直链，或将一个 ZIP 拖入本页。文件仅安装到本机。</p>
      <div className="pet-import-methods">
        <form
          className="import-url-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (validUrl) void begin({ kind: "url", url: url.trim() });
          }}
        >
          <label>
            宠物 ZIP 链接
            <input
              type="url"
              placeholder="https://…/my-pet.zip"
              value={url}
              disabled={busy || !!preview}
              onChange={(event) => setUrl(event.target.value)}
            />
          </label>
          <button className="button button-primary" disabled={!validUrl || busy || !!preview}>
            下载安装
          </button>
        </form>
        <button
          type="button"
          className="import-drop-zone"
          disabled={busy || !!preview}
          onClick={() => {
            void petImportPick()
              .then((path) => {
                if (path) return begin({ kind: "file", path });
              })
              .catch((cause) => setError(String(cause)));
          }}
        >
          {hover ? "松开即可安装" : "拖入 ZIP 或点击选择 ZIP"}
        </button>
      </div>
      <small>
        支持 Codex v1 / v2，一次一只，最多 25 MiB。
        {folderPath && (
          <>
            安装到：<code>{folderPath}</code>
          </>
        )}
      </small>
      {message && <p role="status">{message}</p>}
      {error && (
        <p role="alert" className="local-pet-errors">
          {error}
        </p>
      )}
      {preview && (
        <div role="alertdialog" aria-label="确认替换宠物" className="import-confirm">
          <p>
            已存在“{preview.conflict}”（{preview.id}）。替换后旧宠物保留在回收站。
          </p>
          <div className="form-actions">
            <button
              className="button button-primary"
              disabled={busy}
              onClick={() => void commit(preview, true)}
            >
              替换并保留旧宠物
            </button>
            <button
              className="button button-secondary"
              disabled={busy}
              onClick={() => {
                void petImportCancel(preview.token)
                  .then(() => {
                    pending.current = null;
                    task.current = null;
                    setPreview(null);
                    setMessage("已取消，现有宠物未改变");
                  })
                  .catch((cause) => setError(String(cause)));
              }}
            >
              取消
            </button>
          </div>
        </div>
      )}
      {installed && (
        <button className="button button-secondary" onClick={() => onUse(installed.id)}>
          使用此宠物
        </button>
      )}
    </section>
  );
}
