use base64::Engine;
use serde::Serialize;
use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::UNIX_EPOCH;
use walkdir::WalkDir;

#[derive(Serialize, Clone)]
pub struct FileEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub is_symlink: bool,
    pub is_hidden: bool,
    pub size: u64,
    pub modified_ms: u64,
    pub extension: String,
}

#[derive(Serialize)]
pub struct PlaceItem {
    pub name: String,
    pub path: String,
    pub kind: String, // "home" | "desktop" | "documents" | "downloads" | "pictures" | "music" | "videos" | "drive"
}

#[derive(Serialize)]
pub struct PreviewData {
    pub kind: String, // "text" | "image" | "binary" | "dir"
    pub mime: String,
    pub content: String,
    pub size: u64,
    pub truncated: bool,
}

#[derive(Serialize)]
pub struct DiskUsageItem {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub size: u64,
    pub percent: f64,
}

#[derive(Serialize)]
pub struct OmarchyTheme {
    pub name: String,
    pub bg: String,
    pub surface: String,
    pub surface_alt: String,
    pub text: String,
    pub text_muted: String,
    pub accent: String,
    pub border: String,
    pub is_dark: bool,
}

fn is_hidden_name(name: &str) -> bool {
    name.starts_with('.')
}

fn entry_from_path(path: &Path) -> Option<FileEntry> {
    let name = path.file_name()?.to_string_lossy().to_string();
    let symlink_meta = fs::symlink_metadata(path).ok()?;
    let is_symlink = symlink_meta.file_type().is_symlink();
    let meta = fs::metadata(path).unwrap_or(symlink_meta);
    let is_dir = meta.is_dir();
    let size = if is_dir { 0 } else { meta.len() };
    let modified_ms = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);
    let extension = if is_dir {
        String::new()
    } else {
        path.extension()
            .map(|e| e.to_string_lossy().to_lowercase())
            .unwrap_or_default()
    };

    Some(FileEntry {
        is_hidden: is_hidden_name(&name),
        name,
        path: path.to_string_lossy().to_string(),
        is_dir,
        is_symlink,
        size,
        modified_ms,
        extension,
    })
}

#[tauri::command]
fn get_initial_dir() -> String {
    if let Some(arg) = std::env::args().skip(1).find(|a| !a.starts_with('-')) {
        let p = PathBuf::from(&arg);
        if let Ok(canon) = fs::canonicalize(&p) {
            if canon.is_dir() {
                return canon.to_string_lossy().to_string();
            } else if let Some(parent) = canon.parent() {
                return parent.to_string_lossy().to_string();
            }
        }
    }
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("/"))
        .to_string_lossy()
        .to_string()
}

#[tauri::command]
fn get_system_places() -> Vec<PlaceItem> {
    let mut places = Vec::new();
    let mut push_dir = |name: &str, opt: Option<PathBuf>, kind: &str| {
        if let Some(p) = opt {
            if p.exists() {
                places.push(PlaceItem {
                    name: name.to_string(),
                    path: p.to_string_lossy().to_string(),
                    kind: kind.to_string(),
                });
            }
        }
    };

    push_dir("Home", dirs::home_dir(), "home");
    push_dir("Desktop", dirs::desktop_dir(), "desktop");
    push_dir("Documents", dirs::document_dir(), "documents");
    push_dir("Downloads", dirs::download_dir(), "downloads");
    push_dir("Pictures", dirs::picture_dir(), "pictures");
    push_dir("Music", dirs::audio_dir(), "music");
    push_dir("Videos", dirs::video_dir(), "videos");

    #[cfg(target_os = "windows")]
    {
        for letter in b'A'..=b'Z' {
            let root = format!("{}:\\", letter as char);
            if Path::new(&root).exists() {
                places.push(PlaceItem {
                    name: format!("Drive ({}:)", letter as char),
                    path: root,
                    kind: "drive".to_string(),
                });
            }
        }
    }

    #[cfg(not(target_os = "windows"))]
    {
        places.push(PlaceItem {
            name: "File System (/)".to_string(),
            path: "/".to_string(),
            kind: "drive".to_string(),
        });

        // Detect mounted USB/external drives under /run/media/$USER or /mnt
        if let Ok(user) = std::env::var("USER") {
            let media_dir = PathBuf::from("/run/media").join(user);
            if let Ok(rd) = fs::read_dir(media_dir) {
                for entry in rd.flatten() {
                    let p = entry.path();
                    if p.is_dir() {
                        places.push(PlaceItem {
                            name: entry.file_name().to_string_lossy().to_string(),
                            path: p.to_string_lossy().to_string(),
                            kind: "drive".to_string(),
                        });
                    }
                }
            }
        }
    }

    places
}

#[tauri::command]
fn list_directory(path: String, show_hidden: bool) -> Result<Vec<FileEntry>, String> {
    let dir = PathBuf::from(&path);
    let read_dir = fs::read_dir(&dir).map_err(|e| format!("Cannot read {}: {}", path, e))?;

    let mut entries = Vec::new();
    for item in read_dir.flatten() {
        if let Some(entry) = entry_from_path(&item.path()) {
            if !show_hidden && entry.is_hidden {
                continue;
            }
            entries.push(entry);
        }
    }

    entries.sort_by(|a, b| {
        b.is_dir
            .cmp(&a.is_dir)
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });

    Ok(entries)
}

#[tauri::command]
fn read_preview(path: String) -> Result<PreviewData, String> {
    let p = PathBuf::from(&path);
    let meta = fs::metadata(&p).map_err(|e| e.to_string())?;
    if meta.is_dir() {
        let count = fs::read_dir(&p).map(|rd| rd.count()).unwrap_or(0);
        return Ok(PreviewData {
            kind: "dir".to_string(),
            mime: "inode/directory".to_string(),
            content: format!("{} items", count),
            size: 0,
            truncated: false,
        });
    }

    let size = meta.len();
    let ext = p
        .extension()
        .map(|e| e.to_string_lossy().to_lowercase())
        .unwrap_or_default();

    // Images up to 12 MB
    let img_mime = match ext.as_str() {
        "png" => Some("image/png"),
        "jpg" | "jpeg" => Some("image/jpeg"),
        "webp" => Some("image/webp"),
        "gif" => Some("image/gif"),
        "svg" => Some("image/svg+xml"),
        "bmp" => Some("image/bmp"),
        "ico" => Some("image/x-icon"),
        _ => None,
    };

    if let Some(mime) = img_mime {
        if size <= 12 * 1024 * 1024 {
            let bytes = fs::read(&p).map_err(|e| e.to_string())?;
            let b64 = base64::engine::general_purpose::STANDARD.encode(bytes);
            return Ok(PreviewData {
                kind: "image".to_string(),
                mime: mime.to_string(),
                content: format!("data:{};base64,{}", mime, b64),
                size,
                truncated: false,
            });
        }
    }

    // Text / Code files (read up to 96 KB)
    let is_known_text = matches!(
        ext.as_str(),
        "txt"
            | "md"
            | "markdown"
            | "json"
            | "toml"
            | "yaml"
            | "yml"
            | "xml"
            | "html"
            | "htm"
            | "css"
            | "scss"
            | "js"
            | "jsx"
            | "ts"
            | "tsx"
            | "rs"
            | "py"
            | "go"
            | "c"
            | "h"
            | "cpp"
            | "hpp"
            | "java"
            | "kt"
            | "sh"
            | "bash"
            | "zsh"
            | "fish"
            | "ini"
            | "conf"
            | "cfg"
            | "log"
            | "csv"
            | "sql"
            | "env"
            | "gitignore"
            | "dockerfile"
            | "lock"
    );

    let max_read: usize = 96 * 1024;
    let mut file = File::open(&p).map_err(|e| e.to_string())?;
    let mut buf = vec![0u8; std::cmp::min(size as usize, max_read)];
    let n = file.read(&mut buf).map_err(|e| e.to_string())?;
    buf.truncate(n);

    let looks_text = is_known_text || (!buf.contains(&0) && std::str::from_utf8(&buf).is_ok());
    if looks_text {
        let text = String::from_utf8_lossy(&buf).to_string();
        return Ok(PreviewData {
            kind: "text".to_string(),
            mime: "text/plain".to_string(),
            content: text,
            size,
            truncated: size > max_read as u64,
        });
    }

    Ok(PreviewData {
        kind: "binary".to_string(),
        mime: format!(".{}", ext),
        content: String::new(),
        size,
        truncated: false,
    })
}

#[tauri::command]
fn search_files(root_dir: String, query: String, max_results: usize) -> Result<Vec<FileEntry>, String> {
    let q = query.trim().to_lowercase();
    if q.is_empty() {
        return Ok(vec![]);
    }
    let limit = max_results.clamp(1, 500);
    let mut results = Vec::new();

    for entry in WalkDir::new(&root_dir)
        .max_depth(8)
        .into_iter()
        .filter_entry(|e| {
            let name = e.file_name().to_string_lossy();
            !(name == ".git" || name == "node_modules" || name == "target")
        })
        .flatten()
    {
        if entry.depth() == 0 {
            continue;
        }
        let name = entry.file_name().to_string_lossy().to_lowercase();
        if name.contains(&q) {
            if let Some(fe) = entry_from_path(entry.path()) {
                results.push(fe);
                if results.len() >= limit {
                    break;
                }
            }
        }
    }

    Ok(results)
}

#[tauri::command]
fn compute_folder_sizes(path: String) -> Result<Vec<DiskUsageItem>, String> {
    let dir = PathBuf::from(&path);
    let read_dir = fs::read_dir(&dir).map_err(|e| e.to_string())?;

    let mut raw: Vec<(String, String, bool, u64)> = Vec::new();
    let mut total: u64 = 0;

    for item in read_dir.flatten() {
        let p = item.path();
        let name = item.file_name().to_string_lossy().to_string();
        let is_dir = p.is_dir();
        let size: u64 = if is_dir {
            WalkDir::new(&p)
                .into_iter()
                .flatten()
                .filter_map(|e| e.metadata().ok())
                .filter(|m| m.is_file())
                .map(|m| m.len())
                .sum()
        } else {
            item.metadata().map(|m| m.len()).unwrap_or(0)
        };
        total += size;
        raw.push((name, p.to_string_lossy().to_string(), is_dir, size));
    }

    raw.sort_by(|a, b| b.3.cmp(&a.3));
    let denom = std::cmp::max(total, 1) as f64;
    Ok(raw
        .into_iter()
        .map(|(name, path, is_dir, size)| DiskUsageItem {
            name,
            path,
            is_dir,
            size,
            percent: (size as f64 / denom) * 100.0,
        })
        .collect())
}

#[tauri::command]
fn create_folder(parent: String, name: String) -> Result<String, String> {
    let target = PathBuf::from(&parent).join(name.trim());
    fs::create_dir_all(&target).map_err(|e| format!("Failed to create folder: {}", e))?;
    Ok(target.to_string_lossy().to_string())
}

#[tauri::command]
fn create_file(parent: String, name: String) -> Result<String, String> {
    let target = PathBuf::from(&parent).join(name.trim());
    File::create(&target).map_err(|e| format!("Failed to create file: {}", e))?;
    Ok(target.to_string_lossy().to_string())
}

#[tauri::command]
fn rename_item(path: String, new_name: String) -> Result<String, String> {
    let src = PathBuf::from(&path);
    let parent = src.parent().ok_or("Invalid path")?;
    let dst = parent.join(new_name.trim());
    if dst.exists() {
        return Err("An item with that name already exists.".to_string());
    }
    fs::rename(&src, &dst).map_err(|e| format!("Rename failed: {}", e))?;
    Ok(dst.to_string_lossy().to_string())
}

#[tauri::command]
fn batch_rename(pairs: Vec<(String, String)>) -> Result<usize, String> {
    let mut count = 0;
    for (src_str, new_name) in pairs {
        let src = PathBuf::from(&src_str);
        let Some(parent) = src.parent() else { continue };
        let dst = parent.join(new_name.trim());
        if src == dst || new_name.trim().is_empty() {
            continue;
        }
        if dst.exists() {
            return Err(format!("Target already exists: {}", dst.display()));
        }
        fs::rename(&src, &dst).map_err(|e| format!("Failed renaming {}: {}", src_str, e))?;
        count += 1;
    }
    Ok(count)
}

fn copy_recursive(src: &Path, dst: &Path) -> Result<(), String> {
    if src.is_dir() {
        fs::create_dir_all(dst).map_err(|e| e.to_string())?;
        for entry in fs::read_dir(src).map_err(|e| e.to_string())?.flatten() {
            let child_src = entry.path();
            let child_dst = dst.join(entry.file_name());
            copy_recursive(&child_src, &child_dst)?;
        }
    } else {
        fs::copy(src, dst).map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn unique_dest(dest_dir: &Path, name: &str) -> PathBuf {
    let candidate = dest_dir.join(name);
    if !candidate.exists() {
        return candidate;
    }
    let stem = Path::new(name)
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| name.to_string());
    let ext = Path::new(name)
        .extension()
        .map(|e| format!(".{}", e.to_string_lossy()))
        .unwrap_or_default();

    for i in 1..1000 {
        let alt = dest_dir.join(format!("{} (copy {}){}", stem, i, ext));
        if !alt.exists() {
            return alt;
        }
    }
    candidate
}

#[tauri::command]
fn copy_items(sources: Vec<String>, dest_dir: String) -> Result<usize, String> {
    let dest = PathBuf::from(&dest_dir);
    let mut count = 0;
    for s in sources {
        let src = PathBuf::from(&s);
        let Some(name) = src.file_name() else { continue };
        let target = unique_dest(&dest, &name.to_string_lossy());
        copy_recursive(&src, &target)?;
        count += 1;
    }
    Ok(count)
}

#[tauri::command]
fn move_items(sources: Vec<String>, dest_dir: String) -> Result<usize, String> {
    let dest = PathBuf::from(&dest_dir);
    let mut count = 0;
    for s in sources {
        let src = PathBuf::from(&s);
        let Some(name) = src.file_name() else { continue };
        let target = unique_dest(&dest, &name.to_string_lossy());
        if fs::rename(&src, &target).is_err() {
            copy_recursive(&src, &target)?;
            if src.is_dir() {
                fs::remove_dir_all(&src).map_err(|e| e.to_string())?;
            } else {
                fs::remove_file(&src).map_err(|e| e.to_string())?;
            }
        }
        count += 1;
    }
    Ok(count)
}

#[tauri::command]
fn delete_items(paths: Vec<String>, permanent: bool) -> Result<usize, String> {
    let mut count = 0;
    for p_str in paths {
        let p = PathBuf::from(&p_str);
        if permanent {
            if p.is_dir() {
                fs::remove_dir_all(&p).map_err(|e| format!("Delete failed: {}", e))?;
            } else {
                fs::remove_file(&p).map_err(|e| format!("Delete failed: {}", e))?;
            }
        } else {
            trash::delete(&p).map_err(|e| format!("Move to Trash failed: {}", e))?;
        }
        count += 1;
    }
    Ok(count)
}

#[tauri::command]
fn compress_to_zip(paths: Vec<String>, dest_zip: String) -> Result<String, String> {
    let file = File::create(&dest_zip).map_err(|e| format!("Cannot create zip: {}", e))?;
    let mut zip = zip::ZipWriter::new(file);
    let options = zip::write::SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated);

    for p_str in paths {
        let root = PathBuf::from(&p_str);
        let base_parent = root.parent().unwrap_or_else(|| Path::new(""));
        if root.is_dir() {
            for entry in WalkDir::new(&root).into_iter().flatten() {
                let path = entry.path();
                let rel = path
                    .strip_prefix(base_parent)
                    .unwrap_or(path)
                    .to_string_lossy()
                    .replace('\\', "/");
                if path.is_dir() {
                    let _ = zip.add_directory(format!("{}/", rel), options);
                } else {
                    zip.start_file(rel, options).map_err(|e| e.to_string())?;
                    let mut f = File::open(path).map_err(|e| e.to_string())?;
                    std::io::copy(&mut f, &mut zip).map_err(|e| e.to_string())?;
                }
            }
        } else if let Some(name) = root.file_name() {
            zip.start_file(name.to_string_lossy(), options)
                .map_err(|e| e.to_string())?;
            let mut f = File::open(&root).map_err(|e| e.to_string())?;
            std::io::copy(&mut f, &mut zip).map_err(|e| e.to_string())?;
        }
    }

    zip.finish().map_err(|e| e.to_string())?;
    Ok(dest_zip)
}

#[tauri::command]
fn extract_zip(zip_path: String, dest_dir: String) -> Result<usize, String> {
    let file = File::open(&zip_path).map_err(|e| format!("Cannot open zip: {}", e))?;
    let mut archive = zip::ZipArchive::new(file).map_err(|e| format!("Invalid zip: {}", e))?;
    let dest = PathBuf::from(&dest_dir);
    fs::create_dir_all(&dest).map_err(|e| e.to_string())?;

    let mut extracted = 0;
    for i in 0..archive.len() {
        let mut entry = archive.by_index(i).map_err(|e| e.to_string())?;
        let Some(rel_path) = entry.enclosed_name().map(|p| p.to_path_buf()) else {
            continue;
        };
        let out_path = dest.join(rel_path);
        if entry.is_dir() {
            fs::create_dir_all(&out_path).map_err(|e| e.to_string())?;
        } else {
            if let Some(parent) = out_path.parent() {
                fs::create_dir_all(parent).map_err(|e| e.to_string())?;
            }
            let mut out_file = File::create(&out_path).map_err(|e| e.to_string())?;
            let mut buf = Vec::new();
            entry.read_to_end(&mut buf).map_err(|e| e.to_string())?;
            out_file.write_all(&buf).map_err(|e| e.to_string())?;
            extracted += 1;
        }
    }
    Ok(extracted)
}

#[tauri::command]
fn open_with_default(path: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    let res = Command::new("cmd").args(["/C", "start", "", &path]).spawn();
    #[cfg(target_os = "macos")]
    let res = Command::new("open").arg(&path).spawn();
    #[cfg(all(unix, not(target_os = "macos")))]
    let res = Command::new("xdg-open").arg(&path).spawn();

    res.map(|_| ()).map_err(|e| format!("Failed to open: {}", e))
}

#[tauri::command]
fn open_terminal_here(dir: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        if Command::new("wt").args(["-d", &dir]).spawn().is_ok() {
            return Ok(());
        }
        Command::new("powershell")
            .current_dir(&dir)
            .spawn()
            .map(|_| ())
            .map_err(|e| e.to_string())
    }
    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .args(["-a", "Terminal", &dir])
            .spawn()
            .map(|_| ())
            .map_err(|e| e.to_string())
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        let candidates: &[(&str, &[&str])] = &[
            ("ghostty", &["--working-directory"]),
            ("alacritty", &["--working-directory"]),
            ("kitty", &["--directory"]),
            ("foot", &["--working-directory"]),
            ("wezterm", &["start", "--cwd"]),
            ("konsole", &["--workdir"]),
            ("gnome-terminal", &["--working-directory"]),
            ("xterm", &[]),
        ];
        for (bin, args) in candidates {
            let mut cmd = Command::new(bin);
            if args.is_empty() {
                cmd.current_dir(&dir);
            } else {
                cmd.args(*args).arg(&dir);
            }
            if cmd.spawn().is_ok() {
                return Ok(());
            }
        }
        Err("No supported terminal emulator found.".to_string())
    }
}

fn hex_luminance(hex: &str) -> f32 {
    let clean = hex.trim().trim_start_matches('#');
    if clean.len() < 6 {
        return 0.0;
    }
    let r = u8::from_str_radix(&clean[0..2], 16).unwrap_or(0) as f32 / 255.0;
    let g = u8::from_str_radix(&clean[2..4], 16).unwrap_or(0) as f32 / 255.0;
    let b = u8::from_str_radix(&clean[4..6], 16).unwrap_or(0) as f32 / 255.0;
    0.2126 * r + 0.7152 * g + 0.0722 * b
}

fn extract_hex(line: &str) -> Option<String> {
    let idx = line.find('#')?;
    let rest = &line[idx..];
    if rest.len() >= 7 && rest[1..7].chars().all(|c| c.is_ascii_hexdigit()) {
        return Some(rest[0..7].to_string());
    }
    None
}

#[tauri::command]
fn get_omarchy_theme() -> Option<OmarchyTheme> {
    let home = dirs::home_dir()?;
    let theme_dir = home.join(".config/omarchy/current/theme");
    if !theme_dir.exists() {
        return None;
    }
    let theme_name = fs::read_link(&theme_dir)
        .ok()
        .and_then(|p| p.file_name().map(|n| n.to_string_lossy().to_string()))
        .unwrap_or_else(|| "Omarchy".to_string());
    let content = fs::read_to_string(theme_dir.join("colors.toml")).ok()?;

    let mut bg = "#11131a".to_string();
    let mut fg = "#e2e8f0".to_string();
    let mut accent = "#818cf8".to_string();
    let mut surface = "#181b26".to_string();
    let mut muted = "#64748b".to_string();

    for line in content.lines() {
        let lower = line.trim().to_lowercase();
        if let Some(hex) = extract_hex(line) {
            if lower.starts_with("background") {
                bg = hex;
            } else if lower.starts_with("foreground") {
                fg = hex;
            } else if lower.starts_with("accent") || lower.starts_with("color4") {
                accent = hex;
            } else if lower.starts_with("color0") || lower.starts_with("selection_background") {
                surface = hex;
            } else if lower.starts_with("color8") {
                muted = hex;
            }
        }
    }

    let is_dark = hex_luminance(&bg) < 0.5;
    let border = if is_dark {
        "rgba(255, 255, 255, 0.12)".to_string()
    } else {
        "rgba(0, 0, 0, 0.12)".to_string()
    };

    Some(OmarchyTheme {
        name: theme_name,
        bg: bg.clone(),
        surface,
        surface_alt: bg,
        text: fg,
        text_muted: muted,
        accent,
        border,
        is_dark,
    })
}

#[tauri::command]
fn open_external_url(url: String) -> Result<(), String> {
    if !(url.starts_with("https://") || url.starts_with("http://")) {
        return Err("Only http/https URLs are allowed.".to_string());
    }
    open_with_default(url)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            get_initial_dir,
            get_system_places,
            list_directory,
            read_preview,
            search_files,
            compute_folder_sizes,
            create_folder,
            create_file,
            rename_item,
            batch_rename,
            copy_items,
            move_items,
            delete_items,
            compress_to_zip,
            extract_zip,
            open_with_default,
            open_terminal_here,
            get_omarchy_theme,
            open_external_url
        ])
        .run(tauri::generate_context!())
        .expect("error while running NKF");
}
