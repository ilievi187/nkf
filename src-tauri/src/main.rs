#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    if std::env::args().any(|a| a == "--mcp") {
        nkf_lib::run_mcp_server();
        return;
    }
    nkf_lib::run()
}
