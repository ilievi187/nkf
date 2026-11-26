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
  FolderPlus,
  FilePlus,
  RefreshCw,
  CheckSquare,
  AppWindow,
  FolderSearch,
  SlidersHorizontal,
  Star,
} from "lucide-react";
import type { FileEntry } from "../lib/api";

export interface ContextMenuState {
  x: number;
  y: number;
  entry: FileEntry | null;
}

interface ContextMenuProps {
  menu: ContextMenuState | null;
  platform: string;
  selectedCount: number;
  canDiff: boolean;
  hasClipboard: boolean;
  onClose: () => void;
  onOpen: (entry: FileEntry) => void;
  onOpenWith: (entry: FileEntry) => void;
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
  onSystemProperties: (path: string) => void;
  onRevealInSystem: (path: string) => void;
  onPinBookmark: (path: string) => void;
  onNewFolder: () => void;
  onNewFile: () => void;
  onSelectAll: () => void;
  onRefresh: () => void;
  onIntegratedTerminal: () => void;
  onExternalTerminal: () => void;
  onDelete: () => void;
}

export const ContextMenu: React.FC<ContextMenuProps> = ({
  menu,
  platform,
  selectedCount,
  canDiff,
  hasClipboard,
  onClose,
  onOpen,
  onOpenWith,
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
  onSystemProperties,
  onRevealInSystem,
  onPinBookmark,
  onNewFolder,
  onNewFile,
  onSelectAll,
  onRefresh,
  onIntegratedTerminal,
  onExternalTerminal,
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

  const e = menu.entry;
  const estHeight = e ? 470 : 320;
  const left = Math.min(menu.x, window.innerWidth - 250);
  const top = Math.min(menu.y, Math.max(8, window.innerHeight - estHeight));

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
      <span className="truncate">{label}</span>
    </button>
  );

  return (
    <div
      className="fixed z-50 w-60 max-h-[85vh] overflow-y-auto nkf-scroll rounded-xl border shadow-2xl p-1.5 space-y-0.5"
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
          {!e.is_dir && itemBtn("Open With…", <AppWindow size={14} />, () => onOpenWith(e))}
          {itemBtn("Quick Look (Space)", <Eye size={14} />, () => onQuickLook(e))}
          {canDiff && itemBtn("Diff / Dual Edit (2 files)", <FileDiff size={14} />, onDiff)}
          <div className="my-1 border-t" style={{ borderColor: "var(--border)" }} />
          {itemBtn("Copy (Ctrl+C)", <Copy size={14} />, onCopy)}
          {itemBtn("Cut (Ctrl+X)", <Scissors size={14} />, onCut)}
          {hasClipboard && itemBtn("Paste (Ctrl+V)", <ClipboardPaste size={14} />, onPaste)}
          {itemBtn("Copy Full Path", <Link2 size={14} />, () => onCopyPath(e.path))}
          <div className="my-1 border-t" style={{ borderColor: "var(--border)" }} />
          {selectedCount > 1
            ? itemBtn("Batch Rename…", <Sparkles size={14} />, onBatchRename)
            : itemBtn("Rename (F2)", <Pencil size={14} />, onRename)}
          {itemBtn("Compress to ZIP", <Archive size={14} />, onZip)}
          {e.extension === "zip" && itemBtn("Extract ZIP Here", <FolderOutput size={14} />, onExtractZip)}
          {e.is_dir && itemBtn("Pin Folder to Sidebar", <Star size={14} />, () => onPinBookmark(e.path))}
          <div className="my-1 border-t" style={{ borderColor: "var(--border)" }} />
          {itemBtn(
            platform === "windows" ? "Show in Windows Explorer" : "Reveal in System Manager",
            <FolderSearch size={14} />,
            () => onRevealInSystem(e.path)
          )}
          {platform === "windows" &&
            itemBtn("Windows Properties…", <SlidersHorizontal size={14} />, () =>
              onSystemProperties(e.path)
            )}
          {itemBtn("NKF Properties & SHA-256", <Info size={14} />, () => onProperties(e.path))}
          {itemBtn("Move to Trash (Del)", <Trash2 size={14} />, onDelete, true)}
        </>
      )}

      {!e && (
        <>
          {hasClipboard && itemBtn("Paste Here (Ctrl+V)", <ClipboardPaste size={14} />, onPaste)}
          {itemBtn("New Folder", <FolderPlus size={14} />, onNewFolder)}
          {itemBtn("New File", <FilePlus size={14} />, onNewFile)}
          <div className="my-1 border-t" style={{ borderColor: "var(--border)" }} />
          {itemBtn("Select All (Ctrl+A)", <CheckSquare size={14} />, onSelectAll)}
          {itemBtn("Refresh (F5)", <RefreshCw size={14} />, onRefresh)}
          <div className="my-1 border-t" style={{ borderColor: "var(--border)" }} />
          {itemBtn("Toggle Integrated Terminal (F4)", <Terminal size={14} />, onIntegratedTerminal)}
          {itemBtn("Open External Terminal", <ExternalLink size={14} />, onExternalTerminal)}
        </>
      )}
    </div>
  );
};
