use std::{
    collections::HashMap,
    io::{BufRead, BufReader, Write},
    path::PathBuf,
    process::{Child, ChildStderr, ChildStdin, Command, Stdio},
    sync::{
        Arc, Mutex,
        mpsc::{self, Receiver, Sender},
    },
    thread::{self, JoinHandle},
    time::Duration,
};

use serde::Deserialize;
use serde_json::{Value, json};
use tauri::{AppHandle, Manager};

type PendingMap = Arc<Mutex<HashMap<u64, Sender<Result<Value, String>>>>>;

#[derive(Debug)]
pub struct EngineProxy {
    inner: Mutex<EngineProcess>,
}

#[derive(Debug)]
struct EngineProcess {
    child: Option<Child>,
    stdin: Option<ChildStdin>,
    next_id: u64,
    pending: PendingMap,
    stdout_thread: Option<JoinHandle<()>>,
    stderr_thread: Option<JoinHandle<()>>,
}

#[derive(Debug, Deserialize)]
#[serde(untagged)]
enum RpcResponse {
    Success {
        id: u64,
        result: Value,
        #[allow(dead_code)]
        jsonrpc: String,
    },
    Failure {
        id: u64,
        error: RpcError,
        #[allow(dead_code)]
        jsonrpc: String,
    },
}

#[derive(Debug, Deserialize)]
struct RpcError {
    code: i64,
    message: String,
    data: Option<RpcErrorData>,
}

#[derive(Debug, Deserialize)]
struct RpcErrorData {
    code: Option<String>,
}

#[derive(Debug)]
struct LaunchTarget {
    command: String,
    args: Vec<String>,
    cwd: PathBuf,
}

impl EngineProxy {
    pub fn new() -> Self {
        Self {
            inner: Mutex::new(EngineProcess {
                child: None,
                stdin: None,
                next_id: 1,
                pending: Arc::new(Mutex::new(HashMap::new())),
                stdout_thread: None,
                stderr_thread: None,
            }),
        }
    }

    pub fn request(&self, app: &AppHandle, method: &str, params: Value) -> Result<Value, String> {
        let (receiver, timeout, request_id, pending_map) = {
            let mut process = self.inner.lock().map_err(|error| error.to_string())?;
            process.ensure_started(app)?;

            let request_id = process.next_id;
            process.next_id += 1;

            let payload = json!({
              "jsonrpc": "2.0",
              "id": request_id,
              "method": method,
              "params": params,
            });

            let (sender, receiver) = mpsc::channel();
            process
                .pending
                .lock()
                .map_err(|error| error.to_string())?
                .insert(request_id, sender);

            let pending_map = Arc::clone(&process.pending);
            let stdin = process
                .stdin
                .as_mut()
                .ok_or_else(|| "Engine process stdin is unavailable".to_string())?;

            if let Err(error) = writeln!(stdin, "{payload}") {
                process
                    .pending
                    .lock()
                    .map_err(|lock_error| lock_error.to_string())?
                    .remove(&request_id);
                return Err(error.to_string());
            }
            if let Err(error) = stdin.flush() {
                process
                    .pending
                    .lock()
                    .map_err(|lock_error| lock_error.to_string())?
                    .remove(&request_id);
                return Err(error.to_string());
            }

            (receiver, timeout_for(method), request_id, pending_map)
        };

        let response = await_response(receiver, timeout);
        if response.is_err()
            && let Ok(mut pending) = pending_map.lock()
        {
            pending.remove(&request_id);
        }
        response
    }

    pub fn stop(&self) {
        if let Ok(mut process) = self.inner.lock() {
            process.stop();
        }
    }
}

impl EngineProcess {
    fn ensure_started(&mut self, app: &AppHandle) -> Result<(), String> {
        if let Some(child) = self.child.as_mut() {
            match child.try_wait().map_err(|error| error.to_string())? {
                Some(_) => self.stop(),
                None => return Ok(()),
            }
        }

        let launch = resolve_launch_target(app)?;
        let mut command = Command::new(&launch.command);
        command
            .args(&launch.args)
            .current_dir(&launch.cwd)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());

        let mut child = command.spawn().map_err(|error| {
            format!(
                "Failed to start engine process '{}': {error}",
                launch.command
            )
        })?;

        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| "Failed to open engine stdin".to_string())?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| "Failed to open engine stdout".to_string())?;
        let stderr = child
            .stderr
            .take()
            .ok_or_else(|| "Failed to open engine stderr".to_string())?;

        let pending_for_stdout = Arc::clone(&self.pending);
        let stdout_thread = thread::spawn(move || {
            process_stdout(stdout, pending_for_stdout);
        });
        let stderr_thread = thread::spawn(move || {
            process_stderr(stderr);
        });

        self.child = Some(child);
        self.stdin = Some(stdin);
        self.stdout_thread = Some(stdout_thread);
        self.stderr_thread = Some(stderr_thread);

        Ok(())
    }

    fn stop(&mut self) {
        if let Some(mut child) = self.child.take() {
            let _ = child.kill();
            let _ = child.wait();
        }

        self.stdin = None;

        if let Some(handle) = self.stdout_thread.take() {
            let _ = handle.join();
        }
        if let Some(handle) = self.stderr_thread.take() {
            let _ = handle.join();
        }

        reject_all_pending(
            &self.pending,
            "Engine process exited before the request completed".to_string(),
        );
    }
}

fn resolve_launch_target(app: &AppHandle) -> Result<LaunchTarget, String> {
    let repo_root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("..")
        .canonicalize()
        .map_err(|error| error.to_string())?;
    let engine_debug_path = repo_root
        .join("engine")
        .join("target")
        .join("debug")
        .join("engine.exe");

    if engine_debug_path.is_file() {
        return Ok(LaunchTarget {
            command: engine_debug_path.to_string_lossy().into_owned(),
            args: Vec::new(),
            cwd: repo_root,
        });
    }

    let resource_engine_path = app
        .path()
        .resource_dir()
        .map_err(|error| error.to_string())?
        .join(sidecar_file_name());
    if resource_engine_path.is_file() {
        return Ok(LaunchTarget {
            command: resource_engine_path.to_string_lossy().into_owned(),
            args: Vec::new(),
            cwd: repo_root,
        });
    }

    Ok(LaunchTarget {
        command: "cargo".to_string(),
        args: vec![
            "run".to_string(),
            "--manifest-path".to_string(),
            repo_root
                .join("engine")
                .join("Cargo.toml")
                .to_string_lossy()
                .into_owned(),
            "--quiet".to_string(),
        ],
        cwd: repo_root,
    })
}

fn sidecar_file_name() -> String {
    format!("engine-{}.exe", env!("APP_TAURI_TARGET_TRIPLE"))
}

fn process_stdout(stdout: impl std::io::Read, pending: PendingMap) {
    let reader = BufReader::new(stdout);
    for line in reader.lines() {
        let Ok(line) = line else {
            break;
        };
        if line.trim().is_empty() {
            continue;
        }

        match serde_json::from_str::<RpcResponse>(&line) {
            Ok(RpcResponse::Success { id, result, .. }) => {
                let sender = pending.lock().ok().and_then(|mut map| map.remove(&id));
                if let Some(sender) = sender {
                    let _ = sender.send(Ok(result));
                }
            }
            Ok(RpcResponse::Failure { id, error, .. }) => {
                let sender = pending.lock().ok().and_then(|mut map| map.remove(&id));
                if let Some(sender) = sender {
                    let message = match error.data.and_then(|data| data.code) {
                        Some(code) => format!("{} ({}; rpc={})", error.message, code, error.code),
                        None => format!("{} (rpc={})", error.message, error.code),
                    };
                    let _ = sender.send(Err(message));
                }
            }
            Err(error) => {
                eprintln!("Failed to parse engine JSON-RPC response: {error}");
            }
        }
    }

    reject_all_pending(
        &pending,
        "Engine process stream closed before the request completed".to_string(),
    );
}

fn process_stderr(stderr: ChildStderr) {
    let reader = BufReader::new(stderr);
    for line in reader.lines() {
        let Ok(line) = line else {
            break;
        };
        if !line.trim().is_empty() {
            eprintln!("[engine] {line}");
        }
    }
}

fn reject_all_pending(pending: &PendingMap, message: String) {
    if let Ok(mut pending) = pending.lock() {
        for (_, sender) in pending.drain() {
            let _ = sender.send(Err(message.clone()));
        }
    }
}

fn await_response(
    receiver: Receiver<Result<Value, String>>,
    timeout: Option<Duration>,
) -> Result<Value, String> {
    match timeout {
        Some(timeout) => receiver
            .recv_timeout(timeout)
            .map_err(|_| "Engine request timed out".to_string())?,
        None => receiver
            .recv()
            .map_err(|_| "Engine request channel closed".to_string())?,
    }
}

fn timeout_for(method: &str) -> Option<Duration> {
    match method {
        "module.open" | "module.unload" => None,
        "module.getAnalysisStatus" => Some(Duration::from_secs(5)),
        _ => Some(Duration::from_secs(10)),
    }
}

#[cfg(test)]
mod tests {
    use super::{sidecar_file_name, timeout_for};

    #[test]
    fn sidecar_name_matches_windows_bundle_pattern() {
        assert!(sidecar_file_name().starts_with("engine-"));
        assert!(sidecar_file_name().ends_with(".exe"));
    }

    #[test]
    fn timeout_policy_matches_electron_behavior() {
        assert_eq!(timeout_for("module.open"), None);
        assert_eq!(timeout_for("module.unload"), None);
        assert_eq!(
            timeout_for("module.getAnalysisStatus").unwrap().as_secs(),
            5
        );
        assert_eq!(timeout_for("engine.ping").unwrap().as_secs(), 10);
    }
}
