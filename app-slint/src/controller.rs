use std::cell::RefCell;
use std::collections::{HashMap, HashSet, VecDeque};
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
use slint::{ComponentHandle, Model, ModelNotify, SharedString, Timer, TimerMode, Weak as UiWeak};

use crate::{MainWindow, UiFunctionItem, UiLinearRow};

const ANALYSIS_POLL_INTERVAL: Duration = Duration::from_millis(125);
const MESSAGE_PUMP_INTERVAL: Duration = Duration::from_millis(16);
const PAGE_SIZE: u64 = 512;
const MAX_CACHED_PAGES: usize = 32;
const ROW_HEIGHT: f32 = 24.0;

pub struct AppController {
    engine: Arc<Mutex<EngineState>>,
    window: UiWeak<MainWindow>,
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

#[derive(Clone)]
struct SectionRange {
    name: SharedString,
    start: u64,
    end: u64,
}

#[derive(Clone)]
struct PageRequest {
    generation: u64,
    module_id: String,
    page: u64,
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
    status_text: String,
    workspace_message: String,
    current_address: String,
    go_to_text: String,
    row_count_text: String,
    selected_function_index: i32,
    has_module: bool,
    is_ready: bool,
}

pub struct FunctionListModel {
    items: RefCell<Vec<UiFunctionItem>>,
    notify: ModelNotify,
}

struct DisassemblyRowsModel {
    inner: RefCell<DisassemblyRowsState>,
    notify: ModelNotify,
    requester: RefCell<Option<Rc<dyn Fn(PageRequest)>>>,
}

struct DisassemblyRowsState {
    generation: u64,
    module_id: String,
    row_count: usize,
    selected_row: Option<usize>,
    pages: HashMap<u64, Vec<UiLinearRow>>,
    page_order: VecDeque<u64>,
    inflight_pages: HashSet<u64>,
}

impl AppController {
    pub fn new(window: &MainWindow) -> Rc<Self> {
        let functions = Rc::new(FunctionListModel::default());
        let rows = Rc::new(DisassemblyRowsModel::default());
        let (sender, receiver) = mpsc::channel();
        let controller = Rc::new(Self {
            engine: Arc::new(Mutex::new(EngineState::default())),
            window: window.as_weak(),
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
        window.set_status_text("Open an executable to begin.".into());
        window.set_workspace_message("Open an executable to begin.".into());
        window.set_current_address("".into());
        window.set_go_to_text("".into());
        window.set_row_count_text("".into());
        window.set_file_name("".into());
        window.set_selected_function_index(-1);
        window.set_has_module(false);
        window.set_is_ready(false);
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
                status_text: format!("Opening {file_name}..."),
                workspace_message: format!("Opening {file_name}..."),
                current_address: String::new(),
                go_to_text: String::new(),
                row_count_text: String::new(),
                selected_function_index: -1,
                has_module: true,
                is_ready: false,
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
                        status_text: "Analyzing module...".to_string(),
                        workspace_message: "Analyzing module...".to_string(),
                        current_address: entry_va.clone(),
                        go_to_text: entry_va,
                        row_count_text: String::new(),
                        selected_function_index: -1,
                        has_module: true,
                        is_ready: false,
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
                        status_text: message.clone(),
                        workspace_message: message,
                        current_address: String::new(),
                        go_to_text: String::new(),
                        row_count_text: String::new(),
                        selected_function_index: -1,
                        has_module: true,
                        is_ready: false,
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
                        status_text: message.clone(),
                        workspace_message: message,
                        current_address: String::new(),
                        go_to_text: String::new(),
                        row_count_text: String::new(),
                        selected_function_index: -1,
                        has_module: false,
                        is_ready: false,
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
                    self.window_handle().set_status_text(message.into());
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
                status_text: format!("Analysis ready for {}.", payload.file_name),
                workspace_message: String::new(),
                current_address: payload.entry_va.clone(),
                go_to_text: payload.entry_va.clone(),
                row_count_text: format!("{} rows", payload.row_count),
                selected_function_index: entry_index.map_or(-1, |index| index as i32),
                has_module: true,
                is_ready: true,
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
                self.window_handle()
                    .set_status_text("Open a module before navigating.".into());
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
                self.window_handle()
                    .set_status_text(format!("Unable to navigate to {raw_va}.").into());
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
        let window = self.window_handle();
        window.set_current_address(va.clone().into());
        window.set_go_to_text(va.into());
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
        window.set_status_text(state.status_text.into());
        window.set_workspace_message(state.workspace_message.into());
        if !preserve_navigation {
            window.set_current_address(state.current_address.into());
            window.set_go_to_text(state.go_to_text.into());
            window.set_row_count_text(state.row_count_text.into());
            window.set_selected_function_index(state.selected_function_index);
            window.set_disassembly_viewport_y(0.0);
        }
        window.set_has_module(state.has_module);
        window.set_is_ready(state.is_ready);
    }
}

impl Default for FunctionListModel {
    fn default() -> Self {
        Self {
            items: RefCell::new(Vec::new()),
            notify: ModelNotify::default(),
        }
    }
}

impl FunctionListModel {
    fn replace(&self, items: Vec<UiFunctionItem>) {
        *self.items.borrow_mut() = items;
        self.notify.reset();
    }
}

impl Model for FunctionListModel {
    type Data = UiFunctionItem;

    fn row_count(&self) -> usize {
        self.items.borrow().len()
    }

    fn row_data(&self, row: usize) -> Option<Self::Data> {
        self.items.borrow().get(row).cloned()
    }

    fn model_tracker(&self) -> &dyn slint::ModelTracker {
        &self.notify
    }
}

impl Default for DisassemblyRowsModel {
    fn default() -> Self {
        Self {
            inner: RefCell::new(DisassemblyRowsState {
                generation: 0,
                module_id: String::new(),
                row_count: 0,
                selected_row: None,
                pages: HashMap::new(),
                page_order: VecDeque::new(),
                inflight_pages: HashSet::new(),
            }),
            notify: ModelNotify::default(),
            requester: RefCell::new(None),
        }
    }
}

impl DisassemblyRowsModel {
    fn set_requester(&self, requester: impl Fn(PageRequest) + 'static) {
        *self.requester.borrow_mut() = Some(Rc::new(requester));
    }

    fn reset(&self, generation: u64) {
        {
            let mut inner = self.inner.borrow_mut();
            inner.generation = generation;
            inner.module_id.clear();
            inner.row_count = 0;
            inner.selected_row = None;
            inner.pages.clear();
            inner.page_order.clear();
            inner.inflight_pages.clear();
        }
        self.notify.reset();
    }

    fn configure(&self, generation: u64, module_id: String, row_count: usize) {
        {
            let mut inner = self.inner.borrow_mut();
            inner.generation = generation;
            inner.module_id = module_id;
            inner.row_count = row_count;
            inner.selected_row = None;
            inner.pages.clear();
            inner.page_order.clear();
            inner.inflight_pages.clear();
        }
        self.notify.reset();
    }

    fn set_selected_row(&self, selected_row: Option<usize>) {
        let mut changed_rows = Vec::new();
        {
            let mut inner = self.inner.borrow_mut();
            let previous = inner.selected_row;
            if previous == selected_row {
                return;
            }
            inner.selected_row = selected_row;
            for row_index in [previous, selected_row].into_iter().flatten() {
                let page = row_index as u64 / PAGE_SIZE;
                let offset = row_index % PAGE_SIZE as usize;
                if let Some(rows) = inner.pages.get_mut(&page) {
                    if let Some(row) = rows.get_mut(offset) {
                        row.is_selected = Some(row_index) == selected_row;
                    }
                }
                changed_rows.push(row_index);
            }
        }

        for row_index in changed_rows {
            self.notify.row_changed(row_index);
        }
    }

    fn apply_page(&self, generation: u64, module_id: &str, page: u64, mut rows: Vec<UiLinearRow>) {
        let start_row = page * PAGE_SIZE;
        let changed_row_count = rows.len();
        {
            let mut inner = self.inner.borrow_mut();
            if inner.generation != generation || inner.module_id != module_id {
                return;
            }
            for (offset, row) in rows.iter_mut().enumerate() {
                row.is_selected = inner.selected_row == Some(start_row as usize + offset);
            }
            inner.inflight_pages.remove(&page);
            inner.page_order.retain(|value| *value != page);
            inner.pages.insert(page, rows);
            inner.page_order.push_back(page);
            while inner.page_order.len() > MAX_CACHED_PAGES {
                if let Some(oldest) = inner.page_order.pop_front() {
                    inner.pages.remove(&oldest);
                }
            }
        }
        for offset in 0..changed_row_count {
            self.notify.row_changed(start_row as usize + offset);
        }
    }

    fn mark_page_complete(&self, generation: u64, module_id: &str, page: u64) {
        let mut inner = self.inner.borrow_mut();
        if inner.generation == generation && inner.module_id == module_id {
            inner.inflight_pages.remove(&page);
        }
    }

    fn request_page_if_needed(&self, request: PageRequest) {
        let requester = {
            let mut inner = self.inner.borrow_mut();
            if request.page * PAGE_SIZE >= inner.row_count as u64 {
                return;
            }
            if inner.pages.contains_key(&request.page)
                || inner.inflight_pages.contains(&request.page)
            {
                return;
            }
            inner.inflight_pages.insert(request.page);
            self.requester.borrow().clone()
        };

        if let Some(requester) = requester {
            requester(request);
        }
    }

    fn placeholder_row(&self, row: usize) -> UiLinearRow {
        let is_selected = self.inner.borrow().selected_row == Some(row);
        UiLinearRow {
            kind: "loading".into(),
            section: "".into(),
            address: "...".into(),
            bytes: "...".into(),
            mnemonic: "loading".into(),
            operands: "".into(),
            comment: "".into(),
            category: "other".into(),
            is_selected,
            is_loading: true,
        }
    }
}

impl Model for DisassemblyRowsModel {
    type Data = UiLinearRow;

    fn row_count(&self) -> usize {
        self.inner.borrow().row_count
    }

    fn row_data(&self, row: usize) -> Option<Self::Data> {
        let (generation, module_id, row_count, page, cached) = {
            let inner = self.inner.borrow();
            if row >= inner.row_count {
                return None;
            }
            let page = row as u64 / PAGE_SIZE;
            let offset = row % PAGE_SIZE as usize;
            (
                inner.generation,
                inner.module_id.clone(),
                inner.row_count,
                page,
                inner
                    .pages
                    .get(&page)
                    .and_then(|rows| rows.get(offset))
                    .cloned(),
            )
        };

        if let Some(cached) = cached {
            return Some(cached);
        }

        self.request_page_if_needed(PageRequest {
            generation,
            module_id: module_id.clone(),
            page,
        });
        if page > 0 {
            self.request_page_if_needed(PageRequest {
                generation,
                module_id: module_id.clone(),
                page: page - 1,
            });
        }
        if (page + 1) * PAGE_SIZE < row_count as u64 {
            self.request_page_if_needed(PageRequest {
                generation,
                module_id,
                page: page + 1,
            });
        }

        Some(self.placeholder_row(row))
    }

    fn model_tracker(&self) -> &dyn slint::ModelTracker {
        &self.notify
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

fn map_linear_row(row: LinearViewRow, sections: &[SectionRange]) -> UiLinearRow {
    let address = parse_hex_u64(&row.address).ok();
    let section = address
        .and_then(|address| {
            sections
                .iter()
                .find(|section| address >= section.start && address < section.end)
                .map(|section| section.name.clone())
        })
        .unwrap_or_default();

    let category = row
        .instruction_category
        .map(|category| match category {
            engine::api::InstructionCategory::Call => "call",
            engine::api::InstructionCategory::Return => "return",
            engine::api::InstructionCategory::ControlFlow => "control_flow",
            engine::api::InstructionCategory::System => "system",
            engine::api::InstructionCategory::Stack => "stack",
            engine::api::InstructionCategory::String => "string",
            engine::api::InstructionCategory::CompareTest => "compare_test",
            engine::api::InstructionCategory::Arithmetic => "arithmetic",
            engine::api::InstructionCategory::Logic => "logic",
            engine::api::InstructionCategory::BitShift => "bit_shift",
            engine::api::InstructionCategory::DataTransfer => "data_transfer",
            engine::api::InstructionCategory::Other => "other",
        })
        .unwrap_or("other");

    let comment = match row.kind {
        "comment" | "label" => row.text.unwrap_or_default(),
        _ => row.comment.unwrap_or_default(),
    };

    UiLinearRow {
        kind: row.kind.into(),
        section,
        address: row.address.into(),
        bytes: row.bytes.into(),
        mnemonic: row.mnemonic.into(),
        operands: row.operands.into(),
        comment: comment.into(),
        category: category.into(),
        is_selected: false,
        is_loading: false,
    }
}

fn build_section_ranges(sections: &[SectionInfo]) -> Vec<SectionRange> {
    sections
        .iter()
        .filter_map(|section| {
            Some(SectionRange {
                name: section.name.clone().into(),
                start: parse_hex_u64(&section.start_va).ok()?,
                end: parse_hex_u64(&section.end_va).ok()?,
            })
        })
        .collect()
}

fn normalize_hex_address(raw: &str) -> String {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return String::new();
    }
    let digits = trimmed
        .strip_prefix("0x")
        .or_else(|| trimmed.strip_prefix("0X"))
        .unwrap_or(trimmed);
    format!("0x{}", digits.to_uppercase())
}

fn parse_hex_u64(value: &str) -> Result<u64, String> {
    let trimmed = value.trim();
    let digits = trimmed
        .strip_prefix("0x")
        .or_else(|| trimmed.strip_prefix("0X"))
        .unwrap_or(trimmed);
    u64::from_str_radix(digits, 16).map_err(|error| error.to_string())
}

fn display_name(path: &Path) -> String {
    path.file_name()
        .and_then(|name| name.to_str())
        .map(ToOwned::to_owned)
        .unwrap_or_else(|| path.to_string_lossy().to_string())
}

#[cfg(test)]
mod tests {
    use super::{DisassemblyRowsModel, PAGE_SIZE, map_linear_row};
    use engine::api::{InstructionCategory, LinearViewRow};
    use slint::Model;

    fn instruction_row(address: &str) -> LinearViewRow {
        LinearViewRow {
            kind: "instruction",
            address: address.to_string(),
            bytes: "90".to_string(),
            mnemonic: "nop".to_string(),
            operands: String::new(),
            instruction_category: Some(InstructionCategory::Other),
            branch_target: None,
            call_target: None,
            comment: None,
            text: None,
        }
    }

    #[test]
    fn row_model_returns_loading_placeholder_for_missing_page() {
        let model = DisassemblyRowsModel::default();
        model.configure(1, "m1".to_string(), PAGE_SIZE as usize);

        let row = model.row_data(7).expect("placeholder row");
        assert!(row.is_loading);
        assert_eq!(row.mnemonic.as_str(), "loading");
    }

    #[test]
    fn row_model_marks_cached_row_selected() {
        let model = DisassemblyRowsModel::default();
        model.configure(1, "m1".to_string(), PAGE_SIZE as usize);
        model.apply_page(
            1,
            "m1",
            0,
            vec![map_linear_row(instruction_row("0x140001000"), &[])],
        );

        model.set_selected_row(Some(0));
        assert!(model.row_data(0).expect("selected row").is_selected);
    }

    #[test]
    fn linear_label_rows_map_text_into_comment_field() {
        let mapped = map_linear_row(
            LinearViewRow {
                kind: "label",
                address: "0x140001000".to_string(),
                bytes: String::new(),
                mnemonic: String::new(),
                operands: String::new(),
                instruction_category: None,
                branch_target: None,
                call_target: None,
                comment: None,
                text: Some("lbl_140001000".to_string()),
            },
            &[],
        );

        assert_eq!(mapped.kind.as_str(), "label");
        assert_eq!(mapped.comment.as_str(), "lbl_140001000");
    }
}
