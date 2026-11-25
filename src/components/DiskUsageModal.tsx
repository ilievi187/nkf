import React, { useEffect, useState } from "react";
import { Folder, File, Loader2 } from "lucide-react";
import { ModalDialog } from "./ModalDialog";
import { fmtBytes, nkfApi, type DiskUsageItem } from "../lib/api";

interface DiskUsageModalProps {
  open: boolean;
  dirPath: string;
  onClose: () => void;
  onNavigate: (path: string) => void;
}

export const DiskUsageModal: React.FC<DiskUsageModalProps> = ({
  open,
  dirPath,
  onClose,
  onNavigate,
}) => {
  const [items, setItems] = useState<DiskUsageItem[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || !dirPath) return;
    setLoading(true);
    nkfApi
      .computeFolderSizes(dirPath)
      .then(setItems)
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
  }, [open, dirPath]);

  const totalBytes = items.reduce((acc, i) => acc + i.size, 0);

  return (
    <ModalDialog
      open={open}
      onClose={onClose}
      title="Disk Space Analyzer"
      subtitle={`${dirPath} — Total: ${fmtBytes(totalBytes)}`}
    >
      {loading ? (
        <div className="py-12 flex items-center justify-center gap-2 text-sm" style={{ color: "var(--text-muted)" }}>
          <Loader2 size={18} className="animate-spin" /> Scanning folder sizes...
        </div>
      ) : (
        <div className="space-y-2 max-h-[58vh] overflow-y-auto nkf-scroll pr-1">
          {items.map((item) => (
            <button
              key={item.path}
              type="button"
              onClick={() => {
                if (item.is_dir) {
                  onNavigate(item.path);
                  onClose();
                }
              }}
              className="w-full text-left p-2.5 rounded-xl border transition-colors cursor-pointer"
              style={{ background: "var(--surface-alt)", borderColor: "var(--border)" }}
            >
              <div className="flex items-center justify-between gap-2 text-xs mb-1.5">
                <span className="flex items-center gap-2 font-medium truncate">
                  {item.is_dir ? (
                    <Folder size={14} style={{ color: "var(--accent)" }} />
                  ) : (
                    <File size={14} style={{ color: "var(--text-muted)" }} />
                  )}
                  <span className="truncate">{item.name}</span>
                </span>
                <span className="font-mono shrink-0" style={{ color: "var(--text-muted)" }}>
                  {fmtBytes(item.size)} ({item.percent.toFixed(1)}%)
                </span>
              </div>
              <div className="h-1.5 rounded-full overflow-hidden bg-black/25">
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${Math.max(1.5, item.percent)}%`,
                    background: "var(--accent)",
                  }}
                />
              </div>
            </button>
          ))}
        </div>
      )}
    </ModalDialog>
  );
};
