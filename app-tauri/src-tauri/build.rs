const COMMANDS: &[&str] = &[
    "pick_executable",
    "add_recent_executable",
    "get_window_chrome_state",
    "window_control",
    "get_title_bar_menu_model",
    "invoke_title_bar_menu_action",
    "engine_request",
];

fn main() {
    println!(
        "cargo:rustc-env=APP_TAURI_TARGET_TRIPLE={}",
        std::env::var("TARGET").expect("TARGET env var should be set during build"),
    );

    tauri_build::try_build(
        tauri_build::Attributes::new()
            .app_manifest(tauri_build::AppManifest::new().commands(COMMANDS)),
    )
    .expect("failed to run tauri build script");
}
