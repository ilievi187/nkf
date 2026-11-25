import React, { useEffect, useState } from "react";
import { ArrowRight, ArrowLeft, Loader2, CheckCircle2, Folder, File } from "lucide-react";
import { ModalDialog } from "./ModalDialog";
import { fmtBytes, nkfApi, type CompareItem } from "../lib/api";

interface FolderCompareModalProps {
  open: boolean;
  leftDir: string;
  rightDir: string;
  onClose: () => void;
  onSynced: (msg: string) => void;
  onError: (msg: string) => void;
}

export const FolderCompareModal: React.FC<FolderCompareModalProps> = ({
  open,
  leftDir,
  rightDir,
  onClose,
  onSynced,
  onError,
}) => {
  const [items, setItems] = useState<CompareItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [hideSame, setHideSame] = useState(true);

  const load = () => {
    if (!leftDir || !rightDir) return;
    setLoading(true);
    nkfApi
      .compareFolders(leftDir, rightDir)
      .then(setItems)
      .catch((e) => onError(String(e)))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    if (open) load();
  }, [open, leftDir, rightDir]);

  const onlyLeft = items.filter((i) => i.status === "only_left" && i.left_path);
  const onlyRight = items.filter((i) => i.status === "only_right" && i.right_path);
  const different = items.filter((i) => i.status === "different");
  const visible = hideSame ? items.filter((i) => i.status !== "same") : items;

  const syncDirection = async (dir: "l2r" | "r2l") => {
    const sources =
      dir === "l2r"
        ? onlyLeft.map((i) => i.left_path!)
        : onlyRight.map((i) => i.right_path!);
    if (sources.length === 0) return;
    setSyncing(true);
    try {
      const dest = dir === "l2r" ? rightDir : leftDir;
      const count = await nkfApi.copyItems(sources, dest);
      onSynced(`Synced ${count} missing item(s) ${dir === "l2r" ? "Left → Right" : "Right → Left"}`);
      load();
    } catch (e) {
      onError(String(e));
    } finally {
      setSyncing(false);
    }
  };

  return (
    <ModalDialog
      open={open}
      onClose={onClose}
      title="Folder Compare & Sync"
      subtitle={`${leftDir}  ⇄  ${rightDir}`}
    >
      {loading ? (
        <div className="py-12 flex items-center justify-center gap-2 text-xs" style={{ color: "var(--text-muted)" }}>
          <Loader2 size={16} className="animate-spin" /> Comparing folders...
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
            <div className="flex items-center gap-2">
              <span className="px-2 py-0.5 rounded bg-blue-500/20 text-blue-300">
                Only Left: {onlyLeft.length}
              </span>
              <span className="px-2 py-0.5 rounded bg-purple-500/20 text-purple-300">
                Only Right: {onlyRight.length}
              </span>
              <span className="px-2 py-0.5 rounded bg-amber-500/20 text-amber-300">
                Different: {different.length}
              </span>
            </div>
            <label className="inline-flex items-center gap-1.5 cursor-pointer" style={{ color: "var(--text-muted)" }}>
              <input
                type="checkbox"
                checked={hideSame}
                onChange={(e) => setHideSame(e.target.checked)}
              />
              Hide identical
            </label>
          </div>

          {visible.length === 0 ? (
            <div className="py-10 text-center space-y-2">
              <CheckCircle2 size={36} className="mx-auto text-emerald-400" />
              <div className="text-sm font-semibold">Both folders match!</div>
            </div>
          ) : (
            <div
              className="rounded-xl border max-h-[45vh] overflow-y-auto nkf-scroll divide-y"
              style={{ borderColor: "var(--border)", background: "var(--bg)" }}
            >
              {visible.map((it) => (
                <div
                  key={it.name}
                  className="px-3 py-2 text-xs flex items-center justify-between gap-3"
                  style={{ borderColor: "var(--border)" }}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    {it.is_dir ? (
                      <Folder size={14} style={{ color: "var(--accent)" }} />
                    ) : (
                      <File size={14} style={{ color: "var(--text-muted)" }} />
                    )}
                    <span className="truncate font-medium">{it.name}</span>
                  </div>
                  <div className="flex items-center gap-2 shrink-0 font-mono text-[11px]">
                    {it.status === "only_left" && (
                      <span className="px-2 py-0.5 rounded bg-blue-500/20 text-blue-300">
                        Left only ({it.is_dir ? "dir" : fmtBytes(it.left_size)})
                      </span>
                    )}
                    {it.status === "only_right" && (
                      <span className="px-2 py-0.5 rounded bg-purple-500/20 text-purple-300">
                        Right only ({it.is_dir ? "dir" : fmtBytes(it.right_size)})
                      </span>
                    )}
                    {it.status === "different" && (
                      <span className="px-2 py-0.5 rounded bg-amber-500/20 text-amber-300">
                        {fmtBytes(it.left_size)} ≠ {fmtBytes(it.right_size)}
                      </span>
                    )}
                    {it.status === "same" && (
                      <span style={{ color: "var(--text-muted)" }}>Identical</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="flex flex-wrap justify-end gap-2 pt-1">
            <button
              type="button"
              disabled={syncing || onlyRight.length === 0}
              onClick={() => syncDirection("r2l")}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-semibold cursor-pointer disabled:opacity-40"
              style={{ background: "var(--surface-alt)" }}
            >
              <ArrowLeft size={14} /> Sync Missing Right → Left ({onlyRight.length})
            </button>
            <button
              type="button"
              disabled={syncing || onlyLeft.length === 0}
              onClick={() => syncDirection("l2r")}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-semibold cursor-pointer disabled:opacity-40"
              style={{ background: "var(--accent)", color: "var(--accent-text)" }}
            >
              Sync Missing Left → Right ({onlyLeft.length}) <ArrowRight size={14} />
            </button>
          </div>
        </div>
      )}
    </ModalDialog>
  );
};
