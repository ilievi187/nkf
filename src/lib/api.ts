import { invoke } from "@tauri-apps/api/core";
import type { ThemeDefinition } from "./themes";

export interface FileEntry {
  name: string;
  path: string;
  is_dir: boolean;
  is_symlink: boolean;
  is_hidden: boolean;
  size: number;
  modified_ms: number;
  extension: string;
}

export interface PlaceItem {
  name: string;
  path: string;
  kind: string;
}

export interface NetworkShareItem {
  name: string;
  path: string;
  remote: string;
  kind: string;
}

export interface PreviewData {
  kind: "text" | "image" | "binary" | "dir";
  mime: string;
  content: string;
  size: number;
  truncated: boolean;
}

export interface DiskUsageItem {
  name: string;
  path: string;
  is_dir: boolean;
  size: number;
  percent: number;
}

export interface DuplicateGroup {
  hash: string;
  size: number;
  wasted_bytes: number;
  files: FileEntry[];
}

export interface FileProperties {
  name: string;
  path: string;
  is_dir: boolean;
  size: number;
  item_count: number;
  modified_ms: number;
  created_ms: number;
  readonly: boolean;
  sha256: string | null;
}

export interface TransferProgress {
  operation: "copy" | "move";
  current_file: string;
  bytes_done: number;
  bytes_total: number;
  speed_bps: number;
  done: boolean;
}

export function fmtBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const idx = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const val = bytes / Math.pow(1024, idx);
  return `${val < 10 && idx > 0 ? val.toFixed(1) : Math.round(val)} ${units[idx]}`;
}

export function fmtDate(ms: number): string {
  if (!ms) return "—";
  const d = new Date(ms);
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function getParentPath(path: string): string {
  if (!path || path === "/") return "/";
  // Windows UNC path: \\server\share\sub -> \\server\share
  if (path.startsWith("\\\\")) {
    const parts = path.slice(2).split("\\").filter(Boolean);
    if (parts.length <= 2) return `\\\\${parts.join("\\")}`;
    return `\\\\${parts.slice(0, -1).join("\\")}`;
  }
  const isWin = /^[A-Za-z]:\\/.test(path);
  const sep = isWin ? "\\" : "/";
  const trimmed = path.endsWith(sep) && path.length > (isWin ? 3 : 1) ? path.slice(0, -1) : path;
  const idx = trimmed.lastIndexOf(sep);
  if (idx < 0) return path;
  if (isWin && idx <= 2) return trimmed.slice(0, 3);
  return idx === 0 ? "/" : trimmed.slice(0, idx);
}

export function splitBreadcrumbs(path: string): { label: string; fullPath: string }[] {
  if (!path) return [];
  // Windows UNC path: \\server\share\dir
  if (path.startsWith("\\\\")) {
    const parts = path.slice(2).split("\\").filter(Boolean);
    if (parts.length === 0) return [];
    if (parts.length === 1) {
      return [{ label: `\\\\${parts[0]}`, fullPath: `\\\\${parts[0]}` }];
    }
    const rootShare = `\\\\${parts[0]}\\${parts[1]}`;
    const crumbs = [{ label: rootShare, fullPath: rootShare }];
    for (let i = 2; i < parts.length; i++) {
      crumbs.push({
        label: parts[i],
        fullPath: `${rootShare}\\${parts.slice(2, i + 1).join("\\")}`,
      });
    }
    return crumbs;
  }
  const isWin = /^[A-Za-z]:\\/.test(path);
  if (isWin) {
    const parts = path.split("\\").filter(Boolean);
    return parts.map((p, idx) => ({
      label: idx === 0 ? `${p}\\` : p,
      fullPath: idx === 0 ? `${p}\\` : parts.slice(0, idx + 1).join("\\"),
    }));
  }
  const parts = path.split("/").filter(Boolean);
  const crumbs = [{ label: "/", fullPath: "/" }];
  parts.forEach((p, idx) => {
    crumbs.push({
      label: p,
      fullPath: "/" + parts.slice(0, idx + 1).join("/"),
    });
  });
  return crumbs;
}

const nativeIconCache = new Map<string, string | null>();
const nativeIconPending = new Map<string, Promise<string | null>>();

export function getCachedNativeIcon(entry: FileEntry): Promise<string | null> {
  const ext = entry.extension.toLowerCase();
  const unique = !entry.is_dir && ["exe", "lnk", "ico", "url", "cur"].includes(ext);
  const key = unique ? `path:${entry.path}` : entry.is_dir ? "dir" : `ext:${ext}`;

  if (nativeIconCache.has(key)) {
    return Promise.resolve(nativeIconCache.get(key) ?? null);
  }
  const existing = nativeIconPending.get(key);
  if (existing) return existing;

  const p = invoke<string | null>("get_native_icon", {
    path: entry.path,
    isDir: entry.is_dir,
    extension: ext,
  })
    .then((res) => {
      nativeIconCache.set(key, res);
      nativeIconPending.delete(key);
      return res;
    })
    .catch(() => {
      nativeIconCache.set(key, null);
      nativeIconPending.delete(key);
      return null;
    });
  nativeIconPending.set(key, p);
  return p;
}

const imageThumbCache = new Map<string, string | null>();
const IMAGE_EXTS = new Set(["png", "jpg", "jpeg", "webp", "gif", "svg", "bmp"]);

export function isPreviewableImage(entry: FileEntry): boolean {
  return !entry.is_dir && IMAGE_EXTS.has(entry.extension.toLowerCase());
}

export function getCachedImageThumb(path: string): Promise<string | null> {
  if (imageThumbCache.has(path)) {
    return Promise.resolve(imageThumbCache.get(path) ?? null);
  }
  return invoke<string | null>("get_image_thumb", { path })
    .then((res) => {
      if (imageThumbCache.size > 300) imageThumbCache.clear();
      imageThumbCache.set(path, res);
      return res;
    })
    .catch(() => {
      imageThumbCache.set(path, null);
      return null;
    });
}

export const nkfApi = {
  getPlatform: () => invoke<string>("get_platform"),
  getInitialDir: () => invoke<string>("get_initial_dir"),
  getSystemPlaces: () => invoke<PlaceItem[]>("get_system_places"),
  getNetworkShares: () => invoke<NetworkShareItem[]>("get_network_shares"),
  findDuplicates: (rootDir: string) => invoke<DuplicateGroup[]>("find_duplicates", { rootDir }),
  getFileProperties: (path: string, computeHash = false) =>
    invoke<FileProperties>("get_file_properties", { path, computeHash }),
  writeTextFile: (path: string, content: string) =>
    invoke<void>("write_text_file", { path, content }),
  getGitBranch: (dir: string) => invoke<string | null>("get_git_branch", { dir }),
  connectNetworkShare: (
    sharePath: string,
    username: string,
    password: string,
    driveLetter: string
  ) =>
    invoke<string>("connect_network_share", {
      sharePath,
      username,
      password,
      driveLetter,
    }),
  disconnectNetworkShare: (target: string) =>
    invoke<void>("disconnect_network_share", { target }),
  listDirectory: (path: string, showHidden: boolean) =>
    invoke<FileEntry[]>("list_directory", { path, showHidden }),
  readPreview: (path: string) => invoke<PreviewData>("read_preview", { path }),
  searchFiles: (rootDir: string, query: string, maxResults = 200) =>
    invoke<FileEntry[]>("search_files", { rootDir, query, maxResults }),
  computeFolderSizes: (path: string) => invoke<DiskUsageItem[]>("compute_folder_sizes", { path }),
  createFolder: (parent: string, name: string) =>
    invoke<string>("create_folder", { parent, name }),
  createFile: (parent: string, name: string) => invoke<string>("create_file", { parent, name }),
  renameItem: (path: string, newName: string) =>
    invoke<string>("rename_item", { path, newName }),
  batchRename: (pairs: [string, string][]) => invoke<number>("batch_rename", { pairs }),
  copyItems: (sources: string[], destDir: string) =>
    invoke<number>("copy_items", { sources, destDir }),
  moveItems: (sources: string[], destDir: string) =>
    invoke<number>("move_items", { sources, destDir }),
  deleteItems: (paths: string[], permanent: boolean) =>
    invoke<number>("delete_items", { paths, permanent }),
  compressToZip: (paths: string[], destZip: string) =>
    invoke<string>("compress_to_zip", { paths, destZip }),
  extractZip: (zipPath: string, destDir: string) =>
    invoke<number>("extract_zip", { zipPath, destDir }),
  openWithDefault: (path: string) => invoke<void>("open_with_default", { path }),
  openTerminalHere: (dir: string) => invoke<void>("open_terminal_here", { dir }),
  openExternalUrl: (url: string) => invoke<void>("open_external_url", { url }),
  getOmarchyTheme: async (): Promise<ThemeDefinition | null> => {
    try {
      const raw = await invoke<{
        name: string;
        bg: string;
        surface: string;
        surface_alt: string;
        text: string;
        text_muted: string;
        accent: string;
        border: string;
        is_dark: boolean;
      } | null>("get_omarchy_theme");
      if (!raw) return null;
      return {
        id: "omarchy",
        name: `Omarchy (${raw.name})`,
        isDark: raw.is_dark,
        bg: raw.bg,
        surface: raw.surface,
        surfaceAlt: raw.surface_alt,
        surfaceHover: raw.is_dark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.06)",
        text: raw.text,
        textMuted: raw.text_muted,
        accent: raw.accent,
        accentText: raw.is_dark ? "#11111b" : "#ffffff",
        border: raw.border,
        scrollbarThumb: raw.text_muted,
      };
    } catch {
      return null;
    }
  },
};
