const COMMANDS: &[&str] = &[
    "pick_executable",
    "add_recent_executable",
    "get_window_chrome_state",
    "window_control",
    "get_title_bar_menu_model",
    "invoke_title_bar_menu_action",
    "ping_engine",
    "open_module",
    "unload_module",
    "get_module_analysis_status",
    "get_module_info",
    "list_functions",
    "get_function_graph_by_va",
    "disassemble_linear",
    "get_linear_view_info",
    "get_linear_rows",
    "find_linear_row_by_va",
];

fn main() {
    tauri_build::try_build(
        tauri_build::Attributes::new()
            .app_manifest(tauri_build::AppManifest::new().commands(COMMANDS)),
    )
    .expect("failed to run tauri build script");
}
