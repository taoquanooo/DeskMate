import { useEffect, useRef, useState } from "react";
import { listenEvent, petTrashList, petTrashRestore, type TrashedPet } from "../lib/tauri";

export function LocalPetTrash({ folderPath }: { folderPath?: string }) {
  const [entries, setEntries] = useState<TrashedPet[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const generation = useRef(0);
  useEffect(() => {
    const current = ++generation.current;
    let active = true;
    let request = 0;
    const disposers: Array<() => void> = [];
    setEntries([]);
    setNotice(null);
    setBusy(null);
    const refresh = async () => {
      const latest = ++request;
      try {
        const entries = await petTrashList();
        if (active && latest === request) {
          setEntries(entries);
          setError(null);
        }
      } catch (error) {
        if (active && latest === request) setError(`无法读取宠物回收站：${String(error)}`);
      }
    };
    // Subscribe before the first read; refresh requests reject stale responses.
    void Promise.all(
      ["pet://uninstalled", "pet://restored"].map(async (event) => {
        const dispose = await listenEvent(event, () => {
          if (active) void refresh();
        });
        if (active) disposers.push(dispose);
        else dispose();
      }),
    )
      .then(() => {
        if (active) void refresh();
      })
      .catch((error) => {
        if (active) setError(`无法监听回收站变化：${String(error)}`);
      });
    return () => {
      active = false;
      if (generation.current === current) generation.current++;
      disposers.forEach((dispose) => dispose());
    };
  }, [folderPath, revision]);

  async function restore(entry: TrashedPet) {
    const current = generation.current;
    setBusy(entry.id);
    setError(null);
    setNotice(null);
    try {
      await petTrashRestore(entry.id);
      if (generation.current !== current) return;
      setEntries((entries) => entries.filter((item) => item.id !== entry.id));
      setNotice(`已恢复“${entry.displayName}”，可在自定义宠物列表中使用。`);
    } catch (error) {
      if (generation.current === current) setError(`恢复失败：${String(error)}`);
    } finally {
      if (generation.current === current) setBusy(null);
    }
  }
  return (
    <details className="local-pet-trash">
      <summary>宠物回收站{entries.length > 0 ? `（${entries.length}）` : ""}</summary>
      <p>
        自定义宠物删除后保留在当前自定义文件夹的回收站中，可在此恢复。更改自定义文件夹后，旧回收站仍保留在原文件夹。
      </p>
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      {!error && entries.length === 0 && <p>回收站为空。</p>}
      {entries.map((entry) => (
        <div className="trash-entry" key={entry.id}>
          <span>
            <strong>{entry.displayName}</strong>
            <small>
              {entry.folderName} · {new Date(entry.deletedAt).toLocaleString()}
            </small>
          </span>
          <button
            type="button"
            className="button button-secondary"
            disabled={busy !== null}
            aria-label={`恢复 ${entry.displayName}`}
            onClick={() => void restore(entry)}
          >
            {busy === entry.id ? "恢复中…" : "恢复"}
          </button>
        </div>
      ))}
      <button
        type="button"
        className="button button-secondary"
        disabled={busy !== null}
        onClick={() => setRevision((value) => value + 1)}
      >
        刷新回收站
      </button>
    </details>
  );
}
