mod mcp;
mod pty;

use base64::Engine;
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::{LazyLock, Mutex};
use std::time::{Instant, UNIX_EPOCH};
use tauri::Emitter;
use walkdir::WalkDir;

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x08000000;

static ICON_CACHE: LazyLock<Mutex<HashMap<String, Option<String>>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

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
    pub kind: String,
}

#[derive(Serialize, Clone)]
pub struct NetworkShareItem {
    pub name: String,
    pub path: String,
    pub remote: String,
    pub kind: String, // "mapped" | "unc" | "host" | "smb" | "nfs" | "sshfs"
}

#[derive(Serialize)]
pub struct PreviewData {
    pub kind: String,
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
pub struct DuplicateGroup {
    pub hash: String,
    pub size: u64,
    pub wasted_bytes: u64,
    pub files: Vec<FileEntry>,
}

#[derive(Serialize)]
pub struct FileProperties {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub size: u64,
    pub item_count: usize,
    pub modified_ms: u64,
    pub created_ms: u64,
    pub readonly: bool,
    pub sha256: Option<String>,
}

#[derive(Serialize, Clone)]
pub struct TransferProgress {
    pub operation: String, // "copy" | "move"
    pub current_file: String,
    pub bytes_done: u64,
    pub bytes_total: u64,
    pub speed_bps: u64,
    pub done: bool,
}

#[derive(Serialize)]
pub struct CompareItem {
    pub name: String,
    pub status: String, // "only_left" | "only_right" | "different" | "same"
    pub left_path: Option<String>,
    pub right_path: Option<String>,
    pub left_size: u64,
    pub right_size: u64,
    pub is_dir: bool,
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
fn get_platform() -> String {
    std::env::consts::OS.to_string()
}

#[tauri::command]
fn get_username() -> String {
    std::env::var("USER")
        .or_else(|_| std::env::var("USERNAME"))
        .unwrap_or_else(|_| "user".to_string())
}

#[tauri::command]
fn get_initial_dir() -> String {
    if let Some(arg) = std::env::args().skip(1).find(|a| !a.starts_with('-')) {
        let p = PathBuf::from(&arg);
        if let Ok(canon) = fs::canonicalize(&p) {
            let target = if canon.is_dir() {
                canon
            } else {
                canon.parent().map(|pp| pp.to_path_buf()).unwrap_or(canon)
            };
            let s = target.to_string_lossy().to_string();
            #[cfg(target_os = "windows")]
            if let Some(stripped) = s.strip_prefix(r"\\?\") {
                return stripped.to_string();
            }
            return s;
        }
    }
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("/"))
        .to_string_lossy()
        .to_string()
}

#[tauri::command]
fn get_default_file_manager_status() -> bool {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        if let Ok(out) = Command::new("reg")
            .args([
                "query",
                r"HKCU\Software\Classes\Directory\shell\open\command",
                "/ve",
            ])
            .creation_flags(CREATE_NO_WINDOW)
            .output()
        {
            if out.status.success() {
                let s = String::from_utf8_lossy(&out.stdout).to_lowercase();
                return s.contains("nkf");
            }
        }
        false
    }
    #[cfg(target_os = "linux")]
    {
        if let Ok(out) = Command::new("xdg-mime")
            .args(["query", "default", "inode/directory"])
            .output()
        {
            if out.status.success() {
                let s = String::from_utf8_lossy(&out.stdout).trim().to_lowercase();
                return s == "nkf.desktop";
            }
        }
        false
    }
    #[cfg(not(any(target_os = "windows", target_os = "linux")))]
    {
        false
    }
}

#[tauri::command]
fn set_default_file_manager(enable: bool) -> Result<bool, String> {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;

        let keys = [
            r"HKCU\Software\Classes\Directory\shell\open",
            r"HKCU\Software\Classes\Folder\shell\open",
        ];

        if enable {
            let exe = std::env::current_exe().map_err(|e| e.to_string())?;
            let raw = exe.to_string_lossy().to_string();
            let exe_path = raw.strip_prefix(r"\\?\").unwrap_or(&raw);
            let cmd_val = format!("\"{}\" \"%1\"", exe_path);

            for base in keys {
                let cmd_key = format!(r"{}\command", base);
                let st1 = Command::new("reg")
                    .args(["add", &cmd_key, "/ve", "/t", "REG_SZ", "/d", &cmd_val, "/f"])
                    .creation_flags(CREATE_NO_WINDOW)
                    .status()
                    .map_err(|e| e.to_string())?;
                if !st1.success() {
                    return Err(format!("Failed to write registry key {}", cmd_key));
                }
                // Empty DelegateExecute overrides Windows Explorer's shell delegation
                let st2 = Command::new("reg")
                    .args(["add", base, "/v", "DelegateExecute", "/t", "REG_SZ", "/d", "", "/f"])
                    .creation_flags(CREATE_NO_WINDOW)
                    .status()
                    .map_err(|e| e.to_string())?;
                if !st2.success() {
                    return Err(format!("Failed to set DelegateExecute on {}", base));
                }
            }
            Ok(true)
        } else {
            for base in keys {
                let _ = Command::new("reg")
                    .args(["delete", base, "/f"])
                    .creation_flags(CREATE_NO_WINDOW)
                    .status();
            }
            Ok(false)
        }
    }
    #[cfg(target_os = "linux")]
    {
        if enable {
            let st = Command::new("xdg-mime")
                .args(["default", "nkf.desktop", "inode/directory"])
                .status()
                .map_err(|e| e.to_string())?;
            if !st.success() {
                return Err("xdg-mime failed to set nkf.desktop as default".into());
            }
            Ok(true)
        } else {
            let fallbacks = [
                "org.kde.dolphin.desktop",
                "org.gnome.Nautilus.desktop",
                "thunar.desktop",
                "nemo.desktop",
                "pcmanfm.desktop",
            ];
            for fb in fallbacks {
                if PathBuf::from("/usr/share/applications").join(fb).exists() {
                    let _ = Command::new("xdg-mime")
                        .args(["default", fb, "inode/directory"])
                        .status();
                    return Ok(false);
                }
            }
            Ok(false)
        }
    }
    #[cfg(not(any(target_os = "windows", target_os = "linux")))]
    {
        let _ = enable;
        Err("Default file manager switching is supported on Windows and Linux".into())
    }
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

/// Auto-detect mounted/mapped network shares on Windows and Linux
#[tauri::command]
fn get_network_shares() -> Vec<NetworkShareItem> {
    let mut shares = Vec::new();
    let mut seen = std::collections::HashSet::new();

    #[cfg(target_os = "windows")]
    {
        // 1. Parse `net use` for mapped network drives and active UNC connections
        if let Ok(out) = Command::new("net")
            .arg("use")
            .creation_flags(CREATE_NO_WINDOW)
            .output()
        {
            let text = String::from_utf8_lossy(&out.stdout);
            for line in text.lines() {
                if let Some(unc_pos) = line.find("\\\\") {
                    let before = line[..unc_pos].trim();
                    let rest = line[unc_pos..].trim();
                    let unc = rest.split_whitespace().next().unwrap_or("").to_string();
                    if unc.len() < 4 {
                        continue;
                    }
                    // Look for drive letter like "Z:" in `before`
                    let drive = before
                        .split_whitespace()
                        .find(|tok| tok.len() == 2 && tok.ends_with(':'));
                    let (name, path, kind) = if let Some(d) = drive {
                        let leaf = unc.split('\\').filter(|s| !s.is_empty()).last().unwrap_or(&unc);
                        (format!("{} ({})", leaf, d), format!("{}\\", d), "mapped".to_string())
                    } else {
                        let leaf = unc.split('\\').filter(|s| !s.is_empty()).last().unwrap_or(&unc);
                        (leaf.to_string(), unc.clone(), "unc".to_string())
                    };
                    if seen.insert(path.to_lowercase()) {
                        shares.push(NetworkShareItem {
                            name,
                            path,
                            remote: unc,
                            kind,
                        });
                    }
                }
            }
        }

        // 2. Discover local machine's shared folders via `net share`
        if let Ok(out) = Command::new("net")
            .arg("share")
            .creation_flags(CREATE_NO_WINDOW)
            .output()
        {
            let host = std::env::var("COMPUTERNAME").unwrap_or_else(|_| "localhost".to_string());
            let text = String::from_utf8_lossy(&out.stdout);
            for line in text.lines() {
                let trimmed = line.trim();
                if trimmed.is_empty()
                    || trimmed.starts_with('-')
                    || trimmed.starts_with("Share name")
                    || trimmed.starts_with("The command")
                {
                    continue;
                }
                let parts: Vec<&str> = trimmed.split_whitespace().collect();
                if parts.len() >= 2 {
                    let share_name = parts[0];
                    if share_name.ends_with('$') || share_name.eq_ignore_ascii_case("IPC$") {
                        continue;
                    }
                    let unc = format!("\\\\{}\\{}", host, share_name);
                    if seen.insert(unc.to_lowercase()) {
                        shares.push(NetworkShareItem {
                            name: format!("{} (Shared)", share_name),
                            path: unc.clone(),
                            remote: unc,
                            kind: "smb".to_string(),
                        });
                    }
                }
            }
        }
    }

    #[cfg(not(target_os = "windows"))]
    {
        // 1. Parse /proc/mounts for CIFS, SMB, NFS, SSHFS
        if let Ok(mounts) = fs::read_to_string("/proc/mounts") {
            for line in mounts.lines() {
                let cols: Vec<&str> = line.split_whitespace().collect();
                if cols.len() < 3 {
                    continue;
                }
                let remote = cols[0].replace("\\040", " ");
                let mount_point = cols[1].replace("\\040", " ");
                let fstype = cols[2];
                let kind = match fstype {
                    "cifs" | "smb3" | "smbfs" => "smb",
                    "nfs" | "nfs4" => "nfs",
                    "fuse.sshfs" => "sshfs",
                    _ => continue,
                };
                if seen.insert(mount_point.clone()) {
                    let name = Path::new(&mount_point)
                        .file_name()
                        .map(|n| n.to_string_lossy().to_string())
                        .unwrap_or_else(|| mount_point.clone());
                    shares.push(NetworkShareItem {
                        name,
                        path: mount_point,
                        remote,
                        kind: kind.to_string(),
                    });
                }
            }
        }

        // 2. Detect GVFS mounted network shares (/run/user/$UID/gvfs/*)
        if let Ok(xdg_runtime) = std::env::var("XDG_RUNTIME_DIR") {
            let gvfs_dir = PathBuf::from(xdg_runtime).join("gvfs");
            if let Ok(rd) = fs::read_dir(gvfs_dir) {
                for entry in rd.flatten() {
                    let p = entry.path();
                    if p.is_dir() {
                        let raw_name = entry.file_name().to_string_lossy().to_string();
                        let full = p.to_string_lossy().to_string();
                        if seen.insert(full.clone()) {
                            let kind = if raw_name.starts_with("smb") {
                                "smb"
                            } else if raw_name.starts_with("sftp") {
                                "sshfs"
                            } else {
                                "unc"
                            };
                            shares.push(NetworkShareItem {
                                name: raw_name.clone(),
                                path: full,
                                remote: raw_name,
                                kind: kind.to_string(),
                            });
                        }
                    }
                }
            }
        }
    }

    shares
}

/// Connect / map a network share (UNC \\server\share or smb://server/share)
#[tauri::command]
fn connect_network_share(
    share_path: String,
    username: String,
    password: String,
    drive_letter: String,
) -> Result<String, String> {
    let trimmed = share_path.trim();
    if trimmed.is_empty() {
        return Err("Network share path cannot be empty.".to_string());
    }

    #[cfg(target_os = "windows")]
    {
        // Normalize smb://host/share -> \\host\share
        let unc = if trimmed.starts_with("smb://") {
            format!(
                "\\\\{}",
                trimmed.trim_start_matches("smb://").replace('/', "\\")
            )
        } else {
            trimmed.replace('/', "\\")
        };

        let mut cmd = Command::new("net");
        cmd.creation_flags(CREATE_NO_WINDOW);
        cmd.arg("use");

        let mapped_drive = drive_letter.trim().to_uppercase();
        if !mapped_drive.is_empty() && mapped_drive != "AUTO" {
            let d = if mapped_drive.ends_with(':') {
                mapped_drive
            } else {
                format!("{}:", mapped_drive)
            };
            cmd.arg(&d);
            cmd.arg(&unc);
            if !password.is_empty() {
                cmd.arg(&password);
            }
            if !username.is_empty() {
                cmd.arg(format!("/user:{}", username));
            }
            cmd.arg("/persistent:yes");

            let out = cmd.output().map_err(|e| format!("Failed to run net use: {}", e))?;
            if !out.status.success() {
                let err = String::from_utf8_lossy(&out.stderr);
                let stdout = String::from_utf8_lossy(&out.stdout);
                return Err(format!("Could not connect: {} {}", err.trim(), stdout.trim()));
            }
            return Ok(format!("{}\\", d));
        }

        // Direct UNC connection (no drive letter)
        cmd.arg(&unc);
        if !password.is_empty() {
            cmd.arg(&password);
        }
        if !username.is_empty() {
            cmd.arg(format!("/user:{}", username));
        }
        let out = cmd.output().map_err(|e| format!("Failed to run net use: {}", e))?;
        if !out.status.success() {
            // If already accessible anonymously, allow opening directly
            if Path::new(&unc).exists() {
                return Ok(unc);
            }
            let err = String::from_utf8_lossy(&out.stderr);
            let stdout = String::from_utf8_lossy(&out.stdout);
            return Err(format!("Could not connect: {} {}", err.trim(), stdout.trim()));
        }
        Ok(unc)
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = (&username, &password, &drive_letter);
        if Path::new(trimmed).exists() {
            return Ok(trimmed.to_string());
        }
        // Convert \\server\share -> smb://server/share
        let uri = if trimmed.starts_with("\\\\") {
            format!("smb://{}", trimmed.trim_start_matches("\\\\").replace('\\', "/"))
        } else {
            trimmed.to_string()
        };

        let out = Command::new("gio")
            .args(["mount", &uri])
            .output()
            .map_err(|e| format!("Failed to run gio mount (install gvfs-smb): {}", e))?;

        if !out.status.success() {
            let err = String::from_utf8_lossy(&out.stderr);
            return Err(format!("Mount failed: {}", err.trim()));
        }

        // Find newly mounted gvfs path
        if let Ok(xdg_runtime) = std::env::var("XDG_RUNTIME_DIR") {
            let gvfs_dir = PathBuf::from(xdg_runtime).join("gvfs");
            if let Ok(rd) = fs::read_dir(&gvfs_dir) {
                for entry in rd.flatten() {
                    let name = entry.file_name().to_string_lossy().to_lowercase();
                    let host_part = uri
                        .trim_start_matches("smb://")
                        .trim_start_matches("sftp://")
                        .split('/')
                        .next()
                        .unwrap_or("")
                        .to_lowercase();
                    if !host_part.is_empty() && name.contains(&host_part) {
                        return Ok(entry.path().to_string_lossy().to_string());
                    }
                }
            }
        }
        Err("Mounted, but could not locate GVFS mount path.".to_string())
    }
}

#[tauri::command]
fn disconnect_network_share(target: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        let clean = target.trim_end_matches('\\');
        let out = Command::new("net")
            .args(["use", clean, "/delete", "/yes"])
            .creation_flags(CREATE_NO_WINDOW)
            .output()
            .map_err(|e| e.to_string())?;
        if !out.status.success() {
            return Err(String::from_utf8_lossy(&out.stderr).trim().to_string());
        }
        Ok(())
    }

    #[cfg(not(target_os = "windows"))]
    {
        let out = Command::new("gio")
            .args(["mount", "-u", &target])
            .output()
            .map_err(|e| e.to_string())?;
        if !out.status.success() {
            return Err(String::from_utf8_lossy(&out.stderr).trim().to_string());
        }
        Ok(())
    }
}

/// Extract authentic Windows Shell icons (cached in memory as PNG data URLs)
#[cfg(target_os = "windows")]
fn extract_windows_icon_data_url(path: &str, is_dir: bool, ext: &str) -> Option<String> {
    use windows_sys::Win32::Graphics::Gdi::{
        CreateCompatibleDC, DeleteDC, DeleteObject, GetDIBits, GetObjectW, BITMAP, BITMAPINFO,
        BITMAPINFOHEADER, BI_RGB, DIB_RGB_COLORS,
    };
    use windows_sys::Win32::Storage::FileSystem::{FILE_ATTRIBUTE_DIRECTORY, FILE_ATTRIBUTE_NORMAL};
    use windows_sys::Win32::UI::Shell::{
        SHGetFileInfoW, SHFILEINFOW, SHGFI_ICON, SHGFI_LARGEICON, SHGFI_USEFILEATTRIBUTES,
    };
    use windows_sys::Win32::UI::WindowsAndMessaging::{DestroyIcon, GetIconInfo, ICONINFO};

    // Per-file icons for executables/shortcuts/icons; shared cache by extension for everything else
    let unique_per_file = !is_dir && matches!(ext, "exe" | "lnk" | "ico" | "url" | "cur");
    let query_target = if unique_per_file {
        path.to_string()
    } else if is_dir {
        "folder".to_string()
    } else if !ext.is_empty() {
        format!("file.{}", ext)
    } else {
        "file".to_string()
    };

    let mut wide: Vec<u16> = query_target.encode_utf16().chain(std::iter::once(0)).collect();
    let mut shfi: SHFILEINFOW = unsafe { std::mem::zeroed() };
    let attrs = if is_dir {
        FILE_ATTRIBUTE_DIRECTORY
    } else {
        FILE_ATTRIBUTE_NORMAL
    };
    let flags = if unique_per_file {
        SHGFI_ICON | SHGFI_LARGEICON
    } else {
        SHGFI_ICON | SHGFI_LARGEICON | SHGFI_USEFILEATTRIBUTES
    };

    let res = unsafe {
        SHGetFileInfoW(
            wide.as_mut_ptr(),
            attrs,
            &mut shfi,
            std::mem::size_of::<SHFILEINFOW>() as u32,
            flags,
        )
    };
    if res == 0 || shfi.hIcon.is_null() {
        return None;
    }

    let hicon = shfi.hIcon;
    let mut icon_info: ICONINFO = unsafe { std::mem::zeroed() };
    let ok = unsafe { GetIconInfo(hicon, &mut icon_info) };
    if ok == 0 {
        unsafe { DestroyIcon(hicon) };
        return None;
    }

    let hbm = if !icon_info.hbmColor.is_null() {
        icon_info.hbmColor
    } else {
        icon_info.hbmMask
    };

    let mut bmp: BITMAP = unsafe { std::mem::zeroed() };
    let got_bmp = unsafe {
        GetObjectW(
            hbm as _,
            std::mem::size_of::<BITMAP>() as i32,
            &mut bmp as *mut BITMAP as _,
        )
    };

    let mut result_url = None;
    if got_bmp != 0 && bmp.bmWidth > 0 && bmp.bmHeight > 0 {
        let w = bmp.bmWidth as u32;
        let h = bmp.bmHeight.unsigned_abs();
        let mut bi: BITMAPINFO = unsafe { std::mem::zeroed() };
        bi.bmiHeader.biSize = std::mem::size_of::<BITMAPINFOHEADER>() as u32;
        bi.bmiHeader.biWidth = w as i32;
        bi.bmiHeader.biHeight = -(h as i32); // top-down
        bi.bmiHeader.biPlanes = 1;
        bi.bmiHeader.biBitCount = 32;
        bi.bmiHeader.biCompression = BI_RGB;

        let mut pixels = vec![0u8; (w * h * 4) as usize];
        let hdc = unsafe { CreateCompatibleDC(std::ptr::null_mut()) };
        if !hdc.is_null() {
            let lines = unsafe {
                GetDIBits(
                    hdc,
                    hbm,
                    0,
                    h,
                    pixels.as_mut_ptr() as _,
                    &mut bi,
                    DIB_RGB_COLORS,
                )
            };
            unsafe { DeleteDC(hdc) };

            if lines > 0 {
                // Convert BGRA -> RGBA and handle icons without alpha channel
                let mut any_alpha = false;
                for chunk in pixels.chunks_exact_mut(4) {
                    chunk.swap(0, 2);
                    if chunk[3] != 0 {
                        any_alpha = true;
                    }
                }
                if !any_alpha {
                    for chunk in pixels.chunks_exact_mut(4) {
                        chunk[3] = 255;
                    }
                }

                let mut png_buf = Vec::new();
                let mut encoded_ok = false;
                {
                    let mut encoder = png::Encoder::new(&mut png_buf, w, h);
                    encoder.set_color(png::ColorType::Rgba);
                    encoder.set_depth(png::BitDepth::Eight);
                    if let Ok(mut writer) = encoder.write_header() {
                        if writer.write_image_data(&pixels).is_ok() {
                            encoded_ok = true;
                        }
                    }
                }
                if encoded_ok {
                    let b64 = base64::engine::general_purpose::STANDARD.encode(&png_buf);
                    result_url = Some(format!("data:image/png;base64,{}", b64));
                }
            }
        }
    }

    unsafe {
        if !icon_info.hbmColor.is_null() {
            DeleteObject(icon_info.hbmColor as _);
        }
        if !icon_info.hbmMask.is_null() {
            DeleteObject(icon_info.hbmMask as _);
        }
        DestroyIcon(hicon);
    }

    result_url
}

#[tauri::command]
fn get_native_icon(path: String, is_dir: bool, extension: String) -> Option<String> {
    #[cfg(target_os = "windows")]
    {
        let ext = extension.to_lowercase();
        let unique = !is_dir && matches!(ext.as_str(), "exe" | "lnk" | "ico" | "url" | "cur");
        let cache_key = if unique {
            format!("path:{}", path)
        } else if is_dir {
            "dir".to_string()
        } else {
            format!("ext:{}", ext)
        };

        if let Ok(guard) = ICON_CACHE.lock() {
            if let Some(cached) = guard.get(&cache_key) {
                return cached.clone();
            }
        }

        let extracted = extract_windows_icon_data_url(&path, is_dir, &ext);
        if let Ok(mut guard) = ICON_CACHE.lock() {
            guard.insert(cache_key, extracted.clone());
        }
        extracted
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = (&path, is_dir, &extension, &ICON_CACHE);
        None
    }
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

fn calc_sources_total_bytes(sources: &[String]) -> u64 {
    let mut total = 0u64;
    for s in sources {
        let p = Path::new(s);
        if p.is_dir() {
            for e in WalkDir::new(p).into_iter().flatten() {
                if let Ok(m) = e.metadata() {
                    if m.is_file() {
                        total += m.len();
                    }
                }
            }
        } else if let Ok(m) = fs::metadata(p) {
            total += m.len();
        }
    }
    total
}

fn copy_file_streamed(
    src: &Path,
    dst: &Path,
    app: &tauri::AppHandle,
    op: &str,
    bytes_done: &mut u64,
    bytes_total: u64,
    started: Instant,
    last_emit: &mut Instant,
) -> Result<(), String> {
    let mut reader = File::open(src).map_err(|e| e.to_string())?;
    let mut writer = File::create(dst).map_err(|e| e.to_string())?;
    let mut buf = vec![0u8; 256 * 1024];
    let fname = src
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_default();

    loop {
        let n = reader.read(&mut buf).map_err(|e| e.to_string())?;
        if n == 0 {
            break;
        }
        writer.write_all(&buf[..n]).map_err(|e| e.to_string())?;
        *bytes_done += n as u64;

        if last_emit.elapsed().as_millis() >= 80 {
            let elapsed = started.elapsed().as_secs_f64().max(0.001);
            let speed_bps = (*bytes_done as f64 / elapsed) as u64;
            let _ = app.emit(
                "nkf://transfer-progress",
                TransferProgress {
                    operation: op.to_string(),
                    current_file: fname.clone(),
                    bytes_done: *bytes_done,
                    bytes_total,
                    speed_bps,
                    done: false,
                },
            );
            *last_emit = Instant::now();
        }
    }
    Ok(())
}

fn copy_recursive_streamed(
    src: &Path,
    dst: &Path,
    app: &tauri::AppHandle,
    op: &str,
    bytes_done: &mut u64,
    bytes_total: u64,
    started: Instant,
    last_emit: &mut Instant,
) -> Result<(), String> {
    if src.is_dir() {
        fs::create_dir_all(dst).map_err(|e| e.to_string())?;
        for entry in fs::read_dir(src).map_err(|e| e.to_string())?.flatten() {
            let child_src = entry.path();
            let child_dst = dst.join(entry.file_name());
            copy_recursive_streamed(
                &child_src,
                &child_dst,
                app,
                op,
                bytes_done,
                bytes_total,
                started,
                last_emit,
            )?;
        }
    } else {
        copy_file_streamed(src, dst, app, op, bytes_done, bytes_total, started, last_emit)?;
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
async fn copy_items(
    app: tauri::AppHandle,
    sources: Vec<String>,
    dest_dir: String,
) -> Result<usize, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let dest = PathBuf::from(&dest_dir);
        let bytes_total = calc_sources_total_bytes(&sources);
        let mut bytes_done = 0u64;
        let started = Instant::now();
        let mut last_emit = Instant::now();
        let mut count = 0;

        for s in sources {
            let src = PathBuf::from(&s);
            let Some(name) = src.file_name() else { continue };
            let target = unique_dest(&dest, &name.to_string_lossy());
            copy_recursive_streamed(
                &src,
                &target,
                &app,
                "copy",
                &mut bytes_done,
                bytes_total,
                started,
                &mut last_emit,
            )?;
            count += 1;
        }

        let _ = app.emit(
            "nkf://transfer-progress",
            TransferProgress {
                operation: "copy".to_string(),
                current_file: String::new(),
                bytes_done: bytes_total,
                bytes_total,
                speed_bps: 0,
                done: true,
            },
        );
        Ok(count)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn move_items(
    app: tauri::AppHandle,
    sources: Vec<String>,
    dest_dir: String,
) -> Result<usize, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let dest = PathBuf::from(&dest_dir);
        let bytes_total = calc_sources_total_bytes(&sources);
        let mut bytes_done = 0u64;
        let started = Instant::now();
        let mut last_emit = Instant::now();
        let mut count = 0;

        for s in sources {
            let src = PathBuf::from(&s);
            let Some(name) = src.file_name() else { continue };
            let target = unique_dest(&dest, &name.to_string_lossy());
            if fs::rename(&src, &target).is_err() {
                copy_recursive_streamed(
                    &src,
                    &target,
                    &app,
                    "move",
                    &mut bytes_done,
                    bytes_total,
                    started,
                    &mut last_emit,
                )?;
                if src.is_dir() {
                    fs::remove_dir_all(&src).map_err(|e| e.to_string())?;
                } else {
                    fs::remove_file(&src).map_err(|e| e.to_string())?;
                }
            }
            count += 1;
        }

        let _ = app.emit(
            "nkf://transfer-progress",
            TransferProgress {
                operation: "move".to_string(),
                current_file: String::new(),
                bytes_done: bytes_total,
                bytes_total,
                speed_bps: 0,
                done: true,
            },
        );
        Ok(count)
    })
    .await
    .map_err(|e| e.to_string())?
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
fn open_with_dialog(path: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        Command::new("rundll32.exe")
            .args(["shell32.dll,OpenAs_RunDLL", &path])
            .creation_flags(CREATE_NO_WINDOW)
            .spawn()
            .map_err(|e| e.to_string())?;
        Ok(())
    }
    #[cfg(not(target_os = "windows"))]
    {
        open_with_default(path)
    }
}

#[tauri::command]
fn reveal_in_system(path: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        Command::new("explorer.exe")
            .arg(format!("/select,{}", path))
            .spawn()
            .map_err(|e| e.to_string())?;
        Ok(())
    }
    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .args(["-R", &path])
            .spawn()
            .map_err(|e| e.to_string())?;
        Ok(())
    }
    #[cfg(target_os = "linux")]
    {
        let p = PathBuf::from(&path);
        let dir = if p.is_dir() {
            p
        } else {
            p.parent().map(|pp| pp.to_path_buf()).unwrap_or(p)
        };
        Command::new("xdg-open")
            .arg(dir)
            .spawn()
            .map_err(|e| e.to_string())?;
        Ok(())
    }
}

#[tauri::command]
fn open_system_properties(path: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        let p = PathBuf::from(&path);
        let parent = p
            .parent()
            .map(|d| d.to_string_lossy().to_string())
            .unwrap_or_default();
        let name = p
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_default();
        let esc = |s: &str| s.replace('\'', "''");
        let ps = format!(
            "$sh = New-Object -ComObject Shell.Application; $f = $sh.NameSpace('{}'); if ($f) {{ $i = $f.ParseName('{}'); if ($i) {{ $i.InvokeVerb('Properties'); Start-Sleep -Seconds 30 }} }}",
            esc(&parent),
            esc(&name)
        );
        Command::new("powershell.exe")
            .args(["-NoProfile", "-WindowStyle", "Hidden", "-Command", &ps])
            .creation_flags(CREATE_NO_WINDOW)
            .spawn()
            .map_err(|e| e.to_string())?;
        Ok(())
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = path;
        Err("Native Windows Properties sheet is only available on Windows".into())
    }
}

#[tauri::command]
fn open_with_default(path: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    let res = Command::new("cmd")
        .args(["/C", "start", "", &path])
        .creation_flags(CREATE_NO_WINDOW)
        .spawn();
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

fn hash_file_sha256(path: &Path) -> Result<String, String> {
    let mut file = File::open(path).map_err(|e| e.to_string())?;
    let mut hasher = Sha256::new();
    let mut buf = [0u8; 65536];
    loop {
        let n = file.read(&mut buf).map_err(|e| e.to_string())?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
    }
    let digest = hasher.finalize();
    Ok(digest.iter().map(|b| format!("{:02x}", b)).collect())
}

#[tauri::command]
fn get_image_thumb(path: String) -> Option<String> {
    let p = PathBuf::from(&path);
    let meta = fs::metadata(&p).ok()?;
    if meta.is_dir() || meta.len() > 8 * 1024 * 1024 {
        return None;
    }
    let ext = p
        .extension()
        .map(|e| e.to_string_lossy().to_lowercase())
        .unwrap_or_default();
    let mime = match ext.as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "webp" => "image/webp",
        "gif" => "image/gif",
        "svg" => "image/svg+xml",
        "bmp" => "image/bmp",
        _ => return None,
    };
    let bytes = fs::read(&p).ok()?;
    let b64 = base64::engine::general_purpose::STANDARD.encode(bytes);
    Some(format!("data:{};base64,{}", mime, b64))
}

#[tauri::command]
fn find_duplicates(root_dirs: Vec<String>) -> Result<Vec<DuplicateGroup>, String> {
    let mut by_size: HashMap<u64, Vec<PathBuf>> = HashMap::new();
    let mut seen_paths: std::collections::HashSet<PathBuf> = std::collections::HashSet::new();

    for root_dir in root_dirs {
        if root_dir.trim().is_empty() {
            continue;
        }
        for entry in WalkDir::new(&root_dir)
            .max_depth(8)
            .into_iter()
            .filter_entry(|e| {
                let name = e.file_name().to_string_lossy();
                !(name == ".git" || name == "node_modules" || name == "target")
            })
            .flatten()
        {
            if !entry.file_type().is_file() {
                continue;
            }
            let Ok(meta) = entry.metadata() else { continue };
            let size = meta.len();
            if size == 0 {
                continue;
            }
            let p = entry.into_path();
            let dedup_key = fs::canonicalize(&p).unwrap_or_else(|_| p.clone());
            if !seen_paths.insert(dedup_key) {
                continue;
            }
            by_size.entry(size).or_default().push(p);
        }
    }

    let mut by_hash: HashMap<String, (u64, Vec<FileEntry>)> = HashMap::new();
    for (size, paths) in by_size {
        if paths.len() < 2 {
            continue;
        }
        for p in paths {
            if let Ok(hash) = hash_file_sha256(&p) {
                if let Some(fe) = entry_from_path(&p) {
                    by_hash
                        .entry(hash)
                        .or_insert_with(|| (size, Vec::new()))
                        .1
                        .push(fe);
                }
            }
        }
    }

    let mut groups: Vec<DuplicateGroup> = by_hash
        .into_iter()
        .filter(|(_, (_, files))| files.len() >= 2)
        .map(|(hash, (size, files))| {
            let wasted_bytes = size.saturating_mul((files.len() - 1) as u64);
            DuplicateGroup {
                hash,
                size,
                wasted_bytes,
                files,
            }
        })
        .collect();

    groups.sort_by(|a, b| b.wasted_bytes.cmp(&a.wasted_bytes));
    Ok(groups)
}

#[tauri::command]
fn get_file_properties(path: String, compute_hash: bool) -> Result<FileProperties, String> {
    let p = PathBuf::from(&path);
    let meta = fs::metadata(&p).map_err(|e| e.to_string())?;
    let name = p
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| path.clone());
    let is_dir = meta.is_dir();

    let (size, item_count) = if is_dir {
        let mut total = 0u64;
        let mut count = 0usize;
        for entry in WalkDir::new(&p).into_iter().flatten().skip(1) {
            count += 1;
            if let Ok(m) = entry.metadata() {
                if m.is_file() {
                    total += m.len();
                }
            }
        }
        (total, count)
    } else {
        (meta.len(), 1)
    };

    let modified_ms = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);
    let created_ms = meta
        .created()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);

    let sha256 = if !is_dir && compute_hash {
        hash_file_sha256(&p).ok()
    } else {
        None
    };

    Ok(FileProperties {
        name,
        path,
        is_dir,
        size,
        item_count,
        modified_ms,
        created_ms,
        readonly: meta.permissions().readonly(),
        sha256,
    })
}

#[tauri::command]
fn write_text_file(path: String, content: String) -> Result<(), String> {
    fs::write(&path, content.as_bytes()).map_err(|e| format!("Failed to save file: {}", e))
}

#[tauri::command]
fn get_git_branch(dir: String) -> Option<String> {
    let mut cur = PathBuf::from(&dir);
    for _ in 0..8 {
        let head = cur.join(".git").join("HEAD");
        if head.is_file() {
            if let Ok(content) = fs::read_to_string(&head) {
                let line = content.trim();
                if let Some(branch) = line.strip_prefix("ref: refs/heads/") {
                    return Some(branch.to_string());
                }
                if line.len() >= 7 {
                    return Some(line[..7].to_string());
                }
            }
            return None;
        }
        if !cur.pop() {
            break;
        }
    }
    None
}

#[tauri::command]
fn compare_folders(left_dir: String, right_dir: String) -> Result<Vec<CompareItem>, String> {
    let left_entries = list_directory(left_dir, true)?;
    let right_entries = list_directory(right_dir, true)?;

    let mut left_map: HashMap<String, FileEntry> = HashMap::new();
    for e in left_entries {
        left_map.insert(e.name.clone(), e);
    }
    let mut right_map: HashMap<String, FileEntry> = HashMap::new();
    for e in right_entries {
        right_map.insert(e.name.clone(), e);
    }

    let mut all_names: Vec<String> = left_map
        .keys()
        .chain(right_map.keys())
        .cloned()
        .collect::<std::collections::HashSet<_>>()
        .into_iter()
        .collect();
    all_names.sort_by_key(|a| a.to_lowercase());

    let mut items = Vec::new();
    for name in all_names {
        match (left_map.get(&name), right_map.get(&name)) {
            (Some(l), None) => items.push(CompareItem {
                name,
                status: "only_left".to_string(),
                left_path: Some(l.path.clone()),
                right_path: None,
                left_size: l.size,
                right_size: 0,
                is_dir: l.is_dir,
            }),
            (None, Some(r)) => items.push(CompareItem {
                name,
                status: "only_right".to_string(),
                left_path: None,
                right_path: Some(r.path.clone()),
                left_size: 0,
                right_size: r.size,
                is_dir: r.is_dir,
            }),
            (Some(l), Some(r)) => {
                let status = if l.is_dir != r.is_dir || (!l.is_dir && l.size != r.size) {
                    "different"
                } else {
                    "same"
                };
                items.push(CompareItem {
                    name,
                    status: status.to_string(),
                    left_path: Some(l.path.clone()),
                    right_path: Some(r.path.clone()),
                    left_size: l.size,
                    right_size: r.size,
                    is_dir: l.is_dir,
                });
            }
            (None, None) => {}
        }
    }

    Ok(items)
}

pub fn run_mcp_server() {
    mcp::run_mcp_stdio();
}

pub(crate) fn mcp_list_directory(path: String, show_hidden: bool) -> Result<serde_json::Value, String> {
    let items = list_directory(path, show_hidden)?;
    serde_json::to_value(items).map_err(|e| e.to_string())
}

pub(crate) fn mcp_search_files(
    root_dir: String,
    query: String,
    max_results: usize,
) -> Result<serde_json::Value, String> {
    let items = search_files(root_dir, query, max_results)?;
    serde_json::to_value(items).map_err(|e| e.to_string())
}

pub(crate) fn mcp_find_duplicates(root_dirs: Vec<String>) -> Result<serde_json::Value, String> {
    let items = find_duplicates(root_dirs)?;
    serde_json::to_value(items).map_err(|e| e.to_string())
}

pub(crate) fn mcp_compute_folder_sizes(dir: String) -> Result<serde_json::Value, String> {
    let items = compute_folder_sizes(dir)?;
    serde_json::to_value(items).map_err(|e| e.to_string())
}

pub(crate) fn mcp_compare_folders(
    left_dir: String,
    right_dir: String,
) -> Result<serde_json::Value, String> {
    let items = compare_folders(left_dir, right_dir)?;
    serde_json::to_value(items).map_err(|e| e.to_string())
}

pub(crate) fn mcp_get_file_properties(
    path: String,
    compute_hash: bool,
) -> Result<serde_json::Value, String> {
    let item = get_file_properties(path, compute_hash)?;
    serde_json::to_value(item).map_err(|e| e.to_string())
}

pub(crate) fn mcp_read_preview(path: String) -> Result<serde_json::Value, String> {
    let item = read_preview(path)?;
    serde_json::to_value(item).map_err(|e| e.to_string())
}

pub(crate) fn mcp_create_folder(
    parent_dir: String,
    name: String,
) -> Result<serde_json::Value, String> {
    let created = create_folder(parent_dir, name)?;
    Ok(serde_json::json!({ "created": created }))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(pty::PtyState::default())
        .invoke_handler(tauri::generate_handler![
            get_platform,
            get_username,
            get_initial_dir,
            get_system_places,
            get_network_shares,
            connect_network_share,
            disconnect_network_share,
            get_native_icon,
            get_image_thumb,
            find_duplicates,
            get_file_properties,
            write_text_file,
            get_git_branch,
            compare_folders,
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
            open_with_dialog,
            reveal_in_system,
            open_system_properties,
            open_terminal_here,
            get_omarchy_theme,
            open_external_url,
            get_default_file_manager_status,
            set_default_file_manager,
            pty::pty_spawn,
            pty::pty_write,
            pty::pty_resize,
            pty::pty_close,
            mcp::get_mcp_config_json,
            mcp::save_live_state
        ])
        .run(tauri::generate_context!())
        .expect("error while running NKF");
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn test_list_create_rename_and_hidden() {
        let dir = tempdir().unwrap();
        let root = dir.path().to_string_lossy().to_string();

        create_folder(root.clone(), "zeta_folder".into()).unwrap();
        create_file(root.clone(), "alpha.txt".into()).unwrap();
        create_file(root.clone(), ".secret".into()).unwrap();

        let visible = list_directory(root.clone(), false).unwrap();
        assert_eq!(visible.len(), 2);
        // Directories must come before files
        assert!(visible[0].is_dir);
        assert_eq!(visible[0].name, "zeta_folder");
        assert_eq!(visible[1].name, "alpha.txt");

        let all = list_directory(root.clone(), true).unwrap();
        assert_eq!(all.len(), 3);

        let renamed = rename_item(visible[1].path.clone(), "beta.txt".into()).unwrap();
        assert!(Path::new(&renamed).exists());
    }

    #[test]
    fn test_batch_rename() {
        let dir = tempdir().unwrap();
        let p1 = create_file(dir.path().to_string_lossy().into(), "img_1.txt".into()).unwrap();
        let p2 = create_file(dir.path().to_string_lossy().into(), "img_2.txt".into()).unwrap();

        let count = batch_rename(vec![
            (p1, "photo_001.txt".into()),
            (p2, "photo_002.txt".into()),
        ])
        .unwrap();
        assert_eq!(count, 2);
        assert!(dir.path().join("photo_001.txt").exists());
        assert!(dir.path().join("photo_002.txt").exists());
    }

    #[test]
    fn test_zip_compress_and_extract_roundtrip() {
        let dir = tempdir().unwrap();
        let src_file = dir.path().join("hello.txt");
        fs::write(&src_file, b"NightKnight Files ZIP test!").unwrap();

        let zip_path = dir.path().join("test.zip").to_string_lossy().to_string();
        compress_to_zip(vec![src_file.to_string_lossy().to_string()], zip_path.clone()).unwrap();
        assert!(Path::new(&zip_path).exists());

        let out_dir = dir.path().join("extracted");
        let extracted = extract_zip(zip_path, out_dir.to_string_lossy().to_string()).unwrap();
        assert_eq!(extracted, 1);
        assert_eq!(
            fs::read_to_string(out_dir.join("hello.txt")).unwrap(),
            "NightKnight Files ZIP test!"
        );
    }

    #[test]
    fn test_find_duplicates_sha256() {
        let dir = tempdir().unwrap();
        fs::write(dir.path().join("a.bin"), b"duplicate payload 12345").unwrap();
        fs::write(dir.path().join("b.bin"), b"duplicate payload 12345").unwrap();
        fs::write(dir.path().join("unique.bin"), b"totally different").unwrap();

        let dir_str = dir.path().to_string_lossy().to_string();
        let groups = find_duplicates(vec![dir_str.clone(), dir_str]).unwrap();
        assert_eq!(groups.len(), 1);
        assert_eq!(groups[0].files.len(), 2);
        assert_eq!(groups[0].wasted_bytes, 23);
    }

    #[test]
    fn test_disk_usage_and_properties_and_quick_edit() {
        let dir = tempdir().unwrap();
        let f = dir.path().join("notes.md");
        write_text_file(f.to_string_lossy().to_string(), "# NKF Rocks".into()).unwrap();

        let preview = read_preview(f.to_string_lossy().to_string()).unwrap();
        assert_eq!(preview.kind, "text");
        assert_eq!(preview.content, "# NKF Rocks");

        let props = get_file_properties(f.to_string_lossy().to_string(), true).unwrap();
        assert_eq!(props.size, 11);
        assert!(props.sha256.is_some());
        assert_eq!(props.sha256.unwrap().len(), 64);

        let usage = compute_folder_sizes(dir.path().to_string_lossy().to_string()).unwrap();
        assert_eq!(usage.len(), 1);
        assert_eq!(usage[0].size, 11);
    }

    #[test]
    fn test_compare_folders_and_git_branch() {
        let d1 = tempdir().unwrap();
        let d2 = tempdir().unwrap();
        fs::write(d1.path().join("shared.txt"), b"same").unwrap();
        fs::write(d2.path().join("shared.txt"), b"same").unwrap();
        fs::write(d1.path().join("diff.txt"), b"short").unwrap();
        fs::write(d2.path().join("diff.txt"), b"much longer").unwrap();
        fs::write(d1.path().join("left_only.txt"), b"L").unwrap();
        fs::write(d2.path().join("right_only.txt"), b"R").unwrap();

        let diff = compare_folders(
            d1.path().to_string_lossy().to_string(),
            d2.path().to_string_lossy().to_string(),
        )
        .unwrap();
        let map: HashMap<String, String> = diff.into_iter().map(|i| (i.name, i.status)).collect();
        assert_eq!(map.get("shared.txt").map(String::as_str), Some("same"));
        assert_eq!(map.get("diff.txt").map(String::as_str), Some("different"));
        assert_eq!(map.get("left_only.txt").map(String::as_str), Some("only_left"));
        assert_eq!(map.get("right_only.txt").map(String::as_str), Some("only_right"));

        // Test git branch detection
        let git_dir = d1.path().join(".git");
        fs::create_dir(&git_dir).unwrap();
        fs::write(git_dir.join("HEAD"), "ref: refs/heads/feature/nkf\n").unwrap();
        assert_eq!(
            get_git_branch(d1.path().to_string_lossy().to_string()),
            Some("feature/nkf".to_string())
        );
    }
}
