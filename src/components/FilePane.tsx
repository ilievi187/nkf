import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  RefreshCw,
  Folder,
  FileText,
  FileImage,
  FileCode,
  FileArchive,
  FileAudio,
  FileVideo,
  File as FileIcon,
  Search,
  Filter,
  LayoutGrid,
  List,
  ChevronRight,
  Loader2,
  X,
} from "lucide-react";
import {
  fmtBytes,
  fmtDate,
  getCachedImageThumb,
  getCachedNativeIcon,
  getParentPath,
  isPreviewableImage,
  nkfApi,
  splitBreadcrumbs,
  type FileEntry,
} from "../lib/api";

export type ViewMode = "list" | "grid";
type SortKey = "name" | "size" | "modified";

interface FilePaneProps {
  paneId: "left" | "right";
  isActive: boolean;
  path: string;
  history: string[];
  historyIdx: number;
  showHidden: boolean;
  viewMode: ViewMode;
  refreshTick: number;
  selectedPaths: Set<string>;
  onFocus: () => void;
  onNavigate: (path: string) => void;
  onBack: () => void;
  onForward: () => void;
  onSelectChange: (next: Set<string>, entries: FileEntry[]) => void;
  onOpenEntry: (entry: FileEntry) => void;
  onContextMenu: (e: React.MouseEvent, entry: FileEntry | null) => void;
  onDropPaths: (sources: string[], destDir: string, isCopy: boolean) => void;
  onToggleViewMode: () => void;
  onRefresh: () => void;
}

export function renderFileIcon(entry: FileEntry, size = 18) {
  if (entry.is_dir) return <Folder size={size} style={{ color: "var(--accent)" }} fill="currentColor" fillOpacity={0.2} />;
  const ext = entry.extension;
  if (["png", "jpg", "jpeg", "webp", "gif", "svg", "bmp", "ico"].includes(ext))
    return <FileImage size={size} className="text-emerald-400" />;
  if (["mp4", "mkv", "webm", "avi", "mov"].includes(ext))
    return <FileVideo size={size} className="text-pink-400" />;
  if (["mp3", "wav", "flac", "ogg", "m4a"].includes(ext))
    return <FileAudio size={size} className="text-amber-400" />;
  if (["zip", "tar", "gz", "7z", "rar", "xz", "zst"].includes(ext))
    return <FileArchive size={size} className="text-orange-400" />;
  if (["rs", "ts", "tsx", "js", "jsx", "py", "go", "c", "cpp", "json", "toml", "yaml", "html", "css", "sh"].includes(ext))
    return <FileCode size={size} className="text-sky-400" />;
  if (["pdf", "md", "txt", "doc", "docx", "odt"].includes(ext))
    return <FileText size={size} className="text-indigo-300" />;
  return <FileIcon size={size} style={{ color: "var(--text-muted)" }} />;
}

export const NativeFileIcon: React.FC<{ entry: FileEntry; size?: number }> = ({
  entry,
  size = 18,
}) => {
  const [nativeUrl, setNativeUrl] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    getCachedNativeIcon(entry).then((url) => {
      if (active && url) setNativeUrl(url);
    });
    return () => {
      active = false;
    };
  }, [entry.path, entry.is_dir, entry.extension]);

  if (nativeUrl) {
    return (
      <img
        src={nativeUrl}
        alt=""
        width={size}
        height={size}
        draggable={false}
        className="object-contain shrink-0 block"
        style={{ width: size, height: size }}
      />
    );
  }
  return renderFileIcon(entry, size);
};

const GridThumbnail: React.FC<{ entry: FileEntry }> = ({ entry }) => {
  const [thumb, setThumb] = useState<string | null>(null);
  const holderRef = useRef<HTMLDivElement>(null);
  const canThumb = isPreviewableImage(entry);

  useEffect(() => {
    if (!canThumb) return;
    const el = holderRef.current;
    if (!el) return;
    let active = true;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          io.disconnect();
          getCachedImageThumb(entry.path).then((url) => {
            if (active && url) setThumb(url);
          });
        }
      },
      { rootMargin: "120px" }
    );
    io.observe(el);
    return () => {
      active = false;
      io.disconnect();
    };
  }, [canThumb, entry.path]);

  return (
    <div ref={holderRef} className="w-16 h-14 flex items-center justify-center overflow-hidden rounded-lg">
      {thumb ? (
        <img
          src={thumb}
          alt={entry.name}
          loading="lazy"
          decoding="async"
          draggable={false}
          className="w-full h-full object-cover rounded-lg"
        />
      ) : (
        <NativeFileIcon entry={entry} size={36} />
      )}
    </div>
  );
};

export const FilePane: React.FC<FilePaneProps> = ({
  isActive,
  path,
  history,
  historyIdx,
  showHidden,
  viewMode,
  refreshTick,
  selectedPaths,
  onFocus,
  onNavigate,
  onBack,
  onForward,
  onSelectChange,
  onOpenEntry,
  onContextMenu,
  onDropPaths,
  onToggleViewMode,
  onRefresh,
}) => {
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dropHoverPath, setDropHoverPath] = useState<string | null>(null);

  const [editingPath, setEditingPath] = useState(false);
  const [pathInput, setPathInput] = useState(path);

  const [filterText, setFilterText] = useState("");
  const [deepSearch, setDeepSearch] = useState(false);
  const [searchResults, setSearchResults] = useState<FileEntry[] | null>(null);
  const [searching, setSearching] = useState(false);

  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortAsc, setSortAsc] = useState(true);
  const lastClickedIdx = useRef<number | null>(null);

  useEffect(() => {
    setPathInput(path);
    setSearchResults(null);
    setFilterText("");
    setDeepSearch(false);
  }, [path]);

  useEffect(() => {
    if (!path) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    nkfApi
      .listDirectory(path, showHidden)
      .then((list) => {
        if (!cancelled) setEntries(list);
      })
      .catch((e) => {
        if (!cancelled) {
          setError(String(e));
          setEntries([]);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [path, showHidden, refreshTick]);

  // Deep recursive search when enabled
  useEffect(() => {
    if (!deepSearch || !filterText.trim()) {
      setSearchResults(null);
      return;
    }
    const timer = window.setTimeout(() => {
      setSearching(true);
      nkfApi
        .searchFiles(path, filterText, 250)
        .then(setSearchResults)
        .catch(() => setSearchResults([]))
        .finally(() => setSearching(false));
    }, 220);
    return () => window.clearTimeout(timer);
  }, [deepSearch, filterText, path]);

  const displayed = useMemo(() => {
    const source = deepSearch && searchResults !== null ? searchResults : entries;
    const q = !deepSearch ? filterText.trim().toLowerCase() : "";
    const filtered = q ? source.filter((e) => e.name.toLowerCase().includes(q)) : source;

    return [...filtered].sort((a, b) => {
      if (a.is_dir !== b.is_dir) return a.is_dir ? -1 : 1;
      let cmp = 0;
      if (sortKey === "name") cmp = a.name.toLowerCase().localeCompare(b.name.toLowerCase());
      else if (sortKey === "size") cmp = a.size - b.size;
      else cmp = a.modified_ms - b.modified_ms;
      return sortAsc ? cmp : -cmp;
    });
  }, [entries, searchResults, deepSearch, filterText, sortKey, sortAsc]);

  const handleRowClick = (e: React.MouseEvent, entry: FileEntry, idx: number) => {
    onFocus();
    const next = new Set(selectedPaths);
    if (e.shiftKey && lastClickedIdx.current !== null) {
      const [start, end] = [
        Math.min(lastClickedIdx.current, idx),
        Math.max(lastClickedIdx.current, idx),
      ];
      for (let i = start; i <= end; i++) {
        next.add(displayed[i].path);
      }
    } else if (e.ctrlKey || e.metaKey) {
      if (next.has(entry.path)) next.delete(entry.path);
      else next.add(entry.path);
      lastClickedIdx.current = idx;
    } else {
      next.clear();
      next.add(entry.path);
      lastClickedIdx.current = idx;
    }
    onSelectChange(next, displayed);
  };

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortAsc((v) => !v);
    else {
      setSortKey(key);
      setSortAsc(true);
    }
  };

  const handleDragStart = (e: React.DragEvent, entry: FileEntry) => {
    const paths = selectedPaths.has(entry.path) ? Array.from(selectedPaths) : [entry.path];
    e.dataTransfer.setData("application/x-nkf-paths", JSON.stringify(paths));
    e.dataTransfer.effectAllowed = "copyMove";
  };

  const handleDropOnTarget = (e: React.DragEvent, destDir: string) => {
    e.preventDefault();
    e.stopPropagation();
    setDropHoverPath(null);
    const raw = e.dataTransfer.getData("application/x-nkf-paths");
    if (!raw) return;
    try {
      const sources: string[] = JSON.parse(raw);
      if (sources.length > 0 && !sources.includes(destDir)) {
        onDropPaths(sources, destDir, e.ctrlKey || e.metaKey);
      }
    } catch {
      // ignore
    }
  };

  const crumbs = useMemo(() => splitBreadcrumbs(path), [path]);

  return (
    <section
      onMouseDown={onFocus}
      className="flex-1 flex flex-col min-w-0 h-full border-r last:border-r-0 transition-colors"
      style={{
        background: "var(--bg)",
        borderColor: "var(--border)",
        boxShadow: isActive ? "inset 0 2px 0 0 var(--accent)" : "none",
      }}
    >
      {/* Pane Navigation + Breadcrumbs */}
      <div
        className="px-2.5 py-2 border-b flex items-center gap-1.5 shrink-0"
        style={{ background: "var(--surface)", borderColor: "var(--border)" }}
      >
        <button
          type="button"
          disabled={historyIdx <= 0}
          onClick={onBack}
          title="Back (Alt+Left)"
          className="p-1.5 rounded-lg disabled:opacity-30 cursor-pointer"
          style={{ background: "var(--surface-alt)" }}
        >
          <ArrowLeft size={14} />
        </button>
        <button
          type="button"
          disabled={historyIdx >= history.length - 1}
          onClick={onForward}
          title="Forward (Alt+Right)"
          className="p-1.5 rounded-lg disabled:opacity-30 cursor-pointer"
          style={{ background: "var(--surface-alt)" }}
        >
          <ArrowRight size={14} />
        </button>
        <button
          type="button"
          onClick={() => onNavigate(getParentPath(path))}
          title="Up one level"
          className="p-1.5 rounded-lg cursor-pointer"
          style={{ background: "var(--surface-alt)" }}
        >
          <ArrowUp size={14} />
        </button>

        {/* Breadcrumb / Editable Path Bar */}
        <div
          className="flex-1 min-w-0 h-8 px-2 rounded-lg border flex items-center overflow-x-auto nkf-scroll"
          style={{ background: "var(--surface-alt)", borderColor: "var(--border)" }}
          onDoubleClick={() => setEditingPath(true)}
        >
          {editingPath ? (
            <form
              className="w-full"
              onSubmit={(e) => {
                e.preventDefault();
                setEditingPath(false);
                if (pathInput.trim()) onNavigate(pathInput.trim());
              }}
            >
              <input
                autoFocus
                type="text"
                value={pathInput}
                onChange={(e) => setPathInput(e.target.value)}
                onBlur={() => setEditingPath(false)}
                className="w-full bg-transparent text-xs font-mono outline-none"
              />
            </form>
          ) : (
            <div className="flex items-center gap-0.5 text-xs whitespace-nowrap">
              {crumbs.map((c, idx) => (
                <React.Fragment key={c.fullPath}>
                  {idx > 0 && <ChevronRight size={12} style={{ color: "var(--text-muted)" }} />}
                  <button
                    type="button"
                    onClick={() => onNavigate(c.fullPath)}
                    className="px-1.5 py-0.5 rounded hover:bg-white/10 cursor-pointer font-medium"
                  >
                    {c.label}
                  </button>
                </React.Fragment>
              ))}
            </div>
          )}
        </div>

        <button
          type="button"
          onClick={onRefresh}
          title="Refresh (F5)"
          className="p-1.5 rounded-lg cursor-pointer"
          style={{ background: "var(--surface-alt)" }}
        >
          <RefreshCw size={14} />
        </button>

        <button
          type="button"
          onClick={onToggleViewMode}
          title={viewMode === "list" ? "Switch to Grid View" : "Switch to List View"}
          className="p-1.5 rounded-lg cursor-pointer"
          style={{ background: "var(--surface-alt)" }}
        >
          {viewMode === "list" ? <LayoutGrid size={14} /> : <List size={14} />}
        </button>
      </div>

      {/* Quick Filter / Deep Search bar */}
      <div
        className="px-2.5 py-1.5 border-b flex items-center gap-2 shrink-0"
        style={{ background: "var(--surface-alt)", borderColor: "var(--border)" }}
      >
        {deepSearch ? (
          <Search size={13} style={{ color: "var(--accent)" }} />
        ) : (
          <Filter size={13} style={{ color: "var(--text-muted)" }} />
        )}
        <input
          type="text"
          value={filterText}
          onChange={(e) => setFilterText(e.target.value)}
          placeholder={deepSearch ? "Search recursively in subfolders..." : "Quick filter current folder..."}
          className="flex-1 bg-transparent text-xs outline-none"
        />
        {searching && <Loader2 size={13} className="animate-spin" style={{ color: "var(--accent)" }} />}
        {filterText && (
          <button
            type="button"
            onClick={() => setFilterText("")}
            className="p-0.5 rounded cursor-pointer"
            aria-label="Clear filter"
          >
            <X size={13} />
          </button>
        )}
        <button
          type="button"
          onClick={() => setDeepSearch((v) => !v)}
          className="px-2 py-0.5 rounded text-[11px] font-medium cursor-pointer"
          style={{
            background: deepSearch ? "var(--accent)" : "var(--surface)",
            color: deepSearch ? "var(--accent-text)" : "var(--text-muted)",
          }}
          title="Toggle recursive subfolder search"
        >
          {deepSearch ? "Deep Search ON" : "Subfolders"}
        </button>
      </div>

      {/* File List / Grid */}
      <div
        className="flex-1 overflow-auto nkf-scroll"
        style={{
          outline: dropHoverPath === path ? "2px dashed var(--accent)" : "none",
          outlineOffset: "-4px",
        }}
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes("application/x-nkf-paths")) {
            e.preventDefault();
            setDropHoverPath(path);
          }
        }}
        onDragLeave={(e) => {
          if (e.currentTarget === e.target) setDropHoverPath(null);
        }}
        onDrop={(e) => handleDropOnTarget(e, path)}
        onContextMenu={(e) => {
          if (e.target === e.currentTarget) {
            e.preventDefault();
            onFocus();
            onContextMenu(e, null);
          }
        }}
        onClick={(e) => {
          if (e.target === e.currentTarget) {
            onSelectChange(new Set(), displayed);
          }
        }}
      >
        {loading ? (
          <div className="h-full flex items-center justify-center gap-2 text-xs" style={{ color: "var(--text-muted)" }}>
            <Loader2 size={16} className="animate-spin" /> Loading...
          </div>
        ) : error ? (
          <div className="p-6 text-xs text-red-400">{error}</div>
        ) : displayed.length === 0 ? (
          <div className="h-full flex items-center justify-center text-xs" style={{ color: "var(--text-muted)" }}>
            {filterText ? "No matching files." : "This folder is empty."}
          </div>
        ) : viewMode === "list" ? (
          <table className="w-full border-collapse text-xs">
            <thead
              className="sticky top-0 z-10 border-b text-left"
              style={{ background: "var(--surface)", borderColor: "var(--border)", color: "var(--text-muted)" }}
            >
              <tr>
                <th className="py-1.5 px-3 font-medium">
                  <button type="button" onClick={() => toggleSort("name")} className="cursor-pointer hover:underline">
                    Name {sortKey === "name" ? (sortAsc ? "↑" : "↓") : ""}
                  </button>
                </th>
                <th className="py-1.5 px-3 font-medium w-24 text-right">
                  <button type="button" onClick={() => toggleSort("size")} className="cursor-pointer hover:underline">
                    Size {sortKey === "size" ? (sortAsc ? "↑" : "↓") : ""}
                  </button>
                </th>
                <th className="py-1.5 px-3 font-medium w-40 hidden sm:table-cell">
                  <button type="button" onClick={() => toggleSort("modified")} className="cursor-pointer hover:underline">
                    Modified {sortKey === "modified" ? (sortAsc ? "↑" : "↓") : ""}
                  </button>
                </th>
              </tr>
            </thead>
            <tbody>
              {displayed.map((entry, idx) => {
                const isSel = selectedPaths.has(entry.path);
                return (
                  <tr
                    key={entry.path}
                    draggable
                    onDragStart={(e) => handleDragStart(e, entry)}
                    onDragOver={(e) => {
                      if (entry.is_dir && e.dataTransfer.types.includes("application/x-nkf-paths")) {
                        e.preventDefault();
                        e.stopPropagation();
                        setDropHoverPath(entry.path);
                      }
                    }}
                    onDragLeave={() => {
                      if (dropHoverPath === entry.path) setDropHoverPath(null);
                    }}
                    onDrop={(e) => {
                      if (entry.is_dir) handleDropOnTarget(e, entry.path);
                    }}
                    onClick={(e) => handleRowClick(e, entry, idx)}
                    onDoubleClick={() => onOpenEntry(entry)}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      if (!selectedPaths.has(entry.path)) {
                        onSelectChange(new Set([entry.path]), displayed);
                      }
                      onFocus();
                      onContextMenu(e, entry);
                    }}
                    className="border-b transition-colors cursor-pointer"
                    style={{
                      borderColor: "color-mix(in srgb, var(--border) 50%, transparent)",
                      background:
                        dropHoverPath === entry.path
                          ? "color-mix(in srgb, var(--accent) 35%, transparent)"
                          : isSel
                          ? "color-mix(in srgb, var(--accent) 22%, transparent)"
                          : "transparent",
                    }}
                  >
                    <td className="py-1.5 px-3">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <span className="shrink-0">
                          <NativeFileIcon entry={entry} size={18} />
                        </span>
                        <span className={`truncate ${entry.is_hidden ? "opacity-60" : ""}`}>
                          {entry.name}
                        </span>
                      </div>
                    </td>
                    <td className="py-1.5 px-3 text-right font-mono" style={{ color: "var(--text-muted)" }}>
                      {entry.is_dir ? "—" : fmtBytes(entry.size)}
                    </td>
                    <td className="py-1.5 px-3 hidden sm:table-cell" style={{ color: "var(--text-muted)" }}>
                      {fmtDate(entry.modified_ms)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          <div className="p-3 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-2.5">
            {displayed.map((entry, idx) => {
              const isSel = selectedPaths.has(entry.path);
              return (
                <button
                  key={entry.path}
                  type="button"
                  draggable
                  onDragStart={(e) => handleDragStart(e, entry)}
                  onDragOver={(e) => {
                    if (entry.is_dir && e.dataTransfer.types.includes("application/x-nkf-paths")) {
                      e.preventDefault();
                      e.stopPropagation();
                      setDropHoverPath(entry.path);
                    }
                  }}
                  onDragLeave={() => {
                    if (dropHoverPath === entry.path) setDropHoverPath(null);
                  }}
                  onDrop={(e) => {
                    if (entry.is_dir) handleDropOnTarget(e, entry.path);
                  }}
                  onClick={(e) => handleRowClick(e, entry, idx)}
                  onDoubleClick={() => onOpenEntry(entry)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    if (!selectedPaths.has(entry.path)) {
                      onSelectChange(new Set([entry.path]), displayed);
                    }
                    onFocus();
                    onContextMenu(e, entry);
                  }}
                  className="p-3 rounded-xl border flex flex-col items-center text-center gap-2 cursor-pointer transition-colors"
                  style={{
                    background:
                      dropHoverPath === entry.path
                        ? "color-mix(in srgb, var(--accent) 35%, transparent)"
                        : isSel
                        ? "color-mix(in srgb, var(--accent) 22%, transparent)"
                        : "var(--surface)",
                    borderColor: isSel || dropHoverPath === entry.path ? "var(--accent)" : "var(--border)",
                  }}
                >
                  <GridThumbnail entry={entry} />
                  <span className="text-xs w-full truncate font-medium">{entry.name}</span>
                  <span className="text-[10px] font-mono" style={{ color: "var(--text-muted)" }}>
                    {entry.is_dir ? "Folder" : fmtBytes(entry.size)}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Pane Status Bar */}
      <div
        className="px-3 py-1 border-t flex items-center justify-between text-[11px] shrink-0"
        style={{ background: "var(--surface)", borderColor: "var(--border)", color: "var(--text-muted)" }}
      >
        <span>
          {displayed.length} item{displayed.length === 1 ? "" : "s"}
          {selectedPaths.size > 0 ? ` • ${selectedPaths.size} selected` : ""}
        </span>
        <span className="hidden sm:inline">Space: Quick Look • F3: Split • F4: Terminal</span>
      </div>
    </section>
  );
};
