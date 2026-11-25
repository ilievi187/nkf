import React, { useEffect } from "react";
import {
  ExternalLink,
  Eye,
  Copy,
  Scissors,
  ClipboardPaste,
  Pencil,
  Sparkles,
  Archive,
  FolderOutput,
  Info,
  Terminal,
  Trash2,
  Link2,
  FileDiff,
} from "lucide-react";
import type { FileEntry } from "../lib/api";

export interface ContextMenuState {
  x: number;
  y: number;
  entry: FileEntry | null;
}

interface ContextMenuProps {
  menu: ContextMenuState | null;
  selectedCount: number;
  canDiff: boolean;
  hasClipboard: boolean;
  onClose: () => void;
  onOpen: (entry: FileEntry) => void;
  onQuickLook: (entry: FileEntry) => void;
  onDiff: () => void;
  onCopy: () => void;
  onCut: () => void;
  onPaste: () => void;
  onCopyPath: (path: string) => void;
  onRename: () => void;
  onBatchRename: () => void;
  onZip: () => void;
  onExtractZip: () => void;
  onProperties: (path: string) => void;
  onTerminal: () => void;
  onDelete: () => void;
}

export const ContextMenu: React.FC<ContextMenuProps> = ({
  menu,
  selectedCount,
  canDiff,
  hasClipboard,
  onClose,
  onOpen,
  onQuickLook,
  onDiff,
  onCopy,
  onCut,
  onPaste,
  onCopyPath,
  onRename,
  onBatchRename,
  onZip,
  onExtractZip,
  onProperties,
  onTerminal,
  onDelete,
}) => {
  useEffect(() => {
    if (!menu) return;
    const close = () => onClose();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("click", close);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [menu, onClose]);

  if (!menu) return null;

  const left = Math.min(menu.x, window.innerWidth - 220);
  const top = Math.min(menu.y, window.innerHeight - 340);
  const e = menu.entry;

  const itemBtn = (
    label: string,
    icon: React.ReactNode,
    onClick: () => void,
    danger = false
  ) => (
    <button
      type="button"
      onClick={() => {
        onClick();
        onClose();
      }}
      className={`w-full flex items-center gap-2.5 px-3 py-1.5 rounded-lg text-xs text-left cursor-pointer hover:bg-white/10 ${
        danger ? "text-red-400" : ""
      }`}
    >
      {icon}
      <span>{label}</span>
    </button>
  );

  return (
    <div
      className="fixed z-50 w-52 rounded-xl border shadow-2xl p-1.5 space-y-0.5"
      style={{
        left: Math.max(8, left),
        top: Math.max(8, top),
        background: "var(--surface)",
        borderColor: "var(--border)",
        color: "var(--text)",
      }}
      onClick={(ev) => ev.stopPropagation()}
    >
      {e && (
        <>
          {itemBtn("Open", <ExternalLink size={14} />, () => onOpen(e))}
          {itemBtn("Quick Look (Space)", <Eye size={14} />, () => onQuickLook(e))}
          {canDiff && itemBtn("Diff / Dual Edit (2 files)", <FileDiff size={14} />, onDiff)}
          <div className="my-1 border-t" style={{ borderColor: "var(--border)" }} />
          {itemBtn("Copy", <Copy size={14} />, onCopy)}
          {itemBtn("Cut", <Scissors size={14} />, onCut)}
          {hasClipboard && itemBtn("Paste", <ClipboardPaste size={14} />, onPaste)}
          {itemBtn("Copy Full Path", <Link2 size={14} />, () => onCopyPath(e.path))}
          <div className="my-1 border-t" style={{ borderColor: "var(--border)" }} />
          {selectedCount > 1
            ? itemBtn("Batch Rename...", <Sparkles size={14} />, onBatchRename)
            : itemBtn("Rename (F2)", <Pencil size={14} />, onRename)}
          {itemBtn("Compress to ZIP", <Archive size={14} />, onZip)}
          {e.extension === "zip" && itemBtn("Extract ZIP Here", <FolderOutput size={14} />, onExtractZip)}
          <div className="my-1 border-t" style={{ borderColor: "var(--border)" }} />
          {itemBtn("Properties & SHA-256", <Info size={14} />, () => onProperties(e.path))}
          {itemBtn("Move to Trash", <Trash2 size={14} />, onDelete, true)}
        </>
      )}

      {!e && (
        <>
          {hasClipboard && itemBtn("Paste Here", <ClipboardPaste size={14} />, onPaste)}
          {itemBtn("Open Terminal Here", <Terminal size={14} />, onTerminal)}
        </>
      )}
    </div>
  );
};
