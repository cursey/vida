use std::cell::RefCell;
use std::path::{Path, PathBuf};
use std::rc::Rc;
use std::sync::{Arc, Mutex, mpsc};
use std::thread;
use std::time::Duration;

use engine::api::{
    FunctionListParams, FunctionSeed, LinearFindRowByVaParams, LinearRowsParams,
    LinearViewInfoParams, LinearViewRow, ModuleAnalysisStatusParams, ModuleInfoParams,
    ModuleOpenParams, ModuleUnloadParams, SectionInfo,
};
use engine::{EngineError, EngineState};
use slint::{ComponentHandle, Timer, TimerMode, Weak as UiWeak};

use crate::{MainWindow, UiFunctionItem};

mod function_list;
mod linear_view;
mod status_bar;

use self::function_list::FunctionListModel;
use self::linear_view::{
    DisassemblyRowsModel, PAGE_SIZE, PageRequest, SectionRange, build_section_ranges,
    map_linear_row, normalize_hex_address,
};
use self::status_bar::{StatusBarController, StatusBarState};

const ANALYSIS_POLL_INTERVAL: Duration = Duration::from_millis(125);
const MESSAGE_PUMP_INTERVAL: Duration = Duration::from_millis(16);
const ROW_HEIGHT: f32 = 24.0;

pub struct AppController {
    engine: Arc<Mutex<EngineState>>,
    window: UiWeak<MainWindow>,
    status_bar: StatusBarController,
    functions: Rc<FunctionListModel>,
    rows: Rc<DisassemblyRowsModel>,
    state: RefCell<AppState>,
    sender: mpsc::Sender<WorkerMessage>,
    receiver: RefCell<mpsc::Receiver<WorkerMessage>>,
    message_timer: Timer,
}

#[derive(Default)]
struct AppState {
    generation: u64,
    current: Option<LoadedModule>,
}

#[derive(Clone)]
struct LoadedModule {
    module_id: String,
    sections: Vec<SectionRange>,
}

struct ReadyPayload {
    file_name: String,
    module_id: String,
    entry_va: String,
    row_count: usize,
    sections: Vec<SectionInfo>,
    functions: Vec<FunctionSeed>,
}

enum WorkerMessage {
    ModuleOpened {
        generation: u64,
        file_name: String,
        module_id: String,
        entry_va: String,
    },
    Status {
        generation: u64,
        file_name: String,
        message: String,
    },
    Ready {
        generation: u64,
        payload: ReadyPayload,
    },
    LoadError {
        generation: u64,
        file_name: String,
        message: String,
    },
    PageLoaded {
        generation: u64,
        module_id: String,
        page: u64,
        rows: Vec<LinearViewRow>,
    },
    PageError {
        generation: u64,
        module_id: String,
        page: u64,
        message: String,
    },
}

struct UiState {
    file_name: String,
    workspace_message: String,
    selected_function_index: i32,
    has_module: bool,
    is_ready: bool,
    status_bar: StatusBarState,
}

impl AppController {
    pub fn new(window: &MainWindow) -> Rc<Self> {
        let functions = Rc::new(FunctionListModel::default());
        let rows = Rc::new(DisassemblyRowsModel::default());
        let (sender, receiver) = mpsc::channel();
        let window_weak = window.as_weak();
        let controller = Rc::new(Self {
            engine: Arc::new(Mutex::new(EngineState::default())),
            window: window_weak.clone(),
            status_bar: StatusBarController::new(window_weak),
            functions: Rc::clone(&functions),
            rows: Rc::clone(&rows),
            state: RefCell::new(AppState::default()),
            sender: sender.clone(),
            receiver: RefCell::new(receiver),
            message_timer: Timer::default(),
        });

        rows.set_requester({
            let engine = Arc::clone(&controller.engine);
            let sender = sender.clone();
            move |request| {
                spawn_page_fetch(engine.clone(), sender.clone(), request);
            }
        });

        window.set_functions(functions.clone().into());
        window.set_disassembly_rows(rows.clone().into());
        window.set_workspace_message("Open an executable to begin.".into());
        window.set_file_name("".into());
        window.set_selected_function_index(-1);
        window.set_has_module(false);
        window.set_is_ready(false);
        controller.status_bar.apply(
            &StatusBarState {
                status_text: "Open an executable to begin.".to_string(),
                ..StatusBarState::default()
            },
            false,
        );
        controller
    }

    pub fn bind(self: &Rc<Self>) {
        let weak = Rc::downgrade(self);
        self.window
            .upgrade()
            .expect("window available")
            .on_open_requested(move || {
                if let Some(controller) = weak.upgrade() {
                    controller.open_file_dialog();
                }
            });

        let weak = Rc::downgrade(self);
        self.window
            .upgrade()
            .expect("window available")
            .on_function_selected(move |index, start_va| {
                if let Some(controller) = weak.upgrade() {
                    controller.navigate_to_va(start_va.to_string(), Some(index as i32), true);
                }
            });

        let weak = Rc::downgrade(self);
        self.window
            .upgrade()
            .expect("window available")
            .on_row_selected(move |index, va| {
                if let Some(controller) = weak.upgrade() {
                    controller.select_row(index as usize, va.to_string(), None, false);
                }
            });

        let weak = Rc::downgrade(self);
        self.window
            .upgrade()
            .expect("window available")
            .on_go_to_requested(move |va| {
                if let Some(controller) = weak.upgrade() {
                    controller.navigate_to_va(va.to_string(), None, true);
                }
            });

        let weak = Rc::downgrade(self);
        self.message_timer
            .start(TimerMode::Repeated, MESSAGE_PUMP_INTERVAL, move || {
                if let Some(controller) = weak.upgrade() {
                    controller.process_messages();
                }
            });
    }

    fn open_file_dialog(&self) {
        let Some(path) = rfd::FileDialog::new()
            .add_filter("PE Files", &["exe", "dll"])
            .pick_file()
        else {
            return;
        };

        self.start_open_path(path);
    }

    fn start_open_path(&self, path: PathBuf) {
        let path_display = path.to_string_lossy().to_string();
        let file_name = display_name(&path);
        let (generation, previous_module_id) = {
            let mut state = self.state.borrow_mut();
            state.generation += 1;
            (
                state.generation,
                state.current.take().map(|module| module.module_id),
            )
        };

        self.functions.replace(Vec::new());
        self.rows.reset(generation);
        self.set_ui_state(
            UiState {
                file_name: file_name.clone(),
                workspace_message: format!("Opening {file_name}..."),
                selected_function_index: -1,
                has_module: true,
                is_ready: false,
                status_bar: StatusBarState {
                    status_text: format!("Opening {file_name}..."),
                    ..StatusBarState::default()
                },
            },
            false,
        );

        spawn_module_load(
            Arc::clone(&self.engine),
            self.sender.clone(),
            generation,
            previous_module_id,
            path_display,
            file_name,
        );
    }

    fn process_messages(&self) {
        while let Ok(message) = self.receiver.borrow_mut().try_recv() {
            self.handle_message(message);
        }
    }

    fn window_handle(&self) -> MainWindow {
        self.window.upgrade().expect("window should stay alive")
    }

    fn handle_message(&self, message: WorkerMessage) {
        match message {
            WorkerMessage::ModuleOpened {
                generation,
                file_name,
                module_id,
                entry_va,
            } => {
                if self.state.borrow().generation != generation {
                    return;
                }
                self.state.borrow_mut().current = Some(LoadedModule {
                    module_id,
                    sections: Vec::new(),
                });
                self.set_ui_state(
                    UiState {
                        file_name,
                        workspace_message: "Analyzing module...".to_string(),
                        selected_function_index: -1,
                        has_module: true,
                        is_ready: false,
                        status_bar: StatusBarState {
                            status_text: "Analyzing module...".to_string(),
                            current_address: entry_va.clone(),
                            go_to_text: entry_va,
                            ..StatusBarState::default()
                        },
                    },
                    false,
                );
            }
            WorkerMessage::Status {
                generation,
                file_name,
                message,
            } => {
                if self.state.borrow().generation != generation {
                    return;
                }
                self.set_ui_state(
                    UiState {
                        file_name,
                        workspace_message: message.clone(),
                        selected_function_index: -1,
                        has_module: true,
                        is_ready: false,
                        status_bar: StatusBarState {
                            status_text: message.clone(),
                            ..StatusBarState::default()
                        },
                    },
                    true,
                );
            }
            WorkerMessage::Ready {
                generation,
                payload,
            } => {
                if self.state.borrow().generation != generation {
                    return;
                }
                self.finish_load_ready(generation, payload);
            }
            WorkerMessage::LoadError {
                generation,
                file_name,
                message,
            } => {
                if self.state.borrow().generation != generation {
                    return;
                }
                self.state.borrow_mut().current = None;
                self.functions.replace(Vec::new());
                self.rows.reset(generation);
                self.set_ui_state(
                    UiState {
                        file_name,
                        workspace_message: message.clone(),
                        selected_function_index: -1,
                        has_module: false,
                        is_ready: false,
                        status_bar: StatusBarState {
                            status_text: message.clone(),
                            ..StatusBarState::default()
                        },
                    },
                    false,
                );
            }
            WorkerMessage::PageLoaded {
                generation,
                module_id,
                page,
                rows,
            } => {
                let sections = {
                    let state = self.state.borrow();
                    let Some(current) = &state.current else {
                        return;
                    };
                    if state.generation != generation || current.module_id != module_id {
                        return;
                    }
                    current.sections.clone()
                };

                let mapped = rows
                    .into_iter()
                    .map(|row| map_linear_row(row, &sections))
                    .collect::<Vec<_>>();
                self.rows.apply_page(generation, &module_id, page, mapped);
            }
            WorkerMessage::PageError {
                generation,
                module_id,
                page,
                message,
            } => {
                self.rows.mark_page_complete(generation, &module_id, page);
                if self.state.borrow().generation == generation {
                    self.status_bar.set_status_text(message);
                }
            }
        }
    }

    fn finish_load_ready(&self, generation: u64, payload: ReadyPayload) {
        let sections = build_section_ranges(&payload.sections);
        let functions = payload
            .functions
            .into_iter()
            .map(|function| UiFunctionItem {
                name: function.name.into(),
                start_va: function.start.into(),
            })
            .collect::<Vec<_>>();
        let entry_index = functions
            .iter()
            .position(|function| function.start_va.as_str() == payload.entry_va);

        self.state.borrow_mut().current = Some(LoadedModule {
            module_id: payload.module_id.clone(),
            sections,
        });

        self.functions.replace(functions);
        self.rows
            .configure(generation, payload.module_id, payload.row_count);
        self.set_ui_state(
            UiState {
                file_name: payload.file_name.clone(),
                workspace_message: String::new(),
                selected_function_index: entry_index.map_or(-1, |index| index as i32),
                has_module: true,
                is_ready: true,
                status_bar: StatusBarState {
                    status_text: format!("Analysis ready for {}.", payload.file_name),
                    current_address: payload.entry_va.clone(),
                    go_to_text: payload.entry_va.clone(),
                    row_count_text: format!("{} rows", payload.row_count),
                },
            },
            false,
        );

        self.navigate_to_va(
            payload.entry_va,
            entry_index.map(|index| index as i32),
            true,
        );
    }

    fn navigate_to_va(&self, raw_va: String, function_index: Option<i32>, scroll: bool) {
        let (module_id, generation) = {
            let state = self.state.borrow();
            let Some(current) = &state.current else {
                self.status_bar
                    .set_status_text("Open a module before navigating.");
                return;
            };
            (current.module_id.clone(), state.generation)
        };

        let normalized_va = normalize_hex_address(&raw_va);
        let row = match with_engine(&self.engine, |engine| {
            engine.find_linear_row_by_va(LinearFindRowByVaParams {
                module_id,
                va: normalized_va.clone(),
            })
        }) {
            Ok(result) => result.row_index as usize,
            Err(_) => {
                self.status_bar
                    .set_status_text(format!("Unable to navigate to {raw_va}."));
                return;
            }
        };

        if self.state.borrow().generation != generation {
            return;
        }

        self.select_row(row, normalized_va, function_index, scroll);
    }

    fn select_row(&self, row_index: usize, va: String, function_index: Option<i32>, scroll: bool) {
        self.rows.set_selected_row(Some(row_index));
        self.status_bar.set_current_address(va);
        let window = self.window_handle();
        if let Some(function_index) = function_index {
            window.set_selected_function_index(function_index);
        }
        if scroll {
            window.set_disassembly_viewport_y((row_index as f32) * ROW_HEIGHT);
        }
    }

    fn set_ui_state(&self, state: UiState, preserve_navigation: bool) {
        let window = self.window_handle();
        window.set_file_name(state.file_name.into());
        window.set_workspace_message(state.workspace_message.into());
        self.status_bar
            .apply(&state.status_bar, preserve_navigation);
        if !preserve_navigation {
            window.set_selected_function_index(state.selected_function_index);
            window.set_disassembly_viewport_y(0.0);
        }
        window.set_has_module(state.has_module);
        window.set_is_ready(state.is_ready);
    }
}

fn spawn_module_load(
    engine: Arc<Mutex<EngineState>>,
    sender: mpsc::Sender<WorkerMessage>,
    generation: u64,
    previous_module_id: Option<String>,
    path_display: String,
    file_name: String,
) {
    thread::spawn(move || {
        if let Some(module_id) = previous_module_id {
            let _ = with_engine(&engine, |engine| {
                engine.unload_module(ModuleUnloadParams { module_id })
            });
        }

        let opened = match with_engine(&engine, |engine| {
            engine.open_module(ModuleOpenParams {
                path: path_display.clone(),
                pdb_path: None,
            })
        }) {
            Ok(opened) => opened,
            Err(error) => {
                let _ = sender.send(WorkerMessage::LoadError {
                    generation,
                    file_name,
                    message: error,
                });
                return;
            }
        };

        let _ = sender.send(WorkerMessage::ModuleOpened {
            generation,
            file_name: file_name.clone(),
            module_id: opened.module_id.clone(),
            entry_va: opened.entry_va.clone(),
        });

        loop {
            let status = match with_engine(&engine, |engine| {
                engine.get_module_analysis_status(ModuleAnalysisStatusParams {
                    module_id: opened.module_id.clone(),
                })
            }) {
                Ok(status) => status,
                Err(error) => {
                    let _ = sender.send(WorkerMessage::LoadError {
                        generation,
                        file_name: file_name.clone(),
                        message: error,
                    });
                    return;
                }
            };

            let _ = sender.send(WorkerMessage::Status {
                generation,
                file_name: file_name.clone(),
                message: status.message.clone(),
            });

            match status.state {
                "ready" => break,
                "failed" => {
                    let _ = sender.send(WorkerMessage::LoadError {
                        generation,
                        file_name: file_name.clone(),
                        message: status.message,
                    });
                    return;
                }
                "canceled" => {
                    let _ = sender.send(WorkerMessage::LoadError {
                        generation,
                        file_name: file_name.clone(),
                        message: "Analysis canceled.".to_string(),
                    });
                    return;
                }
                _ => thread::sleep(ANALYSIS_POLL_INTERVAL),
            }
        }

        let sections = match with_engine(&engine, |engine| {
            engine.get_module_info(ModuleInfoParams {
                module_id: opened.module_id.clone(),
            })
        }) {
            Ok(info) => info.sections,
            Err(error) => {
                let _ = sender.send(WorkerMessage::LoadError {
                    generation,
                    file_name: file_name.clone(),
                    message: error,
                });
                return;
            }
        };

        let functions = match with_engine(&engine, |engine| {
            engine.list_functions(FunctionListParams {
                module_id: opened.module_id.clone(),
            })
        }) {
            Ok(list) => list.functions,
            Err(error) => {
                let _ = sender.send(WorkerMessage::LoadError {
                    generation,
                    file_name: file_name.clone(),
                    message: error,
                });
                return;
            }
        };

        let linear_info = match with_engine(&engine, |engine| {
            engine.get_linear_view_info(LinearViewInfoParams {
                module_id: opened.module_id.clone(),
            })
        }) {
            Ok(info) => info,
            Err(error) => {
                let _ = sender.send(WorkerMessage::LoadError {
                    generation,
                    file_name: file_name.clone(),
                    message: error,
                });
                return;
            }
        };

        let _ = sender.send(WorkerMessage::Ready {
            generation,
            payload: ReadyPayload {
                file_name,
                module_id: opened.module_id,
                entry_va: opened.entry_va,
                row_count: linear_info.row_count as usize,
                sections,
                functions,
            },
        });
    });
}

fn spawn_page_fetch(
    engine: Arc<Mutex<EngineState>>,
    sender: mpsc::Sender<WorkerMessage>,
    request: PageRequest,
) {
    thread::spawn(move || {
        match with_engine(&engine, |engine| {
            engine.get_linear_rows(LinearRowsParams {
                module_id: request.module_id.clone(),
                start_row: request.page * PAGE_SIZE,
                row_count: PAGE_SIZE,
            })
        }) {
            Ok(result) => {
                let _ = sender.send(WorkerMessage::PageLoaded {
                    generation: request.generation,
                    module_id: request.module_id,
                    page: request.page,
                    rows: result.rows,
                });
            }
            Err(error) => {
                let _ = sender.send(WorkerMessage::PageError {
                    generation: request.generation,
                    module_id: request.module_id,
                    page: request.page,
                    message: format!("Failed to load linear rows: {error}"),
                });
            }
        }
    });
}

fn with_engine<T>(
    engine: &Arc<Mutex<EngineState>>,
    operation: impl FnOnce(&mut EngineState) -> Result<T, EngineError>,
) -> Result<T, String> {
    let mut engine = engine.lock().map_err(|error| error.to_string())?;
    operation(&mut engine).map_err(|error| error.to_string())
}

fn display_name(path: &Path) -> String {
    path.file_name()
        .and_then(|name| name.to_str())
        .map(ToOwned::to_owned)
        .unwrap_or_else(|| path.to_string_lossy().to_string())
}
