import React, { useEffect, useState } from "react";
import { Loader2, Trash2, CheckCheck, Sparkles } from "lucide-react";
import { ModalDialog } from "./ModalDialog";
import { fmtBytes, nkfApi, type DuplicateGroup } from "../lib/api";

interface DuplicatesModalProps {
  open: boolean;
  dirPath: string;
  onClose: () => void;
  onDeleted: (count: number) => void;
  onError: (msg: string) => void;
}

export const DuplicatesModal: React.FC<DuplicatesModalProps> = ({
  open,
  dirPath,
  onClose,
  onDeleted,
  onError,
}) => {
  const [groups, setGroups] = useState<DuplicateGroup[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (!open || !dirPath) return;
    setLoading(true);
    setSelected(new Set());
    nkfApi
      .findDuplicates(dirPath)
      .then(setGroups)
      .catch((e) => onError(String(e)))
      .finally(() => setLoading(false));
  }, [open, dirPath, onError]);

  const totalWasted = groups.reduce((acc, g) => acc + g.wasted_bytes, 0);

  const selectAllCopies = () => {
    const next = new Set<string>();
    for (const g of groups) {
      g.files.slice(1).forEach((f) => next.add(f.path));
    }
    setSelected(next);
  };

  const togglePath = (p: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(p)) next.delete(p);
      else next.add(p);
      return next;
    });
  };

  const trashSelected = async () => {
    if (selected.size === 0) return;
    setDeleting(true);
    try {
      const count = await nkfApi.deleteItems(Array.from(selected), false);
      onDeleted(count);
      onClose();
    } catch (e) {
      onError(String(e));
    } finally {
      setDeleting(false);
    }
  };

  return (
    <ModalDialog
      open={open}
      onClose={onClose}
      title="Duplicate File Finder"
      subtitle={`${dirPath} — SHA-256 exact match scan`}
    >
      {loading ? (
        <div className="py-12 flex items-center justify-center gap-2 text-sm" style={{ color: "var(--text-muted)" }}>
          <Loader2 size={18} className="animate-spin" /> Scanning & hashing duplicate candidates...
        </div>
      ) : groups.length === 0 ? (
        <div className="py-10 text-center space-y-2">
          <Sparkles size={36} className="mx-auto text-emerald-400" />
          <div className="text-sm font-semibold">No duplicate files found!</div>
          <div className="text-xs" style={{ color: "var(--text-muted)" }}>
            This folder is clean.
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
            <span style={{ color: "var(--text-muted)" }}>
              Found <strong>{groups.length}</strong> duplicate group(s) —{" "}
              <strong className="text-amber-400">{fmtBytes(totalWasted)}</strong> reclaimable
            </span>
            <button
              type="button"
              onClick={selectAllCopies}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-medium cursor-pointer"
              style={{ background: "var(--surface-alt)" }}
            >
              <CheckCheck size={14} /> Auto-Select Copies (Keep 1st)
            </button>
          </div>

          <div className="space-y-3 max-h-[48vh] overflow-y-auto nkf-scroll pr-1">
            {groups.map((g) => (
              <div
                key={g.hash}
                className="rounded-xl border p-3 space-y-1.5"
                style={{ background: "var(--surface-alt)", borderColor: "var(--border)" }}
              >
                <div className="flex items-center justify-between text-[11px] font-mono" style={{ color: "var(--text-muted)" }}>
                  <span>
                    {g.files.length} identical files • {fmtBytes(g.size)} each
                  </span>
                  <span>SHA-256: {g.hash.slice(0, 12)}…</span>
                </div>
                {g.files.map((f, idx) => (
                  <label
                    key={f.path}
                    className="flex items-center gap-2 text-xs py-1 px-2 rounded-lg hover:bg-white/5 cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={selected.has(f.path)}
                      onChange={() => togglePath(f.path)}
                    />
                    <span className="truncate flex-1 font-mono text-[11px]" title={f.path}>
                      {f.path}
                    </span>
                    {idx === 0 && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 shrink-0">
                        Original
                      </span>
                    )}
                  </label>
                ))}
              </div>
            ))}
          </div>

          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-lg text-xs font-medium cursor-pointer"
              style={{ background: "var(--surface-alt)" }}
            >
              Close
            </button>
            <button
              type="button"
              disabled={selected.size === 0 || deleting}
              onClick={trashSelected}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold bg-red-600 text-white cursor-pointer disabled:opacity-40"
            >
              {deleting ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
              Move {selected.size} to Trash
            </button>
          </div>
        </div>
      )}
    </ModalDialog>
  );
};
