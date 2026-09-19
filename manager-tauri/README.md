# opencode-skins Manager — Tauri shell

A native desktop wrapper (Tauri v2) around the [visual manager](../manager). It
opens a real app window and, inside it, runs the tested Node backend
(`manager.mjs`) — so all file/system operations work through Node exactly as in
the browser version, just in a standalone window.

```
manager-tauri/
├─ dist/index.html          # loading placeholder (frontendDist)
└─ src-tauri/
   ├─ Cargo.toml
   ├─ build.rs
   ├─ tauri.conf.json
   └─ src/main.rs           # spawns node manager.mjs, opens the window, kills it on exit
```

## Prerequisites
- **Rust** (`rustup`, MSVC toolchain on Windows) and **Node.js** on PATH.
- WebView2 (preinstalled on Windows 11).
- Tauri CLI (optional, only for building an installer): `cargo install tauri-cli` or `npm i -g @tauri-apps/cli`.

## Run / build

```bash
# from manager-tauri/src-tauri
cargo run                       # dev: compile + launch the app
cargo build --release           # produce target/release/opencode-skins-manager.exe
```

The app finds the project (the folder with `manager.mjs`) via, in order:
`OCSKINS_HOME` env → `%USERPROFILE%\opencode-skins` → the crate's `../..` →
`<exe>/resources/backend`. So on this machine it just works; elsewhere set
`OCSKINS_HOME`.

## Make an installer (optional)
Add icons then bundle:

```bash
cargo tauri icon path/to/icon.png     # generates src-tauri/icons/*
# set "bundle.active": true in tauri.conf.json, then:
cargo tauri build                     # -> NSIS installer in target/release/bundle/
```

For a fully self-contained installer, also bundle the backend: copy
`manager.mjs`, `manager/`, `install.mjs`, `fetch-live2d.mjs`, `skins/` into a
`backend/` folder and add it to `bundle.resources` (the app already looks in
`<exe>/resources/backend`). Node.js is still required at runtime unless you also
ship a node sidecar binary.

## Notes
- The window loads `http://127.0.0.1:7788`; the Node process is terminated when
  the window/app closes.
- File operations run in Node (full fs access) — the native shell is the window +
  process lifecycle. A future version can move file ops to native Rust/Tauri
  commands to drop the Node dependency.
