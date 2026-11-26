import React, { useEffect, useState } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { Folder, File, Loader2, FolderOpen, Search, RotateCcw, HardDrive } from "lucide-react";
import { ModalDialog } from "./ModalDialog";
import { fmtBytes, nkfApi, type DiskUsageItem, type PlaceItem } from "../lib/api";

interface DiskUsageModalProps {
  open: boolean;
  dirPath: string;
  places?: PlaceItem[];
  onClose: () => void;
  onNavigate: (path: string) => void;
}

export const DiskUsageModal: React.FC<DiskUsageModalProps> = ({
  open,
  dirPath,
  places = [],
  onClose,
  onNavigate,
}) => {
  const [targetDir, setTargetDir] = useState(dirPath);
  const [items, setItems] = useState<DiskUsageItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasScanned, setHasScanned] = useState(false);

  // Never auto-scan on open — let user pick folder/drive and click Start Scan
  useEffect(() => {
    if (!open) return;
    setTargetDir(dirPath);
    setItems([]);
    setHasScanned(false);
    setLoading(false);
  }, [open, dirPath]);

  const pickFolder = async () => {
    try {
      const picked = await openDialog({
        directory: true,
        multiple: false,
        defaultPath: targetDir || undefined,
        title: "Choose folder or drive to analyze",
      });
      if (typeof picked === "string" && picked) {
        setTargetDir(picked);
        setHasScanned(false);
      }
    } catch {
      // ignore cancel
    }
  };

  const startScan = async (overridePath?: string) => {
    const pathToScan = overridePath ?? targetDir;
    if (!pathToScan) return;
    setLoading(true);
    setHasScanned(false);
    try {
      const res = await nkfApi.computeFolderSizes(pathToScan);
      setItems(res);
      setHasScanned(true);
    } catch {
      setItems([]);
      setHasScanned(true);
    } finally {
      setLoading(false);
    }
  };

  const totalBytes = items.reduce((acc, i) => acc + i.size, 0);
  const drives = places.filter((p) => p.kind === "drive");

  return (
    <ModalDialog
      open={open}
      onClose={onClose}
      title="Disk Space Analyzer"
      subtitle={
        hasScanned
          ? `${targetDir} — Total: ${fmtBytes(totalBytes)}`
          : "Choose a folder or drive to analyze disk usage"
      }
    >
      <div className="space-y-4">
        {/* Target Folder Picker */}
        <div
          className="rounded-xl border p-3 space-y-2.5"
          style={{ background: "var(--surface-alt)", borderColor: "var(--border)" }}
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs font-semibold flex items-center gap-1.5">
              <FolderOpen size={14} style={{ color: "var(--accent)" }} />
              Target Folder
            </span>
            <button
              type="button"
              disabled={loading}
              onClick={pickFolder}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-semibold cursor-pointer disabled:opacity-40"
              style={{ background: "var(--surface)", color: "var(--text)" }}
            >
              <FolderOpen size={12} /> Choose Folder…
            </button>
          </div>

          <div
            className="px-2.5 py-1.5 rounded-lg text-xs font-mono truncate"
            style={{ background: "var(--surface)" }}
            title={targetDir}
          >
            {targetDir || "No folder selected"}
          </div>

          {drives.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[10px] uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>
                Drives:
              </span>
              {drives.map((d) => (
                <button
                  key={d.path}
                  type="button"
                  disabled={loading}
                  onClick={() => {
                    setTargetDir(d.path);
                    setHasScanned(false);
                  }}
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] cursor-pointer disabled:opacity-40"
                  style={{
                    background: targetDir === d.path ? "var(--accent)" : "var(--surface)",
                    color: targetDir === d.path ? "var(--accent-text)" : "var(--text)",
                  }}
                >
                  <HardDrive size={11} /> {d.name}
                </button>
              ))}
            </div>
          )}

          <div className="flex items-center justify-end gap-2 pt-1">
            {hasScanned && !loading ? (
              <button
                type="button"
                disabled={!targetDir}
                onClick={() => startScan()}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium cursor-pointer disabled:opacity-40"
                style={{ background: "var(--surface)" }}
              >
                <RotateCcw size={13} /> Rescan
              </button>
            ) : (
              <button
                type="button"
                disabled={!targetDir || loading}
                onClick={() => startScan()}
                className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-semibold cursor-pointer disabled:opacity-40"
                style={{ background: "var(--accent)", color: "var(--accent-text)" }}
              >
                {loading ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />}
                {loading ? "Scanning…" : "Start Scan"}
              </button>
            )}
          </div>
        </div>

        {/* Results */}
        {loading ? (
          <div
            className="py-10 flex items-center justify-center gap-2 text-sm"
            style={{ color: "var(--text-muted)" }}
          >
            <Loader2 size={18} className="animate-spin" /> Scanning folder sizes...
          </div>
        ) : !hasScanned ? (
          <div className="py-6 text-center text-xs" style={{ color: "var(--text-muted)" }}>
            Select a folder or drive above and click <strong>Start Scan</strong>.
          </div>
        ) : items.length === 0 ? (
          <div className="py-8 text-center text-xs" style={{ color: "var(--text-muted)" }}>
            This folder is empty or could not be read.
          </div>
        ) : (
          <div className="space-y-2 max-h-[46vh] overflow-y-auto nkf-scroll pr-1">
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
      </div>
    </ModalDialog>
  );
};
