use serde_json::{json, Value};
use std::io::{self, BufRead, Write};
use std::path::PathBuf;

pub fn live_state_path() -> PathBuf {
    let base = dirs::data_local_dir().unwrap_or_else(std::env::temp_dir);
    let dir = base.join("nkf");
    let _ = std::fs::create_dir_all(&dir);
    dir.join("live_state.json")
}

#[tauri::command]
pub fn save_live_state(state_json: String) -> Result<(), String> {
    std::fs::write(live_state_path(), state_json).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_mcp_config_json() -> Result<String, String> {
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let raw = exe.to_string_lossy().to_string();
    let exe_str = raw.strip_prefix(r"\\?\").unwrap_or(&raw).to_string();
    let cfg = json!({
        "mcpServers": {
            "nkf": {
                "command": exe_str,
                "args": ["--mcp"]
            }
        }
    });
    serde_json::to_string_pretty(&cfg).map_err(|e| e.to_string())
}

fn tool_definitions() -> Value {
    json!([
        {
            "name": "nkf_get_state",
            "description": "Read the live state of the open NKF file manager window (active left/right pane folders, split mode, and currently selected file paths).",
            "inputSchema": { "type": "object", "properties": {} }
        },
        {
            "name": "nkf_list_dir",
            "description": "List files and folders inside a directory.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "path": { "type": "string", "description": "Absolute directory path" },
                    "show_hidden": { "type": "boolean", "default": false }
                },
                "required": ["path"]
            }
        },
        {
            "name": "nkf_search_files",
            "description": "Recursively search for files/folders by substring match.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "root_dir": { "type": "string" },
                    "query": { "type": "string" },
                    "show_hidden": { "type": "boolean", "default": false }
                },
                "required": ["root_dir", "query"]
            }
        },
        {
            "name": "nkf_find_duplicates",
            "description": "Find exact SHA-256 duplicate files across one or more directories.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "root_dirs": {
                        "type": "array",
                        "items": { "type": "string" },
                        "description": "List of folder paths to scan"
                    }
                },
                "required": ["root_dirs"]
            }
        },
        {
            "name": "nkf_disk_usage",
            "description": "Compute disk usage breakdown of immediate items inside a folder.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "dir": { "type": "string" }
                },
                "required": ["dir"]
            }
        },
        {
            "name": "nkf_compare_folders",
            "description": "Compare two directories and report left-only, right-only, modified, and identical entries.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "left_dir": { "type": "string" },
                    "right_dir": { "type": "string" }
                },
                "required": ["left_dir", "right_dir"]
            }
        },
        {
            "name": "nkf_file_properties",
            "description": "Inspect file or folder metadata and optional SHA-256 checksum.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "path": { "type": "string" },
                    "compute_hash": { "type": "boolean", "default": false }
                },
                "required": ["path"]
            }
        },
        {
            "name": "nkf_read_preview",
            "description": "Read a text preview of a file.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "path": { "type": "string" }
                },
                "required": ["path"]
            }
        },
        {
            "name": "nkf_create_folder",
            "description": "Create a new folder inside parent_dir.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "parent_dir": { "type": "string" },
                    "name": { "type": "string" }
                },
                "required": ["parent_dir", "name"]
            }
        }
    ])
}

pub fn handle_mcp_request(req: &Value) -> Option<Value> {
    let method = req.get("method").and_then(|v| v.as_str()).unwrap_or("");
    let id = req.get("id").cloned();

    // Notifications (no id) get no response
    if id.is_none() {
        return None;
    }
    let id = id.unwrap();

    match method {
        "initialize" => Some(json!({
            "jsonrpc": "2.0",
            "id": id,
            "result": {
                "protocolVersion": "2024-11-05",
                "capabilities": { "tools": {} },
                "serverInfo": {
                    "name": "nkf-mcp",
                    "version": env!("CARGO_PKG_VERSION")
                }
            }
        })),
        "ping" => Some(json!({ "jsonrpc": "2.0", "id": id, "result": {} })),
        "tools/list" => Some(json!({
            "jsonrpc": "2.0",
            "id": id,
            "result": { "tools": tool_definitions() }
        })),
        "tools/call" => {
            let params = req.get("params").cloned().unwrap_or_else(|| json!({}));
            let name = params.get("name").and_then(|v| v.as_str()).unwrap_or("");
            let args = params.get("arguments").cloned().unwrap_or_else(|| json!({}));

            let call_res: Result<Value, String> = match name {
                "nkf_get_state" => {
                    let p = live_state_path();
                    match std::fs::read_to_string(&p) {
                        Ok(s) => serde_json::from_str(&s).or_else(|_| Ok(json!({ "raw": s }))),
                        Err(_) => Ok(json!({
                            "status": "no_active_window_state",
                            "note": "Open NKF GUI to publish live pane & selection state."
                        })),
                    }
                }
                "nkf_list_dir" => {
                    let path = args.get("path").and_then(|v| v.as_str()).unwrap_or("").to_string();
                    let show_hidden = args.get("show_hidden").and_then(|v| v.as_bool()).unwrap_or(false);
                    crate::mcp_list_directory(path, show_hidden)
                }
                "nkf_search_files" => {
                    let root_dir = args.get("root_dir").and_then(|v| v.as_str()).unwrap_or("").to_string();
                    let query = args.get("query").and_then(|v| v.as_str()).unwrap_or("").to_string();
                    let max_results = args.get("max_results").and_then(|v| v.as_u64()).unwrap_or(100) as usize;
                    crate::mcp_search_files(root_dir, query, max_results)
                }
                "nkf_find_duplicates" => {
                    let dirs: Vec<String> = args
                        .get("root_dirs")
                        .and_then(|v| v.as_array())
                        .map(|arr| {
                            arr.iter()
                                .filter_map(|x| x.as_str().map(|s| s.to_string()))
                                .collect()
                        })
                        .unwrap_or_default();
                    crate::mcp_find_duplicates(dirs)
                }
                "nkf_disk_usage" => {
                    let dir = args.get("dir").and_then(|v| v.as_str()).unwrap_or("").to_string();
                    crate::mcp_compute_folder_sizes(dir)
                }
                "nkf_compare_folders" => {
                    let left_dir = args.get("left_dir").and_then(|v| v.as_str()).unwrap_or("").to_string();
                    let right_dir = args.get("right_dir").and_then(|v| v.as_str()).unwrap_or("").to_string();
                    crate::mcp_compare_folders(left_dir, right_dir)
                }
                "nkf_file_properties" => {
                    let path = args.get("path").and_then(|v| v.as_str()).unwrap_or("").to_string();
                    let compute_hash = args.get("compute_hash").and_then(|v| v.as_bool()).unwrap_or(false);
                    crate::mcp_get_file_properties(path, compute_hash)
                }
                "nkf_read_preview" => {
                    let path = args.get("path").and_then(|v| v.as_str()).unwrap_or("").to_string();
                    crate::mcp_read_preview(path)
                }
                "nkf_create_folder" => {
                    let parent_dir = args.get("parent_dir").and_then(|v| v.as_str()).unwrap_or("").to_string();
                    let folder_name = args.get("name").and_then(|v| v.as_str()).unwrap_or("").to_string();
                    crate::mcp_create_folder(parent_dir, folder_name)
                }
                _ => Err(format!("Unknown NKF MCP tool: {}", name)),
            };

            match call_res {
                Ok(val) => {
                    let text = serde_json::to_string_pretty(&val).unwrap_or_else(|_| "{}".into());
                    Some(json!({
                        "jsonrpc": "2.0",
                        "id": id,
                        "result": {
                            "content": [{ "type": "text", "text": text }],
                            "isError": false
                        }
                    }))
                }
                Err(err) => Some(json!({
                    "jsonrpc": "2.0",
                    "id": id,
                    "result": {
                        "content": [{ "type": "text", "text": err }],
                        "isError": true
                    }
                })),
            }
        }
        _ => Some(json!({
            "jsonrpc": "2.0",
            "id": id,
            "error": { "code": -32601, "message": format!("Method not found: {}", method) }
        })),
    }
}

pub fn run_mcp_stdio() {
    let stdin = io::stdin();
    let mut stdout = io::stdout();
    for line in stdin.lock().lines() {
        let Ok(line) = line else { break };
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        let Ok(req) = serde_json::from_str::<Value>(trimmed) else {
            let err = json!({
                "jsonrpc": "2.0",
                "id": null,
                "error": { "code": -32700, "message": "Parse error" }
            });
            let _ = writeln!(stdout, "{}", err);
            let _ = stdout.flush();
            continue;
        };
        if let Some(resp) = handle_mcp_request(&req) {
            let _ = writeln!(stdout, "{}", resp);
            let _ = stdout.flush();
        }
    }
}
