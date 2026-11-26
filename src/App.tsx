import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import {
  Home,
  Monitor,
  FileText,
  Download,
  Image as ImageIcon,
  Music,
  Film,
  HardDrive,
  Columns2,
  Eye,
  EyeOff,
  FolderPlus,
  FilePlus,
  Copy,
  Scissors,
  ClipboardPaste,
  Trash2,
  Pencil,
  Archive,
  FolderOutput,
  Terminal,
  PieChart,
  Star,
  Plus,
  X,
  Palette,
  Check,
  Coffee,
  ArrowRightLeft,
  Sparkles,
  Network,
  RefreshCw,
  CopyCheck,
  Command,
  GitCompareArrows,
  Clock,
  FileDiff,
  User,
} from "lucide-react";
import { BUILTIN_THEMES, applyThemeToRoot, type ThemeDefinition } from "./lib/themes";
import {
  fmtBytes,
  getParentPath,
  nkfApi,
  type FileEntry,
  type NetworkShareItem,
  type PlaceItem,
  type TransferProgress,
} from "./lib/api";
import { FilePane, type IconSet, type ViewMode } from "./components/FilePane";
import { QuickLookModal } from "./components/QuickLookModal";
import { BatchRenameModal } from "./components/BatchRenameModal";
import { DiskUsageModal } from "./components/DiskUsageModal";
import { NetworkShareModal } from "./components/NetworkShareModal";
import { DuplicatesModal } from "./components/DuplicatesModal";
import { PropertiesModal } from "./components/PropertiesModal";
import { ContextMenu, type ContextMenuState } from "./components/ContextMenu";
import { CommandPalette, type PaletteCommand } from "./components/CommandPalette";
import { FolderCompareModal } from "./components/FolderCompareModal";
import { DiffEditorModal } from "./components/DiffEditorModal";

interface TabState {
  id: string;
  path: string;
  history: string[];
  historyIdx: number;
}

interface ClipboardState {
  mode: "copy" | "cut";
  paths: string[];
}

const BOOKMARKS_KEY = "nkf_bookmarks";
const SAVED_SHARES_KEY = "nkf_saved_shares";
const RECENT_DIRS_KEY = "nkf_recent_dirs";

function placeIcon(kind: string) {
  switch (kind) {
    case "home":
      return <Home size={15} />;
    case "desktop":
      return <Monitor size={15} />;
    case "documents":
      return <FileText size={15} />;
    case "downloads":
      return <Download size={15} />;
    case "pictures":
      return <ImageIcon size={15} />;
    case "music":
      return <Music size={15} />;
    case "videos":
      return <Film size={15} />;
    default:
      return <HardDrive size={15} />;
  }
}

function baseName(p: string): string {
  if (!p || p === "/") return "/";
  const clean = p.endsWith("/") || p.endsWith("\\") ? p.slice(0, -1) : p;
  const parts = clean.split(/[/\\]/);
  return parts[parts.length - 1] || p;
}

export default function App() {
  // Themes & Icon Sets (default: Auto Adaptive)
  const [omarchyTheme, setOmarchyTheme] = useState<ThemeDefinition | null>(null);
  const [themeId, setThemeId] = useState<string>(
    () => localStorage.getItem("nkf_theme") || "auto"
  );
  const [iconSet, setIconSet] = useState<IconSet>(
    () => (localStorage.getItem("nkf_icon_set") as IconSet) || "native"
  );
  const [systemDark, setSystemDark] = useState<boolean>(() =>
    window.matchMedia("(prefers-color-scheme: dark)").matches
  );
  const [showThemeMenu, setShowThemeMenu] = useState(false);
  const [isDefaultFm, setIsDefaultFm] = useState(false);

  // Places, Network Shares & Bookmarks
  const [platform, setPlatform] = useState<string>("linux");
  const [username, setUsername] = useState<string>("");
  const [places, setPlaces] = useState<PlaceItem[]>([]);
  const [networkShares, setNetworkShares] = useState<NetworkShareItem[]>([]);
  const [savedShares, setSavedShares] = useState<NetworkShareItem[]>(() => {
    try {
      return JSON.parse(localStorage.getItem(SAVED_SHARES_KEY) || "[]");
    } catch {
      return [];
    }
  });
  const [bookmarks, setBookmarks] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem(BOOKMARKS_KEY) || "[]");
    } catch {
      return [];
    }
  });
  const [recentDirs, setRecentDirs] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem(RECENT_DIRS_KEY) || "[]");
    } catch {
      return [];
    }
  });

  // Tabs (left pane) + Split View (right pane)
  const [tabs, setTabs] = useState<TabState[]>([]);
  const [activeTabId, setActiveTabId] = useState<string>("");
  const [splitMode, setSplitMode] = useState(false);
  const [rightPane, setRightPane] = useState<TabState>({
    id: "right",
    path: "",
    history: [],
    historyIdx: 0,
  });
  const [activePane, setActivePane] = useState<"left" | "right">("left");

  // View options (independent per split pane)
  const [showHidden, setShowHidden] = useState(false);
  const [leftViewMode, setLeftViewMode] = useState<ViewMode>("list");
  const [rightViewMode, setRightViewMode] = useState<ViewMode>("list");
  const [leftRefreshTick, setLeftRefreshTick] = useState(0);
  const [rightRefreshTick, setRightRefreshTick] = useState(0);

  // Selection & Clipboard
  const [leftSel, setLeftSel] = useState<Set<string>>(new Set());
  const [rightSel, setRightSel] = useState<Set<string>>(new Set());
  const [leftEntries, setLeftEntries] = useState<FileEntry[]>([]);
  const [rightEntries, setRightEntries] = useState<FileEntry[]>([]);
  const [clipboard, setClipboard] = useState<ClipboardState | null>(null);

  // Modals & Context Menu
  const [quickLookEntry, setQuickLookEntry] = useState<FileEntry | null>(null);
  const [batchRenameOpen, setBatchRenameOpen] = useState(false);
  const [diskUsageOpen, setDiskUsageOpen] = useState(false);
  const [networkModalOpen, setNetworkModalOpen] = useState(false);
  const [duplicatesOpen, setDuplicatesOpen] = useState(false);
  const [propertiesPath, setPropertiesPath] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [compareOpen, setCompareOpen] = useState(false);
  const [diffPair, setDiffPair] = useState<[string, string] | null>(null);
  const [transfer, setTransfer] = useState<TransferProgress | null>(null);

  // Toast
  const [toast, setToast] = useState<{ msg: string; isError?: boolean } | null>(null);
  const toastTimer = useRef<number | null>(null);

  const showToast = useCallback((msg: string, isError = false) => {
    setToast({ msg, isError });
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 3200);
  }, []);

  const allThemes = useMemo(
    () => (omarchyTheme ? [omarchyTheme, ...BUILTIN_THEMES] : BUILTIN_THEMES),
    [omarchyTheme]
  );

  const refreshNetworkShares = useCallback(() => {
    nkfApi.getNetworkShares().then(setNetworkShares).catch(() => {});
  }, []);

  // Boot: initial dir, places, network shares, Omarchy theme
  useEffect(() => {
    nkfApi.getPlatform().then(setPlatform).catch(() => {});
    nkfApi.getUsername().then(setUsername).catch(() => {});
    nkfApi.getSystemPlaces().then(setPlaces).catch(() => {});
    nkfApi.getDefaultFileManagerStatus().then(setIsDefaultFm).catch(() => {});
    refreshNetworkShares();
    nkfApi.getOmarchyTheme().then((t) => {
      if (t) setOmarchyTheme(t);
    });
    nkfApi.getInitialDir().then((dir) => {
      const id = crypto.randomUUID();
      setTabs([{ id, path: dir, history: [dir], historyIdx: 0 }]);
      setActiveTabId(id);
      setRightPane({ id: "right", path: dir, history: [dir], historyIdx: 0 });
    });
  }, []);

  // Listen to OS dark/light mode changes for Adaptive Auto theme
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = (e: MediaQueryListEvent) => setSystemDark(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  // Apply theme (Auto adapts to Omarchy on Linux or OS Dark/Light on Windows/macOS)
  useEffect(() => {
    let resolved: ThemeDefinition;
    if (themeId === "auto") {
      if (omarchyTheme) {
        resolved = omarchyTheme;
      } else {
        resolved =
          BUILTIN_THEMES.find((t) => t.id === (systemDark ? "nightknight" : "paper")) ||
          BUILTIN_THEMES[0];
      }
    } else {
      resolved = allThemes.find((t) => t.id === themeId) || BUILTIN_THEMES[0];
    }
    applyThemeToRoot(resolved);
    localStorage.setItem("nkf_theme", themeId);
  }, [themeId, allThemes, omarchyTheme, systemDark]);

  useEffect(() => {
    localStorage.setItem("nkf_icon_set", iconSet);
  }, [iconSet]);

  // Listen for streaming copy/move transfer progress + auto-refresh on window focus
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    listen<TransferProgress>("nkf://transfer-progress", (ev) => {
      if (ev.payload.done) setTransfer(null);
      else setTransfer(ev.payload);
    })
      .then((fn) => {
        unlisten = fn;
      })
      .catch(() => {});

    const onFocus = () => {
      setLeftRefreshTick((t) => t + 1);
      setRightRefreshTick((t) => t + 1);
      nkfApi.getOmarchyTheme().then((t) => {
        if (t) setOmarchyTheme(t);
      });
    };
    window.addEventListener("focus", onFocus);
    return () => {
      unlisten?.();
      window.removeEventListener("focus", onFocus);
    };
  }, []);

  const activeLeftTab = tabs.find((t) => t.id === activeTabId) || tabs[0];
  const currentDir = activePane === "left" ? activeLeftTab?.path || "" : rightPane.path;
  const otherDir = activePane === "left" ? rightPane.path : activeLeftTab?.path || "";
  const activeSel = activePane === "left" ? leftSel : rightSel;
  const activeEntries = activePane === "left" ? leftEntries : rightEntries;
  const selectedEntries = useMemo(
    () => activeEntries.filter((e) => activeSel.has(e.path)),
    [activeEntries, activeSel]
  );

  // Detect 2 selected files for Side-by-Side Diff & Live Editor (either 2 in active pane, or 1 left + 1 right)
  const diffCandidates = useMemo<[string, string] | null>(() => {
    const activeFiles = selectedEntries.filter((e) => !e.is_dir);
    if (activeFiles.length === 2) {
      return [activeFiles[0].path, activeFiles[1].path];
    }
    if (splitMode) {
      const lf = leftEntries.find((e) => !e.is_dir && leftSel.has(e.path));
      const rf = rightEntries.find((e) => !e.is_dir && rightSel.has(e.path));
      if (lf && rf) return [lf.path, rf.path];
    }
    return null;
  }, [selectedEntries, splitMode, leftEntries, rightEntries, leftSel, rightSel]);

  const triggerRefresh = useCallback(() => {
    setLeftRefreshTick((t) => t + 1);
    setRightRefreshTick((t) => t + 1);
  }, []);

  // Navigation helpers
  const navigatePane = useCallback(
    (pane: "left" | "right", targetPath: string) => {
      if (targetPath) {
        setRecentDirs((prev) => {
          const next = [targetPath, ...prev.filter((d) => d !== targetPath)].slice(0, 8);
          localStorage.setItem(RECENT_DIRS_KEY, JSON.stringify(next));
          return next;
        });
      }
      if (pane === "left") {
        setLeftSel(new Set());
        setTabs((prev) =>
          prev.map((t) => {
            if (t.id !== activeTabId) return t;
            if (t.path === targetPath) return t;
            const sliced = t.history.slice(0, t.historyIdx + 1);
            return {
              ...t,
              path: targetPath,
              history: [...sliced, targetPath],
              historyIdx: sliced.length,
            };
          })
        );
      } else {
        setRightSel(new Set());
        setRightPane((prev) => {
          if (prev.path === targetPath) return prev;
          const sliced = prev.history.slice(0, prev.historyIdx + 1);
          return {
            ...prev,
            path: targetPath,
            history: [...sliced, targetPath],
            historyIdx: sliced.length,
          };
        });
      }
    },
    [activeTabId]
  );

  const stepHistory = (pane: "left" | "right", delta: -1 | 1) => {
    if (pane === "left") {
      setTabs((prev) =>
        prev.map((t) => {
          if (t.id !== activeTabId) return t;
          const nextIdx = t.historyIdx + delta;
          if (nextIdx < 0 || nextIdx >= t.history.length) return t;
          return { ...t, historyIdx: nextIdx, path: t.history[nextIdx] };
        })
      );
    } else {
      setRightPane((prev) => {
        const nextIdx = prev.historyIdx + delta;
        if (nextIdx < 0 || nextIdx >= prev.history.length) return prev;
        return { ...prev, historyIdx: nextIdx, path: prev.history[nextIdx] };
      });
    }
  };

  const addTab = (dir?: string) => {
    const start = dir || currentDir || "/";
    const id = crypto.randomUUID();
    setTabs((prev) => [...prev, { id, path: start, history: [start], historyIdx: 0 }]);
    setActiveTabId(id);
    setActivePane("left");
  };

  const closeTab = (id: string) => {
    if (tabs.length <= 1) return;
    setTabs((prev) => {
      const next = prev.filter((t) => t.id !== id);
      if (activeTabId === id && next[0]) setActiveTabId(next[0].id);
      return next;
    });
  };

  // File Operations
  const handleNewFolder = async () => {
    const name = window.prompt("New folder name:");
    if (!name?.trim() || !currentDir) return;
    try {
      await nkfApi.createFolder(currentDir, name);
      triggerRefresh();
      showToast(`Created folder "${name}"`);
    } catch (e) {
      showToast(String(e), true);
    }
  };

  const handleNewFile = async () => {
    const name = window.prompt("New file name (e.g. notes.md):");
    if (!name?.trim() || !currentDir) return;
    try {
      await nkfApi.createFile(currentDir, name);
      triggerRefresh();
      showToast(`Created file "${name}"`);
    } catch (e) {
      showToast(String(e), true);
    }
  };

  const handleRename = async () => {
    if (selectedEntries.length === 0) return;
    if (selectedEntries.length > 1) {
      setBatchRenameOpen(true);
      return;
    }
    const target = selectedEntries[0];
    const nextName = window.prompt("Rename to:", target.name);
    if (!nextName?.trim() || nextName === target.name) return;
    try {
      await nkfApi.renameItem(target.path, nextName);
      triggerRefresh();
      showToast(`Renamed to "${nextName}"`);
    } catch (e) {
      showToast(String(e), true);
    }
  };

  const handleCopy = () => {
    if (activeSel.size === 0) return;
    setClipboard({ mode: "copy", paths: Array.from(activeSel) });
    showToast(`Copied ${activeSel.size} item(s)`);
  };

  const handleCut = () => {
    if (activeSel.size === 0) return;
    setClipboard({ mode: "cut", paths: Array.from(activeSel) });
    showToast(`Cut ${activeSel.size} item(s)`);
  };

  const handlePaste = async () => {
    if (!clipboard || !currentDir) return;
    try {
      const count =
        clipboard.mode === "copy"
          ? await nkfApi.copyItems(clipboard.paths, currentDir)
          : await nkfApi.moveItems(clipboard.paths, currentDir);
      if (clipboard.mode === "cut") setClipboard(null);
      triggerRefresh();
      showToast(`${clipboard.mode === "copy" ? "Copied" : "Moved"} ${count} item(s)`);
    } catch (e) {
      showToast(String(e), true);
    }
  };

  const handleTransferToOtherPane = async (move: boolean) => {
    if (!splitMode || activeSel.size === 0 || !otherDir) return;
    try {
      const paths = Array.from(activeSel);
      const count = move
        ? await nkfApi.moveItems(paths, otherDir)
        : await nkfApi.copyItems(paths, otherDir);
      triggerRefresh();
      showToast(`${move ? "Moved" : "Copied"} ${count} item(s) → ${baseName(otherDir)}`);
    } catch (e) {
      showToast(String(e), true);
    }
  };

  const handleDelete = async (permanent = false) => {
    if (activeSel.size === 0) return;
    if (
      permanent &&
      !window.confirm(`Permanently delete ${activeSel.size} item(s)? This cannot be undone.`)
    ) {
      return;
    }
    try {
      const count = await nkfApi.deleteItems(Array.from(activeSel), permanent);
      if (activePane === "left") setLeftSel(new Set());
      else setRightSel(new Set());
      triggerRefresh();
      showToast(permanent ? `Permanently deleted ${count} item(s)` : `Moved ${count} item(s) to Trash`);
    } catch (e) {
      showToast(String(e), true);
    }
  };

  const handleZip = async () => {
    if (activeSel.size === 0 || !currentDir) return;
    const defaultName =
      selectedEntries.length === 1 ? `${selectedEntries[0].name}.zip` : "archive.zip";
    const zipName = window.prompt("Archive name:", defaultName);
    if (!zipName?.trim()) return;
    const sep = currentDir.includes("\\") ? "\\" : "/";
    const destZip = `${currentDir.replace(/[/\\]$/, "")}${sep}${
      zipName.endsWith(".zip") ? zipName : `${zipName}.zip`
    }`;
    try {
      await nkfApi.compressToZip(Array.from(activeSel), destZip);
      triggerRefresh();
      showToast(`Created ${baseName(destZip)}`);
    } catch (e) {
      showToast(String(e), true);
    }
  };

  const handleExtractZip = async () => {
    const zipItem = selectedEntries.find((e) => e.extension === "zip");
    if (!zipItem || !currentDir) return;
    const sep = currentDir.includes("\\") ? "\\" : "/";
    const folderName = zipItem.name.replace(/\.zip$/i, "");
    const dest = `${currentDir.replace(/[/\\]$/, "")}${sep}${folderName}`;
    try {
      const count = await nkfApi.extractZip(zipItem.path, dest);
      triggerRefresh();
      showToast(`Extracted ${count} files to "${folderName}"`);
    } catch (e) {
      showToast(String(e), true);
    }
  };

  const handleDropPaths = async (sources: string[], destDir: string, isCopy: boolean) => {
    try {
      const count = isCopy
        ? await nkfApi.copyItems(sources, destDir)
        : await nkfApi.moveItems(sources, destDir);
      triggerRefresh();
      showToast(`${isCopy ? "Copied" : "Moved"} ${count} item(s) → ${baseName(destDir)}`);
    } catch (e) {
      showToast(String(e), true);
    }
  };

  const toggleBookmark = () => {
    if (!currentDir) return;
    const next = bookmarks.includes(currentDir)
      ? bookmarks.filter((b) => b !== currentDir)
      : [...bookmarks, currentDir];
    setBookmarks(next);
    localStorage.setItem(BOOKMARKS_KEY, JSON.stringify(next));
    showToast(bookmarks.includes(currentDir) ? "Removed bookmark" : `Bookmarked ${baseName(currentDir)}`);
  };

  // Global keyboard shortcuts (Dolphin / Finder conventions)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (document.activeElement?.tagName || "").toUpperCase();
      const inInput = tag === "INPUT" || tag === "TEXTAREA";

      if (e.key === "F3") {
        e.preventDefault();
        setSplitMode((v) => {
          if (!v && activeLeftTab) {
            setRightPane({
              id: "right",
              path: activeLeftTab.path,
              history: [activeLeftTab.path],
              historyIdx: 0,
            });
          }
          return !v;
        });
      } else if (e.key === "F4" && currentDir) {
        e.preventDefault();
        nkfApi.openTerminalHere(currentDir).catch((err) => showToast(String(err), true));
      } else if (e.key === "F5") {
        e.preventDefault();
        triggerRefresh();
      } else if (e.key === "F2" && !inInput) {
        e.preventDefault();
        handleRename();
      } else if (e.key === " " && !inInput && selectedEntries.length > 0 && !quickLookEntry) {
        e.preventDefault();
        setQuickLookEntry(selectedEntries[0]);
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "h") {
        e.preventDefault();
        setShowHidden((v) => !v);
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "t") {
        e.preventDefault();
        addTab();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "c" && !inInput) {
        handleCopy();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "x" && !inInput) {
        handleCut();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "v" && !inInput) {
        handlePaste();
      } else if (e.key === "Delete" && !inInput && activeSel.size > 0) {
        e.preventDefault();
        handleDelete(e.shiftKey);
      } else if (e.key === "Backspace" && !inInput && currentDir && !paletteOpen && !quickLookEntry) {
        e.preventDefault();
        navigatePane(activePane, getParentPath(currentDir));
      } else if (
        (e.key === "ArrowDown" || e.key === "ArrowUp") &&
        !inInput &&
        !paletteOpen &&
        !quickLookEntry &&
        activeEntries.length > 0
      ) {
        e.preventDefault();
        const curPath = Array.from(activeSel)[0];
        const curIdx = activeEntries.findIndex((item) => item.path === curPath);
        const delta = e.key === "ArrowDown" ? 1 : -1;
        const nextIdx =
          curIdx < 0
            ? 0
            : Math.max(0, Math.min(activeEntries.length - 1, curIdx + delta));
        const nextSet = new Set([activeEntries[nextIdx].path]);
        if (activePane === "left") setLeftSel(nextSet);
        else setRightSel(nextSet);
      } else if (
        e.key === "Enter" &&
        !inInput &&
        !paletteOpen &&
        !quickLookEntry &&
        selectedEntries.length === 1
      ) {
        e.preventDefault();
        const item = selectedEntries[0];
        if (item.is_dir) navigatePane(activePane, item.path);
        else nkfApi.openWithDefault(item.path).catch((err) => showToast(String(err), true));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const hasSelectedZip = selectedEntries.some((e) => e.extension === "zip");

  return (
    <div className="h-full flex flex-col" style={{ background: "var(--bg)", color: "var(--text)" }}>
      {/* TOP BAR */}
      <header
        className="h-12 px-3 border-b flex items-center justify-between gap-2 shrink-0"
        style={{ background: "var(--surface)", borderColor: "var(--border)" }}
      >
        <div className="flex items-center gap-2.5 shrink-0">
          <div
            className="w-7 h-7 rounded-lg flex items-center justify-center font-bold text-xs shadow-sm"
            style={{ background: "var(--accent)", color: "var(--accent-text)" }}
          >
            NK
          </div>
          <span className="font-bold text-sm tracking-tight">NKF</span>
          {username && (
            <span
              className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full hidden md:inline-flex"
              style={{ background: "var(--surface-alt)", color: "var(--text-muted)" }}
              title={`Signed in as ${username}`}
            >
              <User size={11} /> {username}
            </span>
          )}
        </div>

        {/* Center Dolphin-style Action Bar */}
        <div className="flex items-center gap-1 overflow-x-auto nkf-scroll">
          <button
            type="button"
            onClick={() => {
              setSplitMode((v) => {
                if (!v && activeLeftTab) {
                  setRightPane({
                    id: "right",
                    path: activeLeftTab.path,
                    history: [activeLeftTab.path],
                    historyIdx: 0,
                  });
                }
                return !v;
              });
            }}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium cursor-pointer shrink-0"
            style={{
              background: splitMode ? "var(--accent)" : "var(--surface-alt)",
              color: splitMode ? "var(--accent-text)" : "var(--text)",
            }}
            title="Toggle Dual-Pane Split View (F3)"
          >
            <Columns2 size={14} /> <span className="hidden sm:inline">Split</span>
          </button>

          <button
            type="button"
            onClick={handleNewFolder}
            className="p-1.5 rounded-lg cursor-pointer"
            style={{ background: "var(--surface-alt)" }}
            title="New Folder"
          >
            <FolderPlus size={15} />
          </button>
          <button
            type="button"
            onClick={handleNewFile}
            className="p-1.5 rounded-lg cursor-pointer"
            style={{ background: "var(--surface-alt)" }}
            title="New File"
          >
            <FilePlus size={15} />
          </button>

          <div className="w-px h-5 mx-0.5" style={{ background: "var(--border)" }} />

          <button
            type="button"
            disabled={activeSel.size === 0}
            onClick={handleCopy}
            className="p-1.5 rounded-lg disabled:opacity-35 cursor-pointer"
            style={{ background: "var(--surface-alt)" }}
            title="Copy (Ctrl+C)"
          >
            <Copy size={15} />
          </button>
          <button
            type="button"
            disabled={activeSel.size === 0}
            onClick={handleCut}
            className="p-1.5 rounded-lg disabled:opacity-35 cursor-pointer"
            style={{ background: "var(--surface-alt)" }}
            title="Cut (Ctrl+X)"
          >
            <Scissors size={15} />
          </button>
          <button
            type="button"
            disabled={!clipboard}
            onClick={handlePaste}
            className="p-1.5 rounded-lg disabled:opacity-35 cursor-pointer"
            style={{ background: "var(--surface-alt)" }}
            title="Paste (Ctrl+V)"
          >
            <ClipboardPaste size={15} />
          </button>

          {diffCandidates && (
            <button
              type="button"
              onClick={() => setDiffPair(diffCandidates)}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold cursor-pointer shrink-0"
              style={{ background: "var(--accent)", color: "var(--accent-text)" }}
              title="Open 2 selected files in Side-by-Side Diff & Live Editor"
            >
              <FileDiff size={13} /> Diff / Edit
            </button>
          )}

          {splitMode && (
            <button
              type="button"
              onClick={() => setCompareOpen(true)}
              className="inline-flex items-center gap-1 px-2 py-1.5 rounded-lg text-xs font-medium cursor-pointer shrink-0"
              style={{ background: "var(--surface-alt)" }}
              title="Compare & Sync Left and Right folders"
            >
              <GitCompareArrows size={13} style={{ color: "var(--accent)" }} /> Compare
            </button>
          )}

          {splitMode && activeSel.size > 0 && (
            <button
              type="button"
              onClick={() => handleTransferToOtherPane(false)}
              className="inline-flex items-center gap-1 px-2 py-1.5 rounded-lg text-xs font-medium cursor-pointer shrink-0"
              style={{ background: "var(--accent)", color: "var(--accent-text)" }}
              title="Copy selected items to the other pane"
            >
              <ArrowRightLeft size={13} /> To Other Pane
            </button>
          )}

          <button
            type="button"
            disabled={activeSel.size === 0}
            onClick={handleRename}
            className="p-1.5 rounded-lg disabled:opacity-35 cursor-pointer"
            style={{ background: "var(--surface-alt)" }}
            title={activeSel.size > 1 ? "Smart Batch Rename" : "Rename (F2)"}
          >
            <Pencil size={15} />
          </button>

          {activeSel.size > 1 && (
            <button
              type="button"
              onClick={() => setBatchRenameOpen(true)}
              className="inline-flex items-center gap-1 px-2 py-1.5 rounded-lg text-xs font-medium cursor-pointer shrink-0"
              style={{ background: "var(--surface-alt)" }}
              title="Smart Batch Rename"
            >
              <Sparkles size={13} style={{ color: "var(--accent)" }} /> Batch Rename
            </button>
          )}

          <button
            type="button"
            disabled={activeSel.size === 0}
            onClick={handleZip}
            className="p-1.5 rounded-lg disabled:opacity-35 cursor-pointer"
            style={{ background: "var(--surface-alt)" }}
            title="Compress selected to ZIP"
          >
            <Archive size={15} />
          </button>

          {hasSelectedZip && (
            <button
              type="button"
              onClick={handleExtractZip}
              className="inline-flex items-center gap-1 px-2 py-1.5 rounded-lg text-xs font-medium cursor-pointer shrink-0"
              style={{ background: "var(--surface-alt)" }}
              title="Extract ZIP here"
            >
              <FolderOutput size={13} /> Extract
            </button>
          )}

          <button
            type="button"
            disabled={activeSel.size === 0}
            onClick={() => handleDelete(false)}
            className="p-1.5 rounded-lg text-red-400 disabled:opacity-35 cursor-pointer"
            style={{ background: "var(--surface-alt)" }}
            title="Move to Trash (Del) • Shift+Del for permanent"
          >
            <Trash2 size={15} />
          </button>

          <div className="w-px h-5 mx-0.5" style={{ background: "var(--border)" }} />

          <button
            type="button"
            onClick={() => setDiskUsageOpen(true)}
            className="p-1.5 rounded-lg cursor-pointer"
            style={{ background: "var(--surface-alt)" }}
            title="Disk Space Analyzer (What's eating my disk?)"
          >
            <PieChart size={15} />
          </button>

          <button
            type="button"
            onClick={() => setDuplicatesOpen(true)}
            className="p-1.5 rounded-lg cursor-pointer"
            style={{ background: "var(--surface-alt)" }}
            title="Find Duplicate Files (SHA-256)"
          >
            <CopyCheck size={15} />
          </button>

          <button
            type="button"
            onClick={() =>
              currentDir && nkfApi.openTerminalHere(currentDir).catch((e) => showToast(String(e), true))
            }
            className="p-1.5 rounded-lg cursor-pointer"
            style={{ background: "var(--surface-alt)" }}
            title="Open Terminal Here (F4)"
          >
            <Terminal size={15} />
          </button>

          <button
            type="button"
            onClick={() => setShowHidden((v) => !v)}
            className="p-1.5 rounded-lg cursor-pointer"
            style={{
              background: showHidden ? "var(--surface-hover)" : "var(--surface-alt)",
            }}
            title="Toggle Hidden Files (Ctrl+H)"
          >
            {showHidden ? <Eye size={15} /> : <EyeOff size={15} />}
          </button>
        </div>

        {/* Right: Palette, Bookmark, Support, Theme */}
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={() => setPaletteOpen(true)}
            className="hidden md:inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium cursor-pointer"
            style={{ background: "var(--surface-alt)", color: "var(--text-muted)" }}
            title="Command Palette (Ctrl+K)"
          >
            <Command size={13} /> Ctrl+K
          </button>

          <button
            type="button"
            onClick={toggleBookmark}
            className="p-1.5 rounded-lg cursor-pointer"
            style={{ background: "var(--surface-alt)" }}
            title="Bookmark current folder"
          >
            <Star
              size={15}
              className={bookmarks.includes(currentDir) ? "text-amber-400 fill-amber-400" : ""}
            />
          </button>

          <button
            type="button"
            onClick={() => nkfApi.openExternalUrl("https://buymeacoffee.com/aurorauap")}
            className="hidden lg:inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium cursor-pointer"
            style={{ background: "var(--surface-alt)" }}
            title="Support NKF on Buy Me a Coffee"
          >
            <Coffee size={14} className="text-amber-400" />
            Support
          </button>

          <div className="relative">
            <button
              type="button"
              onClick={() => setShowThemeMenu((v) => !v)}
              className="p-1.5 rounded-lg cursor-pointer"
              style={{ background: "var(--surface-alt)" }}
              title="Switch Theme"
              aria-label="Switch Theme"
            >
              <Palette size={15} />
            </button>
            {showThemeMenu && (
              <div
                className="absolute right-0 mt-2 w-56 rounded-xl border shadow-2xl p-1.5 z-50 space-y-1"
                style={{ background: "var(--surface)", borderColor: "var(--border)" }}
              >
                <div
                  className="px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider"
                  style={{ color: "var(--text-muted)" }}
                >
                  Theme
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setThemeId("auto");
                    setShowThemeMenu(false);
                  }}
                  className="w-full flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg text-xs text-left cursor-pointer"
                  style={{
                    background: themeId === "auto" ? "var(--surface-hover)" : "transparent",
                  }}
                >
                  <span className="flex items-center gap-2">
                    <span
                      className="w-3.5 h-3.5 rounded-full border"
                      style={{
                        background: "linear-gradient(135deg, #0c0e14 50%, #f4f6fa 50%)",
                        borderColor: "var(--border)",
                      }}
                    />
                    Auto (Adaptive)
                  </span>
                  {themeId === "auto" && <Check size={13} />}
                </button>
                {allThemes.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => {
                      setThemeId(t.id);
                      setShowThemeMenu(false);
                    }}
                    className="w-full flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg text-xs text-left cursor-pointer"
                    style={{
                      background: themeId === t.id ? "var(--surface-hover)" : "transparent",
                    }}
                  >
                    <span className="flex items-center gap-2">
                      <span
                        className="w-3.5 h-3.5 rounded-full border"
                        style={{ background: t.accent, borderColor: t.border }}
                      />
                      {t.name}
                    </span>
                    {themeId === t.id && <Check size={13} />}
                  </button>
                ))}

                <div className="my-1 border-t" style={{ borderColor: "var(--border)" }} />
                <div
                  className="px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider"
                  style={{ color: "var(--text-muted)" }}
                >
                  Icon Set
                </div>
                {(
                  [
                    { id: "native", label: "System / Native" },
                    { id: "classic", label: "Classic Gold" },
                    { id: "vibrant", label: "Vibrant Modern" },
                    { id: "minimal", label: "Minimal Mono" },
                  ] as { id: IconSet; label: string }[]
                ).map((set) => (
                  <button
                    key={set.id}
                    type="button"
                    onClick={() => {
                      setIconSet(set.id);
                      setShowThemeMenu(false);
                    }}
                    className="w-full flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg text-xs text-left cursor-pointer"
                    style={{
                      background: iconSet === set.id ? "var(--surface-hover)" : "transparent",
                    }}
                  >
                    <span>{set.label}</span>
                    {iconSet === set.id && <Check size={13} />}
                  </button>
                ))}
                <div className="my-1 border-t" style={{ borderColor: "var(--border)" }} />
                <div
                  className="px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider"
                  style={{ color: "var(--text-muted)" }}
                >
                  System Integration
                </div>
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      const next = !isDefaultFm;
                      const res = await nkfApi.setDefaultFileManager(next);
                      setIsDefaultFm(res);
                      showToast(
                        res
                          ? "NKF is now your default file manager for folders!"
                          : platform === "windows"
                            ? "Restored Windows Explorer as default!"
                            : "Restored system default file manager!"
                      );
                    } catch (e) {
                      showToast(String(e), true);
                    } finally {
                      setShowThemeMenu(false);
                    }
                  }}
                  className="w-full flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg text-xs text-left cursor-pointer"
                  style={{
                    background: isDefaultFm ? "var(--surface-hover)" : "transparent",
                  }}
                  title={
                    isDefaultFm
                      ? "Click to restore Windows Explorer / system default"
                      : "Open folders in NKF by default (no admin required)"
                  }
                >
                  <span>
                    {isDefaultFm
                      ? platform === "windows"
                        ? "Restore Windows Explorer"
                        : "Restore System Default"
                      : "Set as Default File Manager"}
                  </span>
                  {isDefaultFm && <Check size={13} className="text-emerald-400 shrink-0" />}
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* TABS BAR */}
      <div
        className="h-9 px-2 border-b flex items-center gap-1 overflow-x-auto nkf-scroll shrink-0"
        style={{ background: "var(--surface-alt)", borderColor: "var(--border)" }}
      >
        {tabs.map((tab) => {
          const isCur = tab.id === activeTabId;
          return (
            <div
              key={tab.id}
              onClick={() => {
                setActiveTabId(tab.id);
                setActivePane("left");
              }}
              className="group flex items-center gap-2 px-3 py-1 rounded-lg text-xs cursor-pointer max-w-[190px] transition-colors"
              style={{
                background: isCur ? "var(--surface)" : "transparent",
                color: isCur ? "var(--text)" : "var(--text-muted)",
              }}
            >
              <span className="truncate font-medium">{baseName(tab.path)}</span>
              {tabs.length > 1 && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    closeTab(tab.id);
                  }}
                  className="opacity-60 hover:opacity-100 cursor-pointer"
                  aria-label="Close tab"
                >
                  <X size={12} />
                </button>
              )}
            </div>
          );
        })}
        <button
          type="button"
          onClick={() => addTab()}
          className="p-1 rounded-lg hover:bg-white/10 cursor-pointer"
          title="New Tab (Ctrl+T)"
          aria-label="New Tab"
        >
          <Plus size={14} />
        </button>
      </div>

      {/* MAIN AREA: PLACES SIDEBAR + FILE PANES */}
      <div className="flex-1 flex min-h-0">
        {/* Places & Bookmarks Sidebar */}
        <aside
          className="w-48 shrink-0 border-r p-2 overflow-y-auto nkf-scroll hidden sm:flex flex-col gap-3"
          style={{ background: "var(--surface)", borderColor: "var(--border)" }}
        >
          <div>
            <div
              className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider"
              style={{ color: "var(--text-muted)" }}
            >
              Places
            </div>
            <div className="space-y-0.5">
              {places.map((p) => (
                <button
                  key={p.path}
                  type="button"
                  onClick={() => navigatePane(activePane, p.path)}
                  className="w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-xs text-left cursor-pointer transition-colors"
                  style={{
                    background: currentDir === p.path ? "var(--surface-hover)" : "transparent",
                    color: currentDir === p.path ? "var(--text)" : "var(--text-muted)",
                  }}
                >
                  {placeIcon(p.kind)}
                  <span className="truncate">{p.name}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Network Shares Section */}
          <div>
            <div className="px-2 py-1 flex items-center justify-between">
              <span
                className="text-[10px] font-semibold uppercase tracking-wider"
                style={{ color: "var(--text-muted)" }}
              >
                Network
              </span>
              <div className="flex items-center gap-0.5">
                <button
                  type="button"
                  onClick={refreshNetworkShares}
                  title="Scan network shares"
                  className="p-0.5 rounded hover:bg-white/10 cursor-pointer"
                  style={{ color: "var(--text-muted)" }}
                >
                  <RefreshCw size={11} />
                </button>
                <button
                  type="button"
                  onClick={() => setNetworkModalOpen(true)}
                  title="Add / Connect Network Share"
                  className="p-0.5 rounded hover:bg-white/10 cursor-pointer"
                  style={{ color: "var(--accent)" }}
                >
                  <Plus size={12} />
                </button>
              </div>
            </div>

            <div className="space-y-0.5">
              {[
                ...networkShares,
                ...savedShares.filter(
                  (s) => !networkShares.some((n) => n.path.toLowerCase() === s.path.toLowerCase())
                ),
              ].map((share) => (
                <div
                  key={share.path}
                  className="group flex items-center gap-1 rounded-lg transition-colors"
                  style={{
                    background: currentDir === share.path ? "var(--surface-hover)" : "transparent",
                  }}
                >
                  <button
                    type="button"
                    onClick={() => navigatePane(activePane, share.path)}
                    title={share.remote || share.path}
                    className="flex-1 min-w-0 flex items-center gap-2 px-2.5 py-1.5 text-xs text-left cursor-pointer"
                    style={{
                      color: currentDir === share.path ? "var(--text)" : "var(--text-muted)",
                    }}
                  >
                    <Network size={14} className="shrink-0" style={{ color: "var(--accent)" }} />
                    <span className="truncate">{share.name}</span>
                  </button>
                  {savedShares.some((s) => s.path === share.path) && (
                    <button
                      type="button"
                      title="Remove saved share"
                      onClick={() => {
                        const next = savedShares.filter((s) => s.path !== share.path);
                        setSavedShares(next);
                        localStorage.setItem(SAVED_SHARES_KEY, JSON.stringify(next));
                      }}
                      className="opacity-0 group-hover:opacity-100 p-1 mr-1 rounded hover:bg-white/10 cursor-pointer"
                    >
                      <X size={11} />
                    </button>
                  )}
                </div>
              ))}

              <button
                type="button"
                onClick={() => setNetworkModalOpen(true)}
                className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs text-left cursor-pointer opacity-75 hover:opacity-100"
                style={{ color: "var(--text-muted)" }}
              >
                <Plus size={13} /> Add Network Share...
              </button>
            </div>
          </div>

          {bookmarks.length > 0 && (
            <div>
              <div
                className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider"
                style={{ color: "var(--text-muted)" }}
              >
                Bookmarks
              </div>
              <div className="space-y-0.5">
                {bookmarks.map((bm) => (
                  <button
                    key={bm}
                    type="button"
                    onClick={() => navigatePane(activePane, bm)}
                    className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs text-left cursor-pointer"
                    style={{
                      background: currentDir === bm ? "var(--surface-hover)" : "transparent",
                      color: "var(--text)",
                    }}
                    title={bm}
                  >
                    <Star size={13} className="text-amber-400 shrink-0" />
                    <span className="truncate">{baseName(bm)}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
          {recentDirs.length > 0 && (
            <div>
              <div
                className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider"
                style={{ color: "var(--text-muted)" }}
              >
                Recent
              </div>
              <div className="space-y-0.5">
                {recentDirs.slice(0, 5).map((dir) => (
                  <button
                    key={dir}
                    type="button"
                    onClick={() => navigatePane(activePane, dir)}
                    className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs text-left cursor-pointer"
                    style={{
                      background: currentDir === dir ? "var(--surface-hover)" : "transparent",
                      color: "var(--text-muted)",
                    }}
                    title={dir}
                  >
                    <Clock size={12} className="shrink-0 opacity-70" />
                    <span className="truncate">{baseName(dir)}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </aside>

        {/* Left & Optional Right Split Pane */}
        <main className="flex-1 flex min-w-0 min-h-0">
          {activeLeftTab && (
            <FilePane
              paneId="left"
              isActive={activePane === "left"}
              path={activeLeftTab.path}
              history={activeLeftTab.history}
              historyIdx={activeLeftTab.historyIdx}
              showHidden={showHidden}
              viewMode={leftViewMode}
              iconSet={iconSet}
              refreshTick={leftRefreshTick}
              selectedPaths={leftSel}
              onFocus={() => setActivePane("left")}
              onNavigate={(p) => navigatePane("left", p)}
              onBack={() => stepHistory("left", -1)}
              onForward={() => stepHistory("left", 1)}
              onSelectChange={(sel, list) => {
                setLeftSel(sel);
                setLeftEntries(list);
              }}
              onOpenEntry={(entry) => {
                if (entry.is_dir) navigatePane("left", entry.path);
                else nkfApi.openWithDefault(entry.path).catch((e) => showToast(String(e), true));
              }}
              onContextMenu={(e, entry) =>
                setContextMenu({ x: e.clientX, y: e.clientY, entry })
              }
              onDropPaths={handleDropPaths}
              onToggleViewMode={() => setLeftViewMode((v) => (v === "list" ? "grid" : "list"))}
              onRefresh={() => setLeftRefreshTick((t) => t + 1)}
            />
          )}

          {splitMode && rightPane.path && (
            <FilePane
              paneId="right"
              isActive={activePane === "right"}
              path={rightPane.path}
              history={rightPane.history}
              historyIdx={rightPane.historyIdx}
              showHidden={showHidden}
              viewMode={rightViewMode}
              iconSet={iconSet}
              refreshTick={rightRefreshTick}
              selectedPaths={rightSel}
              onFocus={() => setActivePane("right")}
              onNavigate={(p) => navigatePane("right", p)}
              onBack={() => stepHistory("right", -1)}
              onForward={() => stepHistory("right", 1)}
              onSelectChange={(sel, list) => {
                setRightSel(sel);
                setRightEntries(list);
              }}
              onOpenEntry={(entry) => {
                if (entry.is_dir) navigatePane("right", entry.path);
                else nkfApi.openWithDefault(entry.path).catch((e) => showToast(String(e), true));
              }}
              onContextMenu={(e, entry) =>
                setContextMenu({ x: e.clientX, y: e.clientY, entry })
              }
              onDropPaths={handleDropPaths}
              onToggleViewMode={() => setRightViewMode((v) => (v === "list" ? "grid" : "list"))}
              onRefresh={() => setRightRefreshTick((t) => t + 1)}
            />
          )}
        </main>
      </div>

      {/* TRANSFER PROGRESS CARD */}
      {transfer && (
        <div
          className="fixed bottom-4 left-4 z-50 w-80 p-3.5 rounded-2xl shadow-2xl border space-y-2"
          style={{ background: "var(--surface)", borderColor: "var(--accent)" }}
        >
          <div className="flex items-center justify-between text-xs font-semibold">
            <span className="capitalize">
              {transfer.operation === "copy" ? "Copying" : "Moving"}...
            </span>
            <span className="font-mono" style={{ color: "var(--accent)" }}>
              {transfer.bytes_total > 0
                ? `${Math.min(100, Math.round((transfer.bytes_done / transfer.bytes_total) * 100))}%`
                : "…"}
            </span>
          </div>
          <div className="text-[11px] truncate" style={{ color: "var(--text-muted)" }}>
            {transfer.current_file}
          </div>
          <div className="h-1.5 rounded-full overflow-hidden bg-black/30">
            <div
              className="h-full rounded-full transition-all"
              style={{
                width: `${
                  transfer.bytes_total > 0
                    ? Math.min(100, (transfer.bytes_done / transfer.bytes_total) * 100)
                    : 15
                }%`,
                background: "var(--accent)",
              }}
            />
          </div>
          <div className="flex justify-between text-[10px] font-mono" style={{ color: "var(--text-muted)" }}>
            <span>
              {fmtBytes(transfer.bytes_done)} / {fmtBytes(transfer.bytes_total)}
            </span>
            <span>{fmtBytes(transfer.speed_bps)}/s</span>
          </div>
        </div>
      )}

      {/* TOAST */}
      {toast && (
        <div
          role="status"
          className="fixed bottom-4 right-4 z-50 px-4 py-2.5 rounded-xl shadow-2xl border text-xs font-medium"
          style={{
            background: toast.isError ? "#991b1b" : "var(--surface)",
            borderColor: toast.isError ? "#ef4444" : "var(--accent)",
            color: toast.isError ? "#ffffff" : "var(--text)",
          }}
        >
          {toast.msg}
        </div>
      )}

      {/* MODALS */}
      <QuickLookModal
        entry={quickLookEntry}
        onClose={() => setQuickLookEntry(null)}
        onSaved={(name) => {
          triggerRefresh();
          showToast(`Saved "${name}"`);
        }}
      />

      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        commands={
          [
            {
              id: "act-split",
              label: splitMode ? "Disable Dual-Pane Split View" : "Enable Dual-Pane Split View",
              category: "Action",
              shortcut: "F3",
              run: () => setSplitMode((v) => !v),
            },
            {
              id: "act-term",
              label: "Open Terminal in Current Folder",
              category: "Action",
              shortcut: "F4",
              run: () =>
                currentDir &&
                nkfApi.openTerminalHere(currentDir).catch((e) => showToast(String(e), true)),
            },
            {
              id: "act-disk",
              label: "Disk Space Analyzer",
              category: "Tools",
              run: () => setDiskUsageOpen(true),
            },
            {
              id: "act-dups",
              label: "Find Duplicate Files (SHA-256)",
              category: "Tools",
              run: () => setDuplicatesOpen(true),
            },
            {
              id: "act-net",
              label: "Connect Network Share / Map Drive",
              category: "Network",
              run: () => setNetworkModalOpen(true),
            },
            {
              id: "act-hidden",
              label: showHidden ? "Hide Hidden Files" : "Show Hidden Files",
              category: "View",
              shortcut: "Ctrl+H",
              run: () => setShowHidden((v) => !v),
            },
            {
              id: "act-folder",
              label: "Create New Folder",
              category: "Action",
              run: handleNewFolder,
            },
            ...places.map((p) => ({
              id: `place-${p.path}`,
              label: `Go to ${p.name}`,
              category: "Place",
              run: () => navigatePane(activePane, p.path),
            })),
            ...networkShares.map((s) => ({
              id: `net-${s.path}`,
              label: `Open Share: ${s.name}`,
              category: "Network",
              run: () => navigatePane(activePane, s.path),
            })),
            ...bookmarks.map((bm) => ({
              id: `bm-${bm}`,
              label: `Bookmark: ${baseName(bm)}`,
              category: "Bookmark",
              run: () => navigatePane(activePane, bm),
            })),
            ...allThemes.map((t) => ({
              id: `theme-${t.id}`,
              label: `Switch Theme → ${t.name}`,
              category: "Theme",
              run: () => setThemeId(t.id),
            })),
          ] as PaletteCommand[]
        }
      />

      <BatchRenameModal
        open={batchRenameOpen}
        items={selectedEntries}
        onClose={() => setBatchRenameOpen(false)}
        onDone={(count) => {
          triggerRefresh();
          showToast(`Batch renamed ${count} item(s)!`);
        }}
        onError={(msg) => showToast(msg, true)}
      />

      <DiskUsageModal
        open={diskUsageOpen}
        dirPath={currentDir}
        onClose={() => setDiskUsageOpen(false)}
        onNavigate={(p) => navigatePane(activePane, p)}
      />

      <NetworkShareModal
        open={networkModalOpen}
        isWindows={platform === "windows"}
        onClose={() => setNetworkModalOpen(false)}
        onConnected={(mountedPath, remoteLabel) => {
          const item: NetworkShareItem = {
            name: baseName(remoteLabel) || mountedPath,
            path: mountedPath,
            remote: remoteLabel,
            kind: "smb",
          };
          setSavedShares((prev) => {
            const next = [item, ...prev.filter((s) => s.path !== mountedPath)];
            localStorage.setItem(SAVED_SHARES_KEY, JSON.stringify(next));
            return next;
          });
          refreshNetworkShares();
          navigatePane(activePane, mountedPath);
          showToast(`Connected to ${remoteLabel}`);
        }}
        onError={(msg) => showToast(msg, true)}
      />

      <DuplicatesModal
        open={duplicatesOpen}
        dirPath={currentDir}
        otherDir={splitMode ? otherDir : ""}
        onClose={() => setDuplicatesOpen(false)}
        onDeleted={(count) => {
          triggerRefresh();
          showToast(`Moved ${count} duplicate(s) to Trash!`);
        }}
        onError={(msg) => showToast(msg, true)}
      />

      <PropertiesModal path={propertiesPath} onClose={() => setPropertiesPath(null)} />

      <FolderCompareModal
        open={compareOpen}
        leftDir={activeLeftTab?.path || ""}
        rightDir={rightPane.path}
        onClose={() => setCompareOpen(false)}
        onSynced={(msg) => {
          triggerRefresh();
          showToast(msg);
        }}
        onOpenDiff={(l, r) => setDiffPair([l, r])}
        onError={(msg) => showToast(msg, true)}
      />

      <DiffEditorModal
        open={Boolean(diffPair)}
        leftPath={diffPair?.[0] ?? null}
        rightPath={diffPair?.[1] ?? null}
        onClose={() => setDiffPair(null)}
        onSaved={(msg) => {
          triggerRefresh();
          showToast(msg);
        }}
        onError={(msg) => showToast(msg, true)}
      />

      <ContextMenu
        menu={contextMenu}
        selectedCount={activeSel.size}
        canDiff={Boolean(diffCandidates)}
        hasClipboard={Boolean(clipboard)}
        onClose={() => setContextMenu(null)}
        onOpen={(entry) => {
          if (entry.is_dir) navigatePane(activePane, entry.path);
          else nkfApi.openWithDefault(entry.path).catch((e) => showToast(String(e), true));
        }}
        onQuickLook={setQuickLookEntry}
        onDiff={() => diffCandidates && setDiffPair(diffCandidates)}
        onCopy={handleCopy}
        onCut={handleCut}
        onPaste={handlePaste}
        onCopyPath={(p) => {
          navigator.clipboard.writeText(p).catch(() => {});
          showToast("Copied full path to clipboard");
        }}
        onRename={handleRename}
        onBatchRename={() => setBatchRenameOpen(true)}
        onZip={handleZip}
        onExtractZip={handleExtractZip}
        onProperties={(p) => setPropertiesPath(p)}
        onTerminal={() =>
          currentDir && nkfApi.openTerminalHere(currentDir).catch((e) => showToast(String(e), true))
        }
        onDelete={() => handleDelete(false)}
      />
    </div>
  );
}
