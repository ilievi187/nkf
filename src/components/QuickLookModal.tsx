import React, { useEffect, useState } from "react";
import { ExternalLink, File, Folder, Loader2, Pencil, Save, Check } from "lucide-react";
import { ModalDialog } from "./ModalDialog";
import { fmtBytes, fmtDate, nkfApi, type FileEntry, type PreviewData } from "../lib/api";

interface QuickLookModalProps {
  entry: FileEntry | null;
  onClose: () => void;
  onSaved?: (name: string) => void;
}

export const QuickLookModal: React.FC<QuickLookModalProps> = ({ entry, onClose, onSaved }) => {
  const [preview, setPreview] = useState<PreviewData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [savedNotice, setSavedNotice] = useState(false);

  useEffect(() => {
    if (!entry) return;
    setLoading(true);
    setError(null);
    setPreview(null);
    setEditing(false);
    setSavedNotice(false);
    nkfApi
      .readPreview(entry.path)
      .then((data) => {
        setPreview(data);
        if (data.kind === "text") setDraft(data.content);
      })
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, [entry]);

  const handleSave = async () => {
    if (!entry) return;
    setSaving(true);
    try {
      await nkfApi.writeTextFile(entry.path, draft);
      setPreview((prev) => (prev ? { ...prev, content: draft } : prev));
      setEditing(false);
      setSavedNotice(true);
      onSaved?.(entry.name);
      setTimeout(() => setSavedNotice(false), 2000);
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalDialog
      open={Boolean(entry)}
      onClose={onClose}
      title={entry ? entry.name : "Quick Look"}
      subtitle={
        entry
          ? `${entry.is_dir ? "Folder" : fmtBytes(entry.size)} • Modified ${fmtDate(entry.modified_ms)}`
          : ""
      }
    >
      {loading && (
        <div
          className="py-12 flex items-center justify-center gap-2 text-sm"
          style={{ color: "var(--text-muted)" }}
        >
          <Loader2 size={18} className="animate-spin" /> Loading preview...
        </div>
      )}

      {error && <p className="text-sm text-red-400">{error}</p>}

      {!loading && preview && entry && (
        <div className="space-y-4">
          {preview.kind === "image" && (
            <div
              className="rounded-xl overflow-hidden border bg-black/30 flex items-center justify-center p-2"
              style={{ borderColor: "var(--border)" }}
            >
              <img
                src={preview.content}
                alt={entry.name}
                className="max-h-[58vh] object-contain rounded"
              />
            </div>
          )}

          {preview.kind === "text" && (
            <div className="space-y-2">
              {editing ? (
                <textarea
                  autoFocus
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
                      e.preventDefault();
                      handleSave();
                    }
                  }}
                  className="w-full h-[54vh] p-4 rounded-xl border text-xs font-mono nkf-scroll outline-none resize-none"
                  style={{
                    background: "var(--bg)",
                    borderColor: "var(--accent)",
                    color: "var(--text)",
                  }}
                />
              ) : (
                <pre
                  className="p-4 rounded-xl border text-xs font-mono overflow-auto max-h-[54vh] nkf-scroll select-text whitespace-pre-wrap break-words"
                  style={{ background: "var(--bg)", borderColor: "var(--border)" }}
                >
                  {preview.content}
                </pre>
              )}
              {preview.truncated && (
                <p className="text-[11px] m-0 text-amber-400">
                  File is larger than 96 KB ({fmtBytes(preview.size)}) — inline editing disabled to
                  prevent truncation.
                </p>
              )}
            </div>
          )}

          {preview.kind === "dir" && (
            <div className="py-10 text-center space-y-2">
              <Folder size={44} className="mx-auto" style={{ color: "var(--accent)" }} />
              <div className="text-sm font-medium">{preview.content}</div>
              <div className="text-xs font-mono" style={{ color: "var(--text-muted)" }}>
                {entry.path}
              </div>
            </div>
          )}

          {preview.kind === "binary" && (
            <div className="py-10 text-center space-y-2">
              <File size={44} className="mx-auto" style={{ color: "var(--text-muted)" }} />
              <div className="text-sm font-semibold">{entry.name}</div>
              <div className="text-xs" style={{ color: "var(--text-muted)" }}>
                Binary file ({preview.mime || "unknown"}) • {fmtBytes(preview.size)}
              </div>
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
            <div>
              {savedNotice && (
                <span className="inline-flex items-center gap-1 text-xs text-emerald-400 font-medium">
                  <Check size={14} /> Saved!
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              {preview.kind === "text" && !preview.truncated && (
                editing ? (
                  <>
                    <button
                      type="button"
                      onClick={() => {
                        setDraft(preview.content);
                        setEditing(false);
                      }}
                      className="px-3 py-2 rounded-lg text-xs font-medium cursor-pointer"
                      style={{ background: "var(--surface-alt)" }}
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      disabled={saving}
                      onClick={handleSave}
                      className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold bg-emerald-600 text-white cursor-pointer"
                    >
                      {saving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
                      Save (Ctrl+S)
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={() => setEditing(true)}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-semibold cursor-pointer"
                    style={{ background: "var(--surface-alt)" }}
                  >
                    <Pencil size={13} /> Edit Inline
                  </button>
                )
              )}

              <button
                type="button"
                onClick={() => nkfApi.openWithDefault(entry.path)}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold cursor-pointer"
                style={{ background: "var(--accent)", color: "var(--accent-text)" }}
              >
                <ExternalLink size={14} /> Open with Default App
              </button>
            </div>
          </div>
        </div>
      )}
    </ModalDialog>
  );
};
