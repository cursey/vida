fn main() {
    if let Err(error) = engine::run_stdio_server() {
        eprintln!("engine process terminated: {error}");
    }
}
