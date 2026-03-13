slint::include_modules!();

mod controller;

use controller::AppController;

fn main() -> Result<(), slint::PlatformError> {
    let window = MainWindow::new()?;
    let controller = AppController::new(&window);
    controller.bind();
    window.run()
}
