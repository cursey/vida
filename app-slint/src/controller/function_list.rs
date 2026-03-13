use std::cell::RefCell;

use slint::{Model, ModelNotify};

use crate::UiFunctionItem;

pub(super) struct FunctionListModel {
    items: RefCell<Vec<UiFunctionItem>>,
    notify: ModelNotify,
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
    pub(super) fn replace(&self, items: Vec<UiFunctionItem>) {
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
