use slint::Weak as UiWeak;

use crate::MainWindow;

#[derive(Default)]
pub(super) struct StatusBarState {
    pub(super) status_text: String,
    pub(super) current_address: String,
    pub(super) go_to_text: String,
    pub(super) row_count_text: String,
}

pub(super) struct StatusBarController {
    window: UiWeak<MainWindow>,
}

impl StatusBarController {
    pub(super) fn new(window: UiWeak<MainWindow>) -> Self {
        Self { window }
    }

    pub(super) fn apply(&self, state: &StatusBarState, preserve_navigation: bool) {
        let window = self.window.upgrade().expect("window should stay alive");
        window.set_status_text(state.status_text.clone().into());
        if !preserve_navigation {
            window.set_current_address(state.current_address.clone().into());
            window.set_go_to_text(state.go_to_text.clone().into());
            window.set_row_count_text(state.row_count_text.clone().into());
        }
    }

    pub(super) fn set_status_text(&self, status_text: impl Into<String>) {
        self.window
            .upgrade()
            .expect("window should stay alive")
            .set_status_text(status_text.into().into());
    }

    pub(super) fn set_current_address(&self, address: impl Into<String>) {
        let address = address.into();
        let window = self.window.upgrade().expect("window should stay alive");
        window.set_current_address(address.clone().into());
        window.set_go_to_text(address.into());
    }
}
