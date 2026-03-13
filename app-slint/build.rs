fn main() {
    println!("cargo:rerun-if-changed=ui/main-window.slint");
    slint_build::compile("ui/main-window.slint").expect("failed to compile Slint UI");
}
