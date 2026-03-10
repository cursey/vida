const COMMANDS: &[&str] = &[
    "pick_executable",
    "pick_pdb",
    "add_recent_executable",
    "get_window_chrome_state",
    "window_control",
    "get_title_bar_menu_model",
    "invoke_title_bar_menu_action",
    "get_module_pdb_status",
    "open_module",
    "unload_module",
    "get_module_analysis_status",
    "get_module_info",
    "get_module_memory_overview",
    "list_functions",
    "get_function_graph_by_va",
    "get_xrefs_to_va",
    "disassemble_linear",
    "get_linear_view_info",
    "get_linear_rows",
    "find_linear_row_by_va",
];

fn main() {
    println!("cargo:rerun-if-changed=icons/icon.ico");
    println!("cargo:rerun-if-changed=icons/icon-source.png");
    println!("cargo:rerun-if-changed=tauri.conf.json");

    tauri_build::try_build(
        tauri_build::Attributes::new()
            .app_manifest(tauri_build::AppManifest::new().commands(COMMANDS)),
    )
    .expect("failed to run tauri build script");
}
