use std::cell::RefCell;
use std::collections::{HashMap, HashSet, VecDeque};
use std::rc::Rc;

use engine::api::{LinearViewRow, SectionInfo};
use slint::{Model, ModelNotify, SharedString};

use crate::UiLinearRow;

pub(super) const PAGE_SIZE: u64 = 512;
const MAX_CACHED_PAGES: usize = 32;

#[derive(Clone)]
pub(super) struct SectionRange {
    name: SharedString,
    start: u64,
    end: u64,
}

#[derive(Clone)]
pub(super) struct PageRequest {
    pub(super) generation: u64,
    pub(super) module_id: String,
    pub(super) page: u64,
}

pub(super) struct DisassemblyRowsModel {
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
    pub(super) fn set_requester(&self, requester: impl Fn(PageRequest) + 'static) {
        *self.requester.borrow_mut() = Some(Rc::new(requester));
    }

    pub(super) fn reset(&self, generation: u64) {
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

    pub(super) fn configure(&self, generation: u64, module_id: String, row_count: usize) {
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

    pub(super) fn set_selected_row(&self, selected_row: Option<usize>) {
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

    pub(super) fn apply_page(
        &self,
        generation: u64,
        module_id: &str,
        page: u64,
        mut rows: Vec<UiLinearRow>,
    ) {
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

    pub(super) fn mark_page_complete(&self, generation: u64, module_id: &str, page: u64) {
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

pub(super) fn map_linear_row(row: LinearViewRow, sections: &[SectionRange]) -> UiLinearRow {
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

pub(super) fn build_section_ranges(sections: &[SectionInfo]) -> Vec<SectionRange> {
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

pub(super) fn normalize_hex_address(raw: &str) -> String {
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
