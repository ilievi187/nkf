import React, { useEffect, useState } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import {
  Loader2,
  Trash2,
  CheckCheck,
  Sparkles,
  FolderPlus,
  FolderOpen,
  X,
  Search,
  RotateCcw,
} from "lucide-react";
import { ModalDialog } from "./ModalDialog";
import { fmtBytes, nkfApi, type DuplicateGroup } from "../lib/api";

interface DuplicatesModalProps {
  open: boolean;
  dirPath: string;
  otherDir?: string;
  onClose: () => void;
  onDeleted: (count: number) => void;
  onError: (msg: string) => void;
}

export const DuplicatesModal: React.FC<DuplicatesModalProps> = ({
  open,
  dirPath,
  otherDir,
  onClose,
  onDeleted,
  onError,
}) => {
  const [folders, setFolders] = useState<string[]>([]);
  const [hasScanned, setHasScanned] = useState(false);
  const [groups, setGroups] = useState<DuplicateGroup[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState(false);

  // Reset state when modal opens — never auto-scan!
  useEffect(() => {
    if (!open) return;
    setFolders(dirPath ? [dirPath] : []);
    setHasScanned(false);
    setGroups([]);
    setSelected(new Set());
    setLoading(false);
  }, [open, dirPath]);

  const addFolders = async () => {
    try {
      const picked = await openDialog({
        directory: true,
        multiple: true,
        defaultPath: dirPath || undefined,
        title: "Select folder(s) to scan for duplicates",
      });
      if (!picked) return;
      const list = Array.isArray(picked) ? picked : [picked];
      setFolders((prev) => {
        const next = [...prev];
        for (const p of list) {
          if (p && !next.includes(p)) next.push(p);
        }
        return next;
      });
      setHasScanned(false);
    } catch (e) {
      onError(String(e));
    }
  };

  const addFolderDirect = (path: string) => {
    if (!path) return;
    setFolders((prev) => (prev.includes(path) ? prev : [...prev, path]));
    setHasScanned(false);
  };

  const removeFolder = (path: string) => {
    setFolders((prev) => prev.filter((p) => p !== path));
    setHasScanned(false);
  };

  const startScan = async () => {
    if (folders.length === 0) return;
    setLoading(true);
    setSelected(new Set());
    setHasScanned(false);
    try {
      const result = await nkfApi.findDuplicates(folders);
      setGroups(result);
      setHasScanned(true);
    } catch (e) {
      onError(String(e));
    } finally {
      setLoading(false);
    }
  };

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
      subtitle="Select folders to scan for exact SHA-256 duplicate files"
    >
      <div className="space-y-4">
        {/* Folder Picker Section */}
        <div
          className="rounded-xl border p-3 space-y-2.5"
          style={{ background: "var(--surface-alt)", borderColor: "var(--border)" }}
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs font-semibold flex items-center gap-1.5">
              <FolderOpen size={14} style={{ color: "var(--accent)" }} />
              Folders to Scan ({folders.length})
            </span>
            <div className="flex flex-wrap items-center gap-1.5">
              {otherDir && !folders.includes(otherDir) && (
                <button
                  type="button"
                  disabled={loading}
                  onClick={() => addFolderDirect(otherDir)}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-medium cursor-pointer disabled:opacity-40"
                  style={{ background: "var(--surface)", color: "var(--text)" }}
                  title={`Add other split pane: ${otherDir}`}
                >
                  <FolderPlus size={12} /> + Other Pane
                </button>
              )}
              <button
                type="button"
                disabled={loading}
                onClick={addFolders}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-semibold cursor-pointer disabled:opacity-40"
                style={{ background: "var(--accent)", color: "var(--accent-text)" }}
              >
                <FolderPlus size={13} /> Add Folder…
              </button>
            </div>
          </div>

          {folders.length === 0 ? (
            <div className="text-xs py-2 text-center" style={{ color: "var(--text-muted)" }}>
              No folders selected. Click <strong>Add Folder…</strong> to choose one or more folders.
            </div>
          ) : (
            <div className="space-y-1 max-h-28 overflow-y-auto nkf-scroll">
              {folders.map((f) => (
                <div
                  key={f}
                  className="flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg text-xs"
                  style={{ background: "var(--surface)" }}
                >
                  <span className="truncate font-mono text-[11px]" title={f}>
                    {f}
                  </span>
                  <button
                    type="button"
                    disabled={loading}
                    onClick={() => removeFolder(f)}
                    className="p-0.5 rounded hover:bg-white/10 cursor-pointer shrink-0 disabled:opacity-40"
                    title="Remove folder"
                  >
                    <X size={13} />
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="flex items-center justify-end gap-2 pt-1">
            {hasScanned && !loading && (
              <button
                type="button"
                onClick={startScan}
                disabled={folders.length === 0}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium cursor-pointer disabled:opacity-40"
                style={{ background: "var(--surface)" }}
              >
                <RotateCcw size={13} /> Rescan
              </button>
            )}
            {!hasScanned && (
              <button
                type="button"
                disabled={folders.length === 0 || loading}
                onClick={startScan}
                className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-semibold cursor-pointer disabled:opacity-40"
                style={{ background: "var(--accent)", color: "var(--accent-text)" }}
              >
                {loading ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />}
                {loading ? "Scanning…" : "Start Scan"}
              </button>
            )}
          </div>
        </div>

        {/* Scan Status & Results */}
        {loading ? (
          <div
            className="py-10 flex items-center justify-center gap-2 text-sm"
            style={{ color: "var(--text-muted)" }}
          >
            <Loader2 size={18} className="animate-spin" /> Scanning & hashing duplicate candidates...
          </div>
        ) : !hasScanned ? (
          <div className="py-6 text-center text-xs" style={{ color: "var(--text-muted)" }}>
            Choose the folder(s) you want to check and click <strong>Start Scan</strong>.
          </div>
        ) : groups.length === 0 ? (
          <div className="py-8 text-center space-y-2">
            <Sparkles size={34} className="mx-auto text-emerald-400" />
            <div className="text-sm font-semibold">No duplicate files found!</div>
            <div className="text-xs" style={{ color: "var(--text-muted)" }}>
              The selected folder(s) are clean.
            </div>
          </div>
        ) : (
          <div className="space-y-3">
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

            <div className="space-y-3 max-h-[38vh] overflow-y-auto nkf-scroll pr-1">
              {groups.map((g) => (
                <div
                  key={g.hash}
                  className="rounded-xl border p-3 space-y-1.5"
                  style={{ background: "var(--surface-alt)", borderColor: "var(--border)" }}
                >
                  <div
                    className="flex items-center justify-between text-[11px] font-mono"
                    style={{ color: "var(--text-muted)" }}
                  >
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
          </div>
        )}

        {/* Footer Actions */}
        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-xs font-medium cursor-pointer"
            style={{ background: "var(--surface-alt)" }}
          >
            Close
          </button>
          {hasScanned && groups.length > 0 && (
            <button
              type="button"
              disabled={selected.size === 0 || deleting}
              onClick={trashSelected}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold bg-red-600 text-white cursor-pointer disabled:opacity-40"
            >
              {deleting ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
              Move {selected.size} to Trash
            </button>
          )}
        </div>
      </div>
    </ModalDialog>
  );
};
