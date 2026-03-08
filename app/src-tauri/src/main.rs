#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::{
    collections::{HashMap, HashSet},
    fs,
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
};

use engine::{
    EngineError, EngineState,
    api::{
        FunctionGraphByVaParams, FunctionGraphByVaResult, FunctionListParams, FunctionListResult,
        LinearDisassemblyParams, LinearDisassemblyResult, LinearFindRowByVaParams,
        LinearFindRowByVaResult, LinearRowsParams, LinearRowsResult, LinearViewInfoParams,
        LinearViewInfoResult, ModuleAnalysisStatusParams, ModuleAnalysisStatusResult,
        ModuleInfoParams, ModuleInfoResult, ModuleMemoryOverviewParams, ModuleMemoryOverviewResult,
        ModuleOpenParams, ModuleOpenResult, ModuleUnloadParams, ModuleUnloadResult,
        XrefsToVaParams, XrefsToVaResult,
    },
};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State, WebviewWindow, async_runtime::spawn_blocking};
use tauri_plugin_dialog::DialogExt;

const MAX_RECENT_EXECUTABLES: usize = 10;
const RECENT_EXECUTABLES_FILE_NAME: &str = "recent-executables.json";
const WINDOW_CHROME_STATE_CHANGED_EVENT: &str = "app://window-chrome-state-changed";
const TITLE_BAR_MENU_MODEL_CHANGED_EVENT: &str = "app://title-bar-menu-model-changed";
const MENU_OPEN_EXECUTABLE_EVENT: &str = "app://menu-open-executable";
const MENU_OPEN_RECENT_EXECUTABLE_EVENT: &str = "app://menu-open-recent-executable";
const MENU_UNLOAD_MODULE_EVENT: &str = "app://menu-unload-module";
const FILE_OPEN_COMMAND_ID: &str = "file.open";
const FILE_OPEN_RECENT_COMMAND_PREFIX: &str = "file.openRecent.";
const FILE_UNLOAD_COMMAND_ID: &str = "file.unload";
const FILE_CLOSE_OR_QUIT_COMMAND_ID: &str = "file.closeOrQuit";

#[derive(Debug)]
struct AppState {
    recent_executables: Mutex<Vec<String>>,
    menu_model: Mutex<TitleBarMenuModel>,
    recent_commands: Mutex<HashMap<String, String>>,
    engine: Arc<Mutex<EngineState>>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct WindowChromeState {
    use_custom_chrome: bool,
    platform: String,
    is_maximized: bool,
    is_focused: bool,
}

#[derive(Debug, Clone, Serialize)]
struct TitleBarMenuModel {
    menus: Vec<TitleBarMenu>,
}

#[derive(Debug, Clone, Serialize)]
struct TitleBarMenu {
    id: String,
    label: String,
    items: Vec<TitleBarMenuItem>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", rename_all = "lowercase")]
enum TitleBarMenuItem {
    Item {
        label: String,
        enabled: bool,
        #[serde(rename = "commandId", skip_serializing_if = "Option::is_none")]
        command_id: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        accelerator: Option<String>,
    },
    Separator,
    Submenu {
        label: String,
        enabled: bool,
        items: Vec<TitleBarMenuItem>,
    },
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
enum WindowControlAction {
    Minimize,
    ToggleMaximize,
    Close,
}

#[derive(Debug, Serialize, Deserialize)]
struct RecentExecutablesFile {
    paths: Vec<String>,
}

impl AppState {
    fn new() -> Self {
        Self {
            recent_executables: Mutex::new(Vec::new()),
            menu_model: Mutex::new(TitleBarMenuModel { menus: Vec::new() }),
            recent_commands: Mutex::new(HashMap::new()),
            engine: Arc::new(Mutex::new(EngineState::default())),
        }
    }
}

#[tauri::command]
async fn pick_executable(app: AppHandle) -> Result<Option<String>, String> {
    let mut file_dialog = app.dialog().file();

    for (name, extensions) in open_module_filters() {
        file_dialog = file_dialog.add_filter(name, &extensions);
    }

    file_dialog
        .blocking_pick_file()
        .map(|file_path| file_path.into_path().map_err(|error| error.to_string()))
        .transpose()
        .map(|path| path.map(|path| path.to_string_lossy().into_owned()))
}

fn open_module_filters() -> [(&'static str, &'static [&'static str]); 2] {
    [("PE Files", &["exe", "dll"]), ("All Files", &["*"])]
}

#[tauri::command]
async fn add_recent_executable(
    app: AppHandle,
    state: State<'_, AppState>,
    path: String,
) -> Result<(), String> {
    let mut recent = state
        .recent_executables
        .lock()
        .map_err(|error| error.to_string())?;
    *recent = prepend_recent_path(&recent, &path);
    persist_recent_executables(&app, &recent)?;
    drop(recent);
    refresh_menu(&app, &state)?;
    Ok(())
}

#[tauri::command]
async fn get_window_chrome_state(window: WebviewWindow) -> Result<WindowChromeState, String> {
    webview_window_chrome_state(&window)
}

#[tauri::command]
async fn window_control(window: WebviewWindow, action: WindowControlAction) -> Result<(), String> {
    match action {
        WindowControlAction::Minimize => window.minimize().map_err(|error| error.to_string())?,
        WindowControlAction::ToggleMaximize => {
            let is_maximized = window.is_maximized().map_err(|error| error.to_string())?;
            if is_maximized {
                window.unmaximize().map_err(|error| error.to_string())?;
            } else {
                window.maximize().map_err(|error| error.to_string())?;
            }
        }
        WindowControlAction::Close => window.close().map_err(|error| error.to_string())?,
    }

    emit_webview_window_chrome_state(&window)?;
    Ok(())
}

#[tauri::command]
async fn get_title_bar_menu_model(state: State<'_, AppState>) -> Result<TitleBarMenuModel, String> {
    state
        .menu_model
        .lock()
        .map_err(|error| error.to_string())
        .map(|model| model.clone())
}

#[tauri::command]
async fn invoke_title_bar_menu_action(
    app: AppHandle,
    window: WebviewWindow,
    state: State<'_, AppState>,
    command_id: String,
) -> Result<(), String> {
    handle_menu_action(&app, &window, &state, &command_id)
}

#[tauri::command]
async fn open_module(state: State<'_, AppState>, path: String) -> Result<ModuleOpenResult, String> {
    let engine = Arc::clone(&state.engine);
    run_engine(engine, move |engine| {
        engine.open_module(ModuleOpenParams { path })
    })
    .await
}

#[tauri::command]
async fn unload_module(
    state: State<'_, AppState>,
    module_id: String,
) -> Result<ModuleUnloadResult, String> {
    let engine = Arc::clone(&state.engine);
    run_engine(engine, move |engine| {
        engine.unload_module(ModuleUnloadParams { module_id })
    })
    .await
}

#[tauri::command]
async fn get_module_analysis_status(
    state: State<'_, AppState>,
    module_id: String,
) -> Result<ModuleAnalysisStatusResult, String> {
    let engine = Arc::clone(&state.engine);
    run_engine(engine, move |engine| {
        engine.get_module_analysis_status(ModuleAnalysisStatusParams { module_id })
    })
    .await
}

#[tauri::command]
async fn get_module_info(
    state: State<'_, AppState>,
    module_id: String,
) -> Result<ModuleInfoResult, String> {
    let engine = Arc::clone(&state.engine);
    run_engine(engine, move |engine| {
        engine.get_module_info(ModuleInfoParams { module_id })
    })
    .await
}

#[tauri::command]
async fn get_module_memory_overview(
    state: State<'_, AppState>,
    module_id: String,
) -> Result<ModuleMemoryOverviewResult, String> {
    let engine = Arc::clone(&state.engine);
    run_engine(engine, move |engine| {
        engine.get_module_memory_overview(ModuleMemoryOverviewParams { module_id })
    })
    .await
}

#[tauri::command]
async fn list_functions(
    state: State<'_, AppState>,
    module_id: String,
) -> Result<FunctionListResult, String> {
    let engine = Arc::clone(&state.engine);
    run_engine(engine, move |engine| {
        engine.list_functions(FunctionListParams { module_id })
    })
    .await
}

#[tauri::command]
async fn get_function_graph_by_va(
    state: State<'_, AppState>,
    payload: FunctionGraphByVaParams,
) -> Result<FunctionGraphByVaResult, String> {
    let engine = Arc::clone(&state.engine);
    run_engine(engine, move |engine| {
        engine.get_function_graph_by_va(payload)
    })
    .await
}

#[tauri::command]
async fn get_xrefs_to_va(
    state: State<'_, AppState>,
    payload: XrefsToVaParams,
) -> Result<XrefsToVaResult, String> {
    let engine = Arc::clone(&state.engine);
    run_engine(engine, move |engine| engine.get_xrefs_to_va(payload)).await
}

#[tauri::command]
async fn disassemble_linear(
    state: State<'_, AppState>,
    payload: LinearDisassemblyParams,
) -> Result<LinearDisassemblyResult, String> {
    let engine = Arc::clone(&state.engine);
    run_engine(engine, move |engine| engine.disassemble_linear(payload)).await
}

#[tauri::command]
async fn get_linear_view_info(
    state: State<'_, AppState>,
    module_id: String,
) -> Result<LinearViewInfoResult, String> {
    let engine = Arc::clone(&state.engine);
    run_engine(engine, move |engine| {
        engine.get_linear_view_info(LinearViewInfoParams { module_id })
    })
    .await
}

#[tauri::command]
async fn get_linear_rows(
    state: State<'_, AppState>,
    payload: LinearRowsParams,
) -> Result<LinearRowsResult, String> {
    let engine = Arc::clone(&state.engine);
    run_engine(engine, move |engine| engine.get_linear_rows(payload)).await
}

#[tauri::command]
async fn find_linear_row_by_va(
    state: State<'_, AppState>,
    payload: LinearFindRowByVaParams,
) -> Result<LinearFindRowByVaResult, String> {
    let engine = Arc::clone(&state.engine);
    run_engine(engine, move |engine| engine.find_linear_row_by_va(payload)).await
}

async fn run_engine<T, F>(engine: Arc<Mutex<EngineState>>, operation: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce(&mut EngineState) -> Result<T, EngineError> + Send + 'static,
{
    spawn_blocking(move || {
        let mut engine = engine.lock().map_err(|error| error.to_string())?;
        operation(&mut engine).map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState::new())
        .setup(|app| {
            load_recent_executables(app.handle())?;
            refresh_menu(app.handle(), &app.state::<AppState>())?;

            if let Some(window) = app.get_webview_window("main") {
                emit_webview_window_chrome_state(&window)?;
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            pick_executable,
            add_recent_executable,
            get_window_chrome_state,
            window_control,
            get_title_bar_menu_model,
            invoke_title_bar_menu_action,
            open_module,
            unload_module,
            get_module_analysis_status,
            get_module_info,
            get_module_memory_overview,
            list_functions,
            get_function_graph_by_va,
            get_xrefs_to_va,
            disassemble_linear,
            get_linear_view_info,
            get_linear_rows,
            find_linear_row_by_va
        ])
        .build(tauri::generate_context!())
        .expect("failed to build Tauri application")
        .run(|_, _| {});
}

fn handle_menu_action(
    app: &AppHandle,
    window: &WebviewWindow,
    state: &AppState,
    command_id: &str,
) -> Result<(), String> {
    if command_id == FILE_OPEN_COMMAND_ID {
        window
            .emit(MENU_OPEN_EXECUTABLE_EVENT, Option::<()>::None)
            .map_err(|error| error.to_string())?;
        return Ok(());
    }

    if command_id == FILE_UNLOAD_COMMAND_ID {
        window
            .emit(MENU_UNLOAD_MODULE_EVENT, Option::<()>::None)
            .map_err(|error| error.to_string())?;
        return Ok(());
    }

    if command_id == FILE_CLOSE_OR_QUIT_COMMAND_ID {
        app.exit(0);
        return Ok(());
    }

    if let Some(path) = state
        .recent_commands
        .lock()
        .map_err(|error| error.to_string())?
        .get(command_id)
        .cloned()
    {
        window
            .emit(MENU_OPEN_RECENT_EXECUTABLE_EVENT, path)
            .map_err(|error| error.to_string())?;
    }

    Ok(())
}

fn emit_webview_window_chrome_state(window: &WebviewWindow) -> Result<(), String> {
    let state = webview_window_chrome_state(window)?;
    window
        .emit(WINDOW_CHROME_STATE_CHANGED_EVENT, state)
        .map_err(|error| error.to_string())
}

fn webview_window_chrome_state(window: &WebviewWindow) -> Result<WindowChromeState, String> {
    Ok(WindowChromeState {
        use_custom_chrome: true,
        platform: "win32".to_string(),
        is_maximized: window.is_maximized().map_err(|error| error.to_string())?,
        is_focused: window.is_focused().map_err(|error| error.to_string())?,
    })
}

fn load_recent_executables(app: &AppHandle) -> Result<(), String> {
    let storage_path = recent_executables_file_path(app)?;
    let loaded = if storage_path.is_file() {
        let raw = fs::read_to_string(&storage_path).map_err(|error| error.to_string())?;
        let parsed: RecentExecutablesFile =
            serde_json::from_str(&raw).map_err(|error| error.to_string())?;
        sanitize_recent_executables(parsed.paths)
    } else {
        Vec::new()
    };

    *app.state::<AppState>()
        .recent_executables
        .lock()
        .map_err(|error| error.to_string())? = loaded;

    Ok(())
}

fn persist_recent_executables(app: &AppHandle, recent: &[String]) -> Result<(), String> {
    let storage_path = recent_executables_file_path(app)?;
    if let Some(parent) = storage_path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }

    let payload = serde_json::to_string_pretty(&RecentExecutablesFile {
        paths: recent.to_vec(),
    })
    .map_err(|error| error.to_string())?;
    fs::write(storage_path, payload).map_err(|error| error.to_string())
}

fn recent_executables_file_path(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map_err(|error| error.to_string())
        .map(|directory| directory.join(RECENT_EXECUTABLES_FILE_NAME))
}

fn refresh_menu(app: &AppHandle, state: &AppState) -> Result<(), String> {
    let recent = state
        .recent_executables
        .lock()
        .map_err(|error| error.to_string())?
        .clone();

    let (menu_model, recent_commands) = build_menu_model(&recent);

    *state.menu_model.lock().map_err(|error| error.to_string())? = menu_model.clone();
    *state
        .recent_commands
        .lock()
        .map_err(|error| error.to_string())? = recent_commands;

    if let Some(window) = app.get_webview_window("main") {
        window
            .emit(TITLE_BAR_MENU_MODEL_CHANGED_EVENT, menu_model)
            .map_err(|error| error.to_string())?;
    }

    Ok(())
}

fn build_menu_model(recent: &[String]) -> (TitleBarMenuModel, HashMap<String, String>) {
    let mut recent_commands = HashMap::new();
    for (index, path) in recent.iter().enumerate() {
        let command_id = format!("{FILE_OPEN_RECENT_COMMAND_PREFIX}{index}");
        recent_commands.insert(command_id.clone(), path.clone());
    }

    let menu_model = TitleBarMenuModel {
        menus: vec![TitleBarMenu {
            id: "file".to_string(),
            label: "File".to_string(),
            items: vec![
                TitleBarMenuItem::Item {
                    label: "Open...".to_string(),
                    enabled: true,
                    command_id: Some(FILE_OPEN_COMMAND_ID.to_string()),
                    accelerator: Some("CmdOrCtrl+O".to_string()),
                },
                TitleBarMenuItem::Submenu {
                    label: "Open Recent".to_string(),
                    enabled: true,
                    items: build_recent_menu_model(recent),
                },
                TitleBarMenuItem::Item {
                    label: "Unload".to_string(),
                    enabled: true,
                    command_id: Some(FILE_UNLOAD_COMMAND_ID.to_string()),
                    accelerator: None,
                },
                TitleBarMenuItem::Separator,
                TitleBarMenuItem::Item {
                    label: "Quit".to_string(),
                    enabled: true,
                    command_id: Some(FILE_CLOSE_OR_QUIT_COMMAND_ID.to_string()),
                    accelerator: Some("Alt+F4".to_string()),
                },
            ],
        }],
    };

    (menu_model, recent_commands)
}

fn build_recent_menu_model(recent: &[String]) -> Vec<TitleBarMenuItem> {
    if recent.is_empty() {
        return vec![TitleBarMenuItem::Item {
            label: "No Recent Files".to_string(),
            enabled: false,
            command_id: None,
            accelerator: None,
        }];
    }

    recent
        .iter()
        .enumerate()
        .map(|(index, path)| TitleBarMenuItem::Item {
            label: path.clone(),
            enabled: true,
            command_id: Some(format!("{FILE_OPEN_RECENT_COMMAND_PREFIX}{index}")),
            accelerator: None,
        })
        .collect()
}

fn prepend_recent_path(existing: &[String], raw_path: &str) -> Vec<String> {
    let normalized = normalize_executable_path(raw_path);
    if normalized.is_empty() || !Path::new(&normalized).is_file() {
        return existing.to_vec();
    }

    let mut combined = vec![normalized];
    combined.extend(existing.iter().cloned());
    sanitize_recent_executables(combined)
}

fn sanitize_recent_executables(paths: Vec<String>) -> Vec<String> {
    let mut seen = HashSet::new();
    let mut output = Vec::new();

    for raw_path in paths {
        let normalized = normalize_executable_path(&raw_path);
        if normalized.is_empty() || !Path::new(&normalized).is_file() {
            continue;
        }

        if seen.insert(normalized.clone()) {
            output.push(normalized);
        }
        if output.len() >= MAX_RECENT_EXECUTABLES {
            break;
        }
    }

    output
}

fn normalize_executable_path(raw_path: &str) -> String {
    let trimmed = raw_path.trim();
    if trimmed.is_empty() {
        return String::new();
    }

    fs::canonicalize(trimmed)
        .map(|path| strip_windows_verbatim_prefix(path.to_string_lossy().into_owned()))
        .unwrap_or_else(|_| trimmed.to_string())
}

fn strip_windows_verbatim_prefix(path: String) -> String {
    path.strip_prefix(r"\\?\").unwrap_or(&path).to_string()
}

#[cfg(test)]
mod tests {
    use super::{
        build_recent_menu_model, open_module_filters, prepend_recent_path,
        sanitize_recent_executables,
    };
    use std::{fs, path::PathBuf};

    fn temp_file(name: &str) -> String {
        let path = std::env::temp_dir().join(format!("vida-pro-test-{name}.exe"));
        fs::write(&path, b"test").expect("failed to create temp file");
        path.to_string_lossy().into_owned()
    }

    #[test]
    fn recent_menu_model_shows_placeholder_when_empty() {
        let items = build_recent_menu_model(&[]);
        assert_eq!(items.len(), 1);
    }

    #[test]
    fn sanitize_recent_executables_deduplicates_and_filters_missing_files() {
        let first = temp_file("first");
        let second = temp_file("second");
        let sanitized = sanitize_recent_executables(vec![
            first.clone(),
            second.clone(),
            first.clone(),
            PathBuf::from("C:/missing.exe")
                .to_string_lossy()
                .into_owned(),
        ]);

        assert_eq!(sanitized, vec![first, second]);
    }

    #[test]
    fn prepend_recent_path_adds_new_existing_file_to_front() {
        let first = temp_file("front");
        let second = temp_file("second-front");
        let updated = prepend_recent_path(std::slice::from_ref(&second), &first);

        assert_eq!(updated.first().cloned(), Some(first));
        assert_eq!(updated.get(1).cloned(), Some(second));
    }

    #[test]
    fn open_module_filters_include_dll_and_all_files() {
        let filters = open_module_filters();

        assert_eq!(filters[0], ("PE Files", &["exe", "dll"] as &[&str]));
        assert_eq!(filters[1], ("All Files", &["*"] as &[&str]));
    }
}
