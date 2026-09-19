#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

//! Native Tauri shell for the opencode-skins manager.
//! Spawns the tested Node backend (manager.mjs) and shows it in a native window;
//! the Node process is killed when the app exits.

use std::net::TcpStream;
use std::path::PathBuf;
use std::process::{Child, Command};
use std::sync::Mutex;
use std::time::{Duration, Instant};

#[cfg(windows)]
use std::os::windows::process::CommandExt;

use tauri::{Manager, RunEvent, WebviewUrl, WebviewWindowBuilder};

const PORT: u16 = 7788;

struct Backend(Mutex<Option<Child>>);

/// Find the opencode-skins project folder (the one containing manager.mjs).
fn find_project() -> Option<PathBuf> {
    let mut cands: Vec<PathBuf> = Vec::new();
    if let Ok(h) = std::env::var("OCSKINS_HOME") {
        cands.push(PathBuf::from(h));
    }
    if let Ok(up) = std::env::var("USERPROFILE") {
        cands.push(PathBuf::from(up).join("opencode-skins"));
    }
    // dev: <crate>/../.. == the project root
    cands.push(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..").join(".."));
    // bundled: <exe dir>/resources/backend
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            cands.push(dir.join("resources").join("backend"));
        }
    }
    cands.into_iter().find(|c| c.join("manager.mjs").exists())
}

fn wait_port(port: u16, timeout: Duration) -> bool {
    let start = Instant::now();
    while start.elapsed() < timeout {
        if TcpStream::connect(("127.0.0.1", port)).is_ok() {
            return true;
        }
        std::thread::sleep(Duration::from_millis(120));
    }
    false
}

fn spawn_backend(project: &PathBuf) -> Result<Child, String> {
    let node = if cfg!(windows) { "node.exe" } else { "node" };
    let mut cmd = Command::new(node);
    cmd.arg(project.join("manager.mjs"))
        .arg("--no-open")
        .arg("--port")
        .arg(PORT.to_string())
        .current_dir(project);
    #[cfg(windows)]
    cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW — no console flash
    cmd.spawn()
        .map_err(|e| format!("failed to launch Node backend: {e}. Is Node.js installed and on PATH?"))
}

fn main() {
    let app = tauri::Builder::default()
        .manage(Backend(Mutex::new(None)))
        .setup(|app| {
            let project = find_project().ok_or(
                "opencode-skins project not found. Set OCSKINS_HOME to the folder that contains manager.mjs.",
            )?;
            let child = spawn_backend(&project)?;
            app.state::<Backend>().0.lock().unwrap().replace(child);

            wait_port(PORT, Duration::from_secs(20));

            let url = tauri::Url::parse(&format!("http://127.0.0.1:{PORT}/")).unwrap();
            let handle = app.handle().clone();
            WebviewWindowBuilder::new(&handle, "main", WebviewUrl::External(url))
                .title("opencode-skins Manager")
                .inner_size(1200.0, 840.0)
                .min_inner_size(920.0, 640.0)
                .center()
                .build()?;
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("failed to build opencode-skins-manager");

    app.run(|handle, event| {
        if let RunEvent::Exit = event {
            if let Some(mut child) = handle.state::<Backend>().0.lock().unwrap().take() {
                let _ = child.kill();
            }
        }
    });
}
