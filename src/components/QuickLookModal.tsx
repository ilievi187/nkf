import React, { useEffect, useState } from "react";
import { ExternalLink, File, Folder, Loader2 } from "lucide-react";
import { ModalDialog } from "./ModalDialog";
import { fmtBytes, fmtDate, nkfApi, type FileEntry, type PreviewData } from "../lib/api";

interface QuickLookModalProps {
  entry: FileEntry | null;
  onClose: () => void;
}

export const QuickLookModal: React.FC<QuickLookModalProps> = ({ entry, onClose }) => {
  const [preview, setPreview] = useState<PreviewData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!entry) return;
    setLoading(true);
    setError(null);
    setPreview(null);
    nkfApi
      .readPreview(entry.path)
      .then(setPreview)
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, [entry]);

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
        <div className="py-12 flex items-center justify-center gap-2 text-sm" style={{ color: "var(--text-muted)" }}>
          <Loader2 size={18} className="animate-spin" /> Loading preview...
        </div>
      )}

      {error && <p className="text-sm text-red-400">{error}</p>}

      {!loading && preview && entry && (
        <div className="space-y-4">
          {preview.kind === "image" && (
            <div className="rounded-xl overflow-hidden border bg-black/30 flex items-center justify-center p-2" style={{ borderColor: "var(--border)" }}>
              <img src={preview.content} alt={entry.name} className="max-h-[58vh] object-contain rounded" />
            </div>
          )}

          {preview.kind === "text" && (
            <div className="space-y-1.5">
              <pre
                className="p-4 rounded-xl border text-xs font-mono overflow-auto max-h-[56vh] nkf-scroll select-text whitespace-pre-wrap break-words"
                style={{ background: "var(--bg)", borderColor: "var(--border)" }}
              >
                {preview.content}
              </pre>
              {preview.truncated && (
                <p className="text-[11px] m-0" style={{ color: "var(--text-muted)" }}>
                  Showing first 96 KB of {fmtBytes(preview.size)}.
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

          <div className="flex justify-end gap-2 pt-1">
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
      )}
    </ModalDialog>
  );
};
