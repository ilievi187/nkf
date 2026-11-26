use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};
use std::io::{Read, Write};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, State};

struct PtySession {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
}

#[derive(Default)]
pub struct PtyState {
    session: Arc<Mutex<Option<PtySession>>>,
}

#[tauri::command]
pub fn pty_spawn(
    app: AppHandle,
    state: State<'_, PtyState>,
    cwd: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    // Close any existing session first
    {
        let mut guard = state.session.lock().map_err(|e| e.to_string())?;
        *guard = None;
    }

    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize {
            rows: rows.max(4),
            cols: cols.max(20),
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| format!("Failed to open PTY: {}", e))?;

    #[cfg(target_os = "windows")]
    let mut cmd = {
        let mut c = CommandBuilder::new("powershell.exe");
        c.arg("-NoLogo");
        c
    };

    #[cfg(not(target_os = "windows"))]
    let mut cmd = {
        let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/bash".into());
        let mut c = CommandBuilder::new(shell);
        c.env("TERM", "xterm-256color");
        c.env("COLORTERM", "truecolor");
        c
    };

    if !cwd.trim().is_empty() && std::path::Path::new(&cwd).is_dir() {
        cmd.cwd(&cwd);
    }

    let _child = pair
        .slave
        .spawn_command(cmd)
        .map_err(|e| format!("Failed to spawn shell: {}", e))?;

    let mut reader = pair
        .master
        .try_clone_reader()
        .map_err(|e| format!("Failed to clone PTY reader: {}", e))?;
    let writer = pair
        .master
        .take_writer()
        .map_err(|e| format!("Failed to take PTY writer: {}", e))?;

    {
        let mut guard = state.session.lock().map_err(|e| e.to_string())?;
        *guard = Some(PtySession {
            master: pair.master,
            writer,
        });
    }

    std::thread::spawn(move || {
        let mut buf = [0u8; 4096];
        loop {
            match reader.read(&mut buf) {
                Ok(0) => {
                    let _ = app.emit("pty-exit", ());
                    break;
                }
                Ok(n) => {
                    let text = String::from_utf8_lossy(&buf[..n]).to_string();
                    let _ = app.emit("pty-output", text);
                }
                Err(_) => {
                    let _ = app.emit("pty-exit", ());
                    break;
                }
            }
        }
    });

    Ok(())
}

#[tauri::command]
pub fn pty_write(state: State<'_, PtyState>, data: String) -> Result<(), String> {
    let mut guard = state.session.lock().map_err(|e| e.to_string())?;
    if let Some(sess) = guard.as_mut() {
        sess.writer
            .write_all(data.as_bytes())
            .map_err(|e| e.to_string())?;
        sess.writer.flush().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn pty_resize(state: State<'_, PtyState>, cols: u16, rows: u16) -> Result<(), String> {
    let guard = state.session.lock().map_err(|e| e.to_string())?;
    if let Some(sess) = guard.as_ref() {
        sess.master
            .resize(PtySize {
                rows: rows.max(4),
                cols: cols.max(20),
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn pty_close(state: State<'_, PtyState>) -> Result<(), String> {
    let mut guard = state.session.lock().map_err(|e| e.to_string())?;
    *guard = None;
    Ok(())
}
