# Change Files

## 2026-03-08 - Reorganize Renderer Shell, Platform, and Shared Contracts

App:
- `app/src/renderer/App.tsx`
- `app/src/renderer/main.tsx`
- `app/src/renderer/features/browser/browser-panel.tsx`
- `app/src/renderer/features/browser/function-provenance.test.ts`
- `app/src/renderer/features/disassembly/disassembly-panel.tsx`
- `app/src/renderer/features/disassembly/memory-overview-bar.tsx`
- `app/src/renderer/features/graph/graph-panel.tsx`
- `app/src/renderer/lib/dom-utils.ts`
- `app/src/renderer/lib/number-utils.ts`
- `app/src/renderer/platform/desktop-api.ts`
- `app/src/renderer/shell/App.tsx`
- `app/src/renderer/shell/app.disassembly-window.test.tsx`
- `app/src/renderer/shell/app.function-browser-window.test.tsx`
- `app/src/renderer/shell/app.function-browser.test.tsx`
- `app/src/renderer/shell/app.graph-view.test.tsx`
- `app/src/renderer/shell/app.loading-modal.test.tsx`
- `app/src/renderer/shell/app.window-chrome.test.tsx`
- `app/src/renderer/shell/app.xrefs-modal.test.tsx`
- `app/src/renderer/shell/components/app-dialogs.tsx`
- `app/src/renderer/shell/components/panel.tsx`
- `app/src/renderer/shell/components/status-bar.tsx`
- `app/src/renderer/shell/components/theme-provider.tsx`
- `app/src/renderer/shell/components/window-chrome.tsx`
- `app/src/renderer/shell/hooks/use-panel-layout.ts`
- `app/src/renderer/shell/hooks/use-shell-chrome.ts`
- `app/src/renderer/shell/utils/deferred-edge-rebase.ts`
- `app/src/renderer/test-utils/mock-desktop-api.ts`
- `app/src/renderer/test-utils/setup.ts`
- `app/src/shared/desktop-contracts.ts`
- `app/src/shared/engine-contracts.ts`
- `app/src/shared/index.ts`
- `app/src/shared/protocol.ts`
- `app/vitest.config.ts`

Docs:
- `docs/work_log.md`
- `docs/change_files.md`

## 2026-03-08 - Restore Graph Instruction Listing Layout

App:
- `app/src/renderer/features/graph/graph-panel.tsx`
- `app/src/renderer/features/graph/graph-panel.test.ts`
- `app/src/renderer/styles/custom-renderers.css`

Docs:
- `docs/work_log.md`
- `docs/change_files.md`

## 2026-03-08 - Optimize Engine Analysis with Lazy Instruction Rendering

Engine:
- `engine/src/analysis.rs`
- `engine/src/cfg.rs`
- `engine/src/disasm.rs`
- `engine/src/linear.rs`
- `engine/src/state.rs`
- `engine/src/tests.rs`
- `engine/tests/engine_integration.rs`

Docs:
- `docs/work_log.md`
- `docs/change_files.md`
- `docs/engine_benchmarking.md`

## 2026-03-08 - Add Drag-and-Drop Workspace Import

App:
- `app/src/renderer/App.tsx`
- `app/src/renderer/desktop-api.ts`
- `app/src/shared/protocol.ts`
- `app/src/renderer/test/mock-desktop-api.ts`

Docs:
- `docs/work_log.md`
- `docs/change_files.md`

## 2026-03-08 - Add Idle Workspace Prompt

App:
- `app/src/renderer/App.tsx`
- `app/src/renderer/App.window-chrome.test.tsx`

Docs:
- `docs/work_log.md`
- `docs/change_files.md`

## 2026-03-08 - Replace Loading Modal With Workspace Spinner

App:
- `app/src/renderer/App.loading-modal.test.tsx`
- `app/src/renderer/App.tsx`

Docs:
- `docs/work_log.md`
- `docs/change_files.md`

## 2026-03-08 - Hide Empty Analysis Views Until Analysis Is Ready

App:
- `app/src/renderer/App.disassembly-window.test.tsx`
- `app/src/renderer/App.tsx`
- `app/src/renderer/App.window-chrome.test.tsx`
- `app/src/renderer/features/disassembly/memory-overview-bar.tsx`

Docs:
- `docs/work_log.md`
- `docs/change_files.md`

## 2026-03-08 - Simplify Window Chrome Style Reuse

App:
- `app/src/renderer/components/window-chrome.tsx`

Docs:
- `docs/work_log.md`
- `docs/change_files.md`

## 2026-03-08 - Finish Disassembly and Custom Renderer Style Cleanup

App:
- `app/src/renderer/features/disassembly/disassembly-panel.tsx`
- `app/src/renderer/features/disassembly/memory-overview-bar.tsx`
- `app/src/renderer/features/graph/graph-panel.tsx`
- `app/src/renderer/styles.css`
- `app/src/renderer/styles/custom-renderers.css`
- `app/src/renderer/styles/disassembly.css`

Docs:
- `docs/renderer_styling.md`
- `docs/work_log.md`
- `docs/change_files.md`

## 2026-03-08 - Split Renderer Styles Into Scoped Modules

App:
- `app/src/renderer/App.disassembly-window.test.tsx`
- `app/src/renderer/App.function-browser-window.test.tsx`
- `app/src/renderer/App.function-browser.test.tsx`
- `app/src/renderer/App.loading-modal.test.tsx`
- `app/src/renderer/App.tsx`
- `app/src/renderer/components/app/panel.tsx`
- `app/src/renderer/components/mode-toggle.tsx`
- `app/src/renderer/components/window-chrome.tsx`
- `app/src/renderer/features/app/app-dialogs.tsx`
- `app/src/renderer/features/app/status-bar.tsx`
- `app/src/renderer/features/browser/browser-panel.tsx`
- `app/src/renderer/features/disassembly/disassembly-panel.tsx`
- `app/src/renderer/features/disassembly/memory-overview-bar.tsx`
- `app/src/renderer/features/graph/graph-panel.tsx`
- `app/src/renderer/styles.css`
- `app/src/renderer/styles/base.css`
- `app/src/renderer/styles/custom-renderers.css`
- `app/src/renderer/styles/disassembly.css`
- `app/src/renderer/styles/theme.css`
- `app/src/renderer/styles/utilities.css`

Docs:
- `docs/work_log.md`
- `docs/change_files.md`

## 2026-03-08 - Add Disassembly Xref Modal Shortcut and Navigation

App:
- `app/src-tauri/capabilities/default.json`
- `app/src-tauri/permissions/autogenerated/get_xrefs_to_va.toml`
- `app/src-tauri/src/main.rs`
- `app/src/renderer/App.tsx`
- `app/src/renderer/App.xrefs-modal.test.tsx`
- `app/src/renderer/desktop-api.ts`
- `app/src/renderer/features/app/app-dialogs.tsx`
- `app/src/renderer/styles.css`
- `app/src/renderer/test/mock-desktop-api.ts`
- `app/src/shared/protocol.ts`

Docs:
- `docs/work_log.md`
- `docs/change_files.md`

## 2026-03-08 - Add Engine Xref Indexing and VA Query Support

Engine:
- `engine/benches/analysis_bench.rs`
- `engine/src/analysis.rs`
- `engine/src/api.rs`
- `engine/src/cfg.rs`
- `engine/src/linear.rs`
- `engine/src/pe_utils.rs`
- `engine/src/state.rs`
- `engine/tests/engine_integration.rs`

Docs:
- `docs/engine_benchmarking.md`
- `docs/work_log.md`
- `docs/change_files.md`

## 2026-03-08 - Remove Native Menu Updates From Custom Chrome App

App:
- `app/src-tauri/src/main.rs`

Docs:
- `docs/work_log.md`
- `docs/change_files.md`

## 2026-03-08 - Remove Embedded Engine Status Badge and Ping

App:
- `app/src-tauri/build.rs`
- `app/src-tauri/src/main.rs`
- `app/src/renderer/App.tsx`
- `app/src/renderer/desktop-api.ts`
- `app/src/renderer/features/app/status-bar.tsx`
- `app/src/renderer/styles.css`
- `app/src/renderer/test/mock-desktop-api.ts`
- `app/src/shared/protocol.ts`

Engine:
- `engine/src/api.rs`
- `engine/src/state.rs`
- `engine/src/tests.rs`

Docs:
- `docs/work_log.md`
- `docs/change_files.md`

## 2026-03-08 - Refine Windows App Icon Assets

Root:
- `justfile`

App:
- `app/scripts/generate_windows_icon.py`
- `app/src-tauri/build.rs`
- `app/src-tauri/icons/icon-source.png`
- `app/src-tauri/icons/icon.ico`

Docs:
- `docs/work_log.md`
- `docs/change_files.md`

## 2026-03-08 - Simplify Memory Overview Into Fixed Slices

App:
- `app/src/shared/protocol.ts`
- `app/src/renderer/App.disassembly-window.test.tsx`
- `app/src/renderer/features/disassembly/memory-overview-bar.tsx`
- `app/src/renderer/styles.css`
- `app/src/renderer/test/mock-desktop-api.ts`

Engine:
- `engine/benches/analysis_bench.rs`
- `engine/src/api.rs`
- `engine/src/state.rs`
- `engine/tests/engine_integration.rs`

Docs:
- `docs/engine_benchmarking.md`
- `docs/work_log.md`
- `docs/change_files.md`

## 2026-03-08 - Prioritize Ready Disassembly Paint and Cache Memory Overview

App:
- `app/src/renderer/App.tsx`

Engine:
- `engine/benches/analysis_bench.rs`
- `engine/src/analysis.rs`
- `engine/src/state.rs`

Docs:
- `docs/engine_benchmarking.md`
- `docs/work_log.md`
- `docs/change_files.md`

## 2026-03-08 - Defer Browser List and Memory Bar Until Analysis Ready

App:
- `app/src/renderer/App.tsx`
- `app/src/renderer/App.disassembly-window.test.tsx`
- `app/src/renderer/features/browser/browser-panel.tsx`

Docs:
- `docs/work_log.md`
- `docs/change_files.md`

## 2026-03-07 - Add Memory Bar Navigation and Placeholder Refinements

App:
- `app/src/renderer/App.tsx`
- `app/src/renderer/App.disassembly-window.test.tsx`
- `app/src/renderer/features/disassembly/memory-overview-bar.tsx`
- `app/src/renderer/styles.css`

Docs:
- `docs/work_log.md`
- `docs/change_files.md`

## 2026-03-07 - Add Shell Memory Layout Overview Bar

App:
- `app/src-tauri/capabilities/default.json`
- `app/src-tauri/permissions/autogenerated/get_module_memory_overview.toml`
- `app/src-tauri/src/main.rs`
- `app/src/shared/protocol.ts`
- `app/src/renderer/App.tsx`
- `app/src/renderer/desktop-api.ts`
- `app/src/renderer/features/disassembly/disassembly-panel.tsx`
- `app/src/renderer/features/disassembly/memory-overview-bar.tsx`
- `app/src/renderer/styles.css`
- `app/src/renderer/test/mock-desktop-api.ts`
- `app/src/renderer/App.disassembly-window.test.tsx`
- `app/src/renderer/App.graph-view.test.tsx`

Engine:
- `engine/src/api.rs`
- `engine/src/pe_utils.rs`
- `engine/src/state.rs`
- `engine/tests/engine_integration.rs`

Docs:
- `docs/work_log.md`
- `docs/change_files.md`

## 2026-03-07 - Discover Functions from Direct Call Targets

App:
- `app/src/shared/protocol.ts`
- `app/src/renderer/features/browser/function-provenance.ts`
- `app/src/renderer/App.function-provenance.test.ts`

Engine:
- `engine/src/analysis.rs`
- `engine/src/pe_utils.rs`
- `engine/tests/engine_integration.rs`

Docs:
- `docs/work_log.md`
- `docs/change_files.md`

## 2026-03-07 - Improve Engine Analysis Cancellation Responsiveness

Engine:
- `engine/src/analysis.rs`
- `engine/src/cfg.rs`

Docs:
- `docs/work_log.md`
- `docs/change_files.md`

## 2026-03-07 - Parallelize Per-Function Engine Analysis

Engine:
- `engine/src/analysis.rs`
- `engine/tests/engine_integration.rs`

Docs:
- `docs/engine_benchmarking.md`
- `docs/work_log.md`
- `docs/change_files.md`

## 2026-03-07 - Record Full Hybrid Benchmark Baseline

Docs:
- `docs/engine_benchmarking.md`
- `docs/work_log.md`
- `docs/change_files.md`

## 2026-03-07 - Implement Hybrid Engine Benchmark Workflow

Root:
- `justfile`

Engine:
- `engine/benches/analysis_bench.rs`
- `engine/tests/fixtures/README.md`
- `engine/tests/fixtures/generate_bench_fixtures.py`
- `engine/tests/fixtures/bench_no_pdb/minimal_x64.exe`
- `engine/tests/fixtures/bench_overlay/minimal_x64_overlay_4mb.exe`

Docs:
- `docs/engine_benchmarking.md`
- `docs/work_log.md`
- `docs/change_files.md`

## 2026-03-07 - Add Benchmark Reporting Template and AGENTS Instructions

Docs:
- `docs/engine_benchmarking.md`

Root:
- `AGENTS.md`

## 2026-03-07 - Expand Engine Benchmark Coverage

Engine:
- `engine/benches/analysis_bench.rs`

Docs:
- `docs/engine_benchmarking.md`
- `docs/work_log.md`
- `docs/change_files.md`

## 2026-03-07 - Optimize Instruction Ownership Lookup with Ranges

Engine:
- `engine/src/analysis.rs`
- `engine/src/state.rs`
- `engine/tests/engine_integration.rs`

Docs:
- `docs/engine_benchmarking.md`
- `docs/work_log.md`
- `docs/change_files.md`

## 2026-03-07 - Add Example Filled Benchmark Entry

Docs:
- `docs/engine_benchmarking.md`

## 2026-03-07 - Add Engine Benchmarking Documentation

Docs:
- `docs/engine_benchmarking.md`
- `docs/README.md`
- `docs/work_log.md`
- `docs/change_files.md`

## 2026-03-07 - Add Shared Bench Command to Justfile

Root:
- `justfile`

Docs:
- `docs/work_log.md`
- `docs/change_files.md`

## 2026-03-07 - Add Criterion Benchmark Harness and Validate Speedup

Engine:
- `engine/Cargo.toml`
- `engine/Cargo.lock`
- `engine/benches/analysis_bench.rs`

Docs:
- `docs/work_log.md`
- `docs/change_files.md`

## 2026-03-07 - Continue Low-Risk Engine Profiling Optimizations

Engine:
- `engine/src/analysis.rs`
- `engine/src/linear.rs`

Docs:
- `docs/work_log.md`
- `docs/change_files.md`

## 2026-03-07 - Rename Tauri Workspace from `app-tauri` to `app`

Root:
- `.gitignore`
- `AGENTS.md`
- `justfile`

Docs:
- `docs/work_log.md`
- `docs/change_files.md`
- `docs/electron_disassembler_project_scope.md`

app:
- `app/` (renamed from `app-tauri/`)
- `app/package.json`
- `app/package-lock.json`
- `app/src-tauri/Cargo.toml`
- `app/src-tauri/Cargo.lock`

## 2026-03-07 - Remove Vite Dev Server from Tauri Runtime Flow

Docs:
- `docs/work_log.md`
- `docs/change_files.md`

app-tauri:
- `app-tauri/package.json`
- `app-tauri/vite.config.ts`
- `app-tauri/src-tauri/tauri.conf.json`

## 2026-03-07 - Merge Tauri Host and Engine into One Rust Backend

Root:
- `AGENTS.md`
- `justfile`

Docs:
- `docs/work_log.md`
- `docs/change_files.md`
- `docs/electron_disassembler_project_scope.md`

app-tauri:
- `app-tauri/biome.json`
- `app-tauri/package.json`
- `app-tauri/package-lock.json`
- `app-tauri/src/shared/protocol.ts`
- `app-tauri/src/renderer/desktop-api.ts`
- `app-tauri/src-tauri/Cargo.toml`
- `app-tauri/src-tauri/Cargo.lock`
- `app-tauri/src-tauri/build.rs`
- `app-tauri/src-tauri/capabilities/default.json`
- `app-tauri/src-tauri/permissions/autogenerated/*.toml`
- `app-tauri/src-tauri/src/main.rs`
- `app-tauri/src-tauri/tauri.conf.json`
- `app-tauri/scripts/` (removed protocol/sidecar scripts)
- `app-tauri/test/protocol-schema.test.js` (removed)

engine:
- `engine/src/api.rs`
- `engine/src/lib.rs`
- `engine/src/state.rs`
- `engine/src/error.rs`
- `engine/src/analysis.rs`
- `engine/src/cfg.rs`
- `engine/src/disasm.rs`
- `engine/src/linear.rs`
- `engine/src/tests.rs`
- `engine/src/main.rs` (removed)
- `engine/src/protocol.rs` (removed)
- `engine/src/rpc.rs` (removed)
- `engine/tests/contract_schema_tests.rs` (removed)
- `engine/tests/engine_integration.rs`

shared:
- `shared/` (removed)

## 2026-03-07 - Remove Legacy Electron App Workspace

Root:
- `.gitignore`
- `AGENTS.md`
- `justfile`

Docs:
- `docs/work_log.md`
- `docs/change_files.md`
- `docs/electron_disassembler_project_scope.md`

shared:
- `shared/README.md`
- `shared/schemas/protocol.schema.json`

app-tauri:
- `app-tauri/scripts/generate-protocol-types.mjs`
- `app-tauri/src/shared/protocol.gen.ts`

app-electron:
- `app-electron/` (removed)

## 2026-03-07 - Replace Electron Shell with Tauri 2 App Workspace

Root:
- `.gitignore`
- `justfile`

Docs:
- `docs/work_log.md`
- `docs/change_files.md`

app-tauri:
- `app-tauri/biome.json`
- `app-tauri/components.json`
- `app-tauri/index.html`
- `app-tauri/package.json`
- `app-tauri/package-lock.json`
- `app-tauri/postcss.config.cjs`
- `app-tauri/tailwind.config.cjs`
- `app-tauri/vite.config.ts`
- `app-tauri/vitest.config.ts`
- `app-tauri/tsconfig.node.json`
- `app-tauri/tsconfig.renderer.json`
- `app-tauri/scripts/generate-protocol-types.mjs`
- `app-tauri/scripts/prepare-engine-sidecar.mjs`
- `app-tauri/test/protocol-schema.test.js`
- `app-tauri/test/smoke.test.js`
- `app-tauri/test/ui-consistency.test.js`
- `app-tauri/src/shared/protocol.ts`
- `app-tauri/src/shared/protocol.gen.ts`
- `app-tauri/src/renderer/main.tsx`
- `app-tauri/src/renderer/App.tsx`
- `app-tauri/src/renderer/App.disassembly-window.test.tsx`
- `app-tauri/src/renderer/App.function-browser.test.tsx`
- `app-tauri/src/renderer/App.function-browser-window.test.tsx`
- `app-tauri/src/renderer/App.function-provenance.test.ts`
- `app-tauri/src/renderer/App.graph-view.test.tsx`
- `app-tauri/src/renderer/App.loading-modal.test.tsx`
- `app-tauri/src/renderer/App.window-chrome.test.tsx`
- `app-tauri/src/renderer/desktop-api.ts`
- `app-tauri/src/renderer/styles.css`
- `app-tauri/src/renderer/test/setup.ts`
- `app-tauri/src/renderer/test/mock-desktop-api.ts`
- `app-tauri/src/renderer/lib/utils.ts`
- `app-tauri/src/renderer/lib/utils.test.ts`
- `app-tauri/src/renderer/components/mode-toggle.tsx`
- `app-tauri/src/renderer/components/mode-toggle.test.tsx`
- `app-tauri/src/renderer/components/theme-provider.tsx`
- `app-tauri/src/renderer/components/window-chrome.tsx`
- `app-tauri/src/renderer/components/ui/badge.tsx`
- `app-tauri/src/renderer/components/ui/button.tsx`
- `app-tauri/src/renderer/components/ui/dialog.tsx`
- `app-tauri/src/renderer/components/ui/dropdown-menu.tsx`
- `app-tauri/src/renderer/components/ui/input.tsx`
- `app-tauri/src/renderer/components/ui/scroll-area.tsx`
- `app-tauri/src/renderer/components/ui/separator.tsx`
- `app-tauri/src/renderer/features/app/app-dialogs.tsx`
- `app-tauri/src/renderer/features/app/status-bar.tsx`
- `app-tauri/src/renderer/features/browser/browser-panel.tsx`
- `app-tauri/src/renderer/features/browser/function-provenance.ts`
- `app-tauri/src/renderer/features/disassembly/disassembly-panel.tsx`
- `app-tauri/src/renderer/features/graph/graph-panel.tsx`
- `app-tauri/src/renderer/features/shared/deferred-edge-rebase.ts`
- `app-tauri/src/renderer/features/shared/dom-utils.ts`
- `app-tauri/src/renderer/features/shared/number-utils.ts`
- `app-tauri/src-tauri/build.rs`
- `app-tauri/src-tauri/Cargo.toml`
- `app-tauri/src-tauri/Cargo.lock`
- `app-tauri/src-tauri/tauri.conf.json`
- `app-tauri/src-tauri/capabilities/default.json`
- `app-tauri/src-tauri/icons/icon.ico`
- `app-tauri/src-tauri/permissions/autogenerated/add_recent_executable.toml`
- `app-tauri/src-tauri/permissions/autogenerated/engine_request.toml`
- `app-tauri/src-tauri/permissions/autogenerated/get_title_bar_menu_model.toml`
- `app-tauri/src-tauri/permissions/autogenerated/get_window_chrome_state.toml`
- `app-tauri/src-tauri/permissions/autogenerated/invoke_title_bar_menu_action.toml`
- `app-tauri/src-tauri/permissions/autogenerated/pick_executable.toml`
- `app-tauri/src-tauri/permissions/autogenerated/window_control.toml`
- `app-tauri/src-tauri/src/engine.rs`
- `app-tauri/src-tauri/src/main.rs`

Engine:
- `engine/src/pdb_symbols.rs`

## 2026-03-06 - Fix C++ PDB Name Extraction for Complex Template Signatures

Docs:
- `docs/work_log.md`
- `docs/change_files.md`

Engine:
- `engine/src/pdb_symbols.rs`

## 2026-03-06 - Simplify PDB Demangled Names to Function Names

Docs:
- `docs/work_log.md`
- `docs/change_files.md`

Engine:
- `engine/src/pdb_symbols.rs`
- `engine/tests/engine_integration.rs`

## 2026-03-06 - Add Repository MIT License Metadata

Root:
- `LICENSE`

Docs:
- `docs/work_log.md`
- `docs/change_files.md`

Electron app:
- `app-electron/package.json`

Engine:
- `engine/Cargo.toml`

## 2026-03-06 - Background Module Analysis and Progress Reporting

Docs:
- `docs/work_log.md`
- `docs/change_files.md`

Shared:
- `shared/schemas/protocol.schema.json`

Electron app:
- `app-electron/src/main/engineClient.ts`
- `app-electron/src/main/main.ts`
- `app-electron/src/preload.ts`
- `app-electron/src/shared/protocol.gen.ts`
- `app-electron/src/shared/protocol.ts`
- `app-electron/src/renderer/App.tsx`
- `app-electron/src/renderer/App.disassembly-window.test.tsx`
- `app-electron/src/renderer/App.function-browser-window.test.tsx`
- `app-electron/src/renderer/App.function-browser.test.tsx`
- `app-electron/src/renderer/App.graph-view.test.tsx`
- `app-electron/src/renderer/App.loading-modal.test.tsx`
- `app-electron/src/renderer/App.window-chrome.test.tsx`
- `app-electron/src/renderer/features/app/app-dialogs.tsx`
- `app-electron/src/renderer/features/app/status-bar.tsx`
- `app-electron/src/renderer/features/browser/browser-panel.tsx`
- `app-electron/src/renderer/features/disassembly/disassembly-panel.tsx`
- `app-electron/src/renderer/styles.css`
- `app-electron/test/protocol-schema.test.js`

Engine:
- `engine/src/analysis.rs`
- `engine/src/error.rs`
- `engine/src/protocol.rs`
- `engine/src/state.rs`
- `engine/tests/contract_schema_tests.rs`
- `engine/tests/engine_integration.rs`

## 2026-03-06 - Rebuild Engine Analysis Around Function-Scoped Disassembly

Docs:
- `docs/work_log.md`
- `docs/change_files.md`

Shared:
- `shared/schemas/protocol.schema.json`

Electron app:
- `app-electron/src/shared/protocol.ts`
- `app-electron/src/renderer/features/browser/function-provenance.ts`
- `app-electron/src/renderer/styles.css`
- `app-electron/src/renderer/App.function-provenance.test.ts`
- `app-electron/test/protocol-schema.test.js`

Engine:
- `engine/src/lib.rs`
- `engine/src/analysis.rs`
- `engine/src/cfg.rs`
- `engine/src/linear.rs`
- `engine/src/pe_utils.rs`
- `engine/src/state.rs`
- `engine/src/tests.rs`
- `engine/tests/contract_schema_tests.rs`
- `engine/tests/engine_integration.rs`

## 2026-03-06 - Surface Graph Generation Status in Status Bar

Docs:
- `docs/work_log.md`
- `docs/change_files.md`

Electron app:
- `app-electron/src/renderer/App.tsx`
- `app-electron/src/renderer/features/app/status-bar.tsx`

## 2026-03-06 - Center Graph View on Highlighted Disassembly Instruction

Docs:
- `docs/work_log.md`
- `docs/change_files.md`

Shared:
- `shared/schemas/protocol.schema.json`

Electron app:
- `app-electron/src/shared/protocol.gen.ts`
- `app-electron/src/shared/protocol.ts`
- `app-electron/src/renderer/features/graph/graph-panel.tsx`
- `app-electron/src/renderer/App.graph-view.test.tsx`
- `app-electron/src/renderer/App.function-browser.test.tsx`
- `app-electron/src/renderer/App.function-browser-window.test.tsx`
- `app-electron/src/renderer/App.disassembly-window.test.tsx`
- `app-electron/src/renderer/App.loading-modal.test.tsx`
- `app-electron/src/renderer/App.window-chrome.test.tsx`
- `app-electron/test/protocol-schema.test.js`

Engine:
- `engine/src/cfg.rs`
- `engine/src/protocol.rs`
- `engine/src/state.rs`
- `engine/tests/contract_schema_tests.rs`
- `engine/tests/engine_integration.rs`

## 2026-03-06 - Add Mnemonic Category Coloring to Graph View Blocks

Docs:
- `docs/work_log.md`
- `docs/change_files.md`

Shared:
- `shared/schemas/protocol.schema.json`

Electron app:
- `app-electron/package.json`
- `app-electron/package-lock.json`
- `app-electron/src/shared/protocol.gen.ts`
- `app-electron/src/shared/protocol.ts`
- `app-electron/src/renderer/features/graph/graph-panel.tsx`
- `app-electron/src/renderer/styles.css`
- `app-electron/src/renderer/App.graph-view.test.tsx`
- `app-electron/test/protocol-schema.test.js`

Engine:
- `engine/src/cfg.rs`
- `engine/src/protocol.rs`
- `engine/src/state.rs`
- `engine/tests/contract_schema_tests.rs`
- `engine/tests/engine_integration.rs`

## 2026-03-06 - Add Function Graph View Toggle with Engine CFG RPC

Docs:
- `docs/work_log.md`
- `docs/change_files.md`

Shared:
- `shared/schemas/protocol.schema.json`

Electron app:
- `app-electron/package.json`
- `app-electron/package-lock.json`
- `app-electron/src/main/main.ts`
- `app-electron/src/preload.ts`
- `app-electron/src/shared/protocol.gen.ts`
- `app-electron/src/shared/protocol.ts`
- `app-electron/src/renderer/App.tsx`
- `app-electron/src/renderer/styles.css`
- `app-electron/src/renderer/features/app/status-bar.tsx`
- `app-electron/src/renderer/features/graph/graph-panel.tsx`
- `app-electron/src/renderer/App.graph-view.test.tsx`
- `app-electron/src/renderer/App.function-browser.test.tsx`
- `app-electron/src/renderer/App.function-browser-window.test.tsx`
- `app-electron/src/renderer/App.disassembly-window.test.tsx`
- `app-electron/src/renderer/App.loading-modal.test.tsx`
- `app-electron/src/renderer/App.window-chrome.test.tsx`
- `app-electron/test/protocol-schema.test.js`

Engine:
- `engine/src/lib.rs`
- `engine/src/cfg.rs`
- `engine/src/protocol.rs`
- `engine/src/state.rs`
- `engine/tests/contract_schema_tests.rs`
- `engine/tests/engine_integration.rs`

## 2026-03-06 - Generate Default Function Names from VA

Docs:
- `docs/work_log.md`
- `docs/change_files.md`

Engine:
- `engine/src/disasm.rs`
- `engine/src/state.rs`
- `engine/tests/engine_integration.rs`

## 2026-03-06 - Migrate Engine/App Linear Address Contract from RVA to VA

Docs:
- `docs/work_log.md`
- `docs/change_files.md`

Shared:
- `shared/schemas/protocol.schema.json`

Electron app:
- `app-electron/src/main/main.ts`
- `app-electron/src/preload.ts`
- `app-electron/src/shared/protocol.ts`
- `app-electron/src/renderer/App.tsx`
- `app-electron/src/renderer/features/shared/number-utils.ts`
- `app-electron/src/renderer/features/browser/browser-panel.tsx`
- `app-electron/src/renderer/features/disassembly/disassembly-panel.tsx`
- `app-electron/src/renderer/App.disassembly-window.test.tsx`
- `app-electron/src/renderer/App.function-browser-window.test.tsx`
- `app-electron/src/renderer/App.function-browser.test.tsx`
- `app-electron/src/renderer/App.loading-modal.test.tsx`
- `app-electron/src/renderer/App.window-chrome.test.tsx`

Engine:
- `engine/src/disasm.rs`
- `engine/src/linear.rs`
- `engine/src/protocol.rs`
- `engine/src/state.rs`
- `engine/tests/engine_integration.rs`

## 2026-03-06 - Split Renderer App Monolith into Feature Modules

Docs:
- `docs/work_log.md`
- `docs/change_files.md`

Electron app:
- `app-electron/src/renderer/App.tsx`
- `app-electron/src/renderer/features/app/app-dialogs.tsx`
- `app-electron/src/renderer/features/app/status-bar.tsx`
- `app-electron/src/renderer/features/browser/browser-panel.tsx`
- `app-electron/src/renderer/features/browser/function-provenance.ts`
- `app-electron/src/renderer/features/disassembly/disassembly-panel.tsx`
- `app-electron/src/renderer/features/shared/deferred-edge-rebase.ts`
- `app-electron/src/renderer/features/shared/dom-utils.ts`
- `app-electron/src/renderer/features/shared/number-utils.ts`

## 2026-03-06 - Toggle Browser Search with Ctrl+F and Compact Search Label

Docs:
- `docs/work_log.md`
- `docs/change_files.md`

Electron app:
- `app-electron/src/renderer/App.tsx`
- `app-electron/src/renderer/App.function-browser.test.tsx`
- `app-electron/src/renderer/App.function-browser-window.test.tsx`

## 2026-03-05 - Add Responsive Browser Function Search with Async Search

Docs:
- `docs/work_log.md`
- `docs/change_files.md`

Electron app:
- `app-electron/src/renderer/App.tsx`
- `app-electron/src/renderer/styles.css`
- `app-electron/src/renderer/App.function-browser.test.tsx`
- `app-electron/src/renderer/App.function-browser-window.test.tsx`

## 2026-03-05 - Remove Inspector Panel and Simplify Main Layout

Docs:
- `docs/work_log.md`
- `docs/change_files.md`

Electron app:
- `app-electron/src/renderer/App.tsx`
- `app-electron/src/renderer/styles.css`

## 2026-03-05 - Refine Title Badge Chrome and Loading Modal Presentation

Docs:
- `docs/work_log.md`
- `docs/change_files.md`

Electron app:
- `app-electron/src/renderer/App.tsx`
- `app-electron/src/renderer/styles.css`
- `app-electron/src/renderer/App.loading-modal.test.tsx`
- `app-electron/src/renderer/components/ui/dialog.tsx`
- `app-electron/src/renderer/components/window-chrome.tsx`

## 2026-03-05 - Add Blocking File Loading Modal Overlay

Docs:
- `docs/work_log.md`
- `docs/change_files.md`

Electron app:
- `app-electron/src/renderer/App.tsx`
- `app-electron/src/renderer/styles.css`
- `app-electron/src/renderer/App.loading-modal.test.tsx`

## 2026-03-05 - Shorten Function Provenance Labels in Browser UI

Docs:
- `docs/work_log.md`
- `docs/change_files.md`

Electron app:
- `app-electron/src/renderer/App.tsx`
- `app-electron/src/renderer/App.function-provenance.test.ts`
- `app-electron/src/renderer/styles.css`

## 2026-03-05 - Add PDB-Based Function Discovery with Strict RSDS Matching

Docs:
- `docs/work_log.md`
- `docs/change_files.md`

Shared:
- `shared/schemas/protocol.schema.json`

Electron app:
- `app-electron/src/shared/protocol.ts`
- `app-electron/test/protocol-schema.test.js`

Engine:
- `engine/Cargo.toml`
- `engine/Cargo.lock`
- `engine/src/lib.rs`
- `engine/src/state.rs`
- `engine/src/pdb_symbols.rs`
- `engine/tests/fixtures/fixture_builder.pdb`
- `engine/tests/contract_schema_tests.rs`
- `engine/tests/engine_integration.rs`

## 2026-03-05 - Add File Menu Unload Command Flow

Docs:
- `docs/work_log.md`
- `docs/change_files.md`

Electron app:
- `app-electron/src/main/main.ts`
- `app-electron/src/preload.ts`
- `app-electron/src/shared/protocol.ts`
- `app-electron/src/renderer/App.tsx`
- `app-electron/src/renderer/App.function-browser.test.tsx`
- `app-electron/src/renderer/App.function-browser-window.test.tsx`
- `app-electron/src/renderer/App.disassembly-window.test.tsx`
- `app-electron/src/renderer/App.window-chrome.test.tsx`

## 2026-03-05 - Add Frameless Custom Window Chrome and Menubar Integration

Docs:
- `docs/work_log.md`
- `docs/change_files.md`

Electron app:
- `app-electron/src/main/main.ts`
- `app-electron/src/preload.ts`
- `app-electron/src/shared/protocol.ts`
- `app-electron/src/renderer/App.tsx`
- `app-electron/src/renderer/styles.css`
- `app-electron/src/renderer/components/window-chrome.tsx`
- `app-electron/src/renderer/App.disassembly-window.test.tsx`
- `app-electron/src/renderer/App.function-browser.test.tsx`
- `app-electron/src/renderer/App.function-browser-window.test.tsx`
- `app-electron/src/renderer/App.window-chrome.test.tsx`

## 2026-03-05 - Unify Deferred Rebase Logic for Virtualized Scroll Panels

Docs:
- `docs/work_log.md`
- `docs/change_files.md`

Electron app:
- `app-electron/src/renderer/App.tsx`

## 2026-03-05 - Add Deferred Edge Rebase for Function Browser Scrolling

Docs:
- `docs/work_log.md`
- `docs/change_files.md`

Electron app:
- `app-electron/src/renderer/App.tsx`
- `app-electron/src/renderer/App.function-browser-window.test.tsx`

## 2026-03-05 - Defer Disassembly Rebase Until Scroll Ends

Docs:
- `docs/work_log.md`
- `docs/change_files.md`

Electron app:
- `app-electron/src/renderer/App.tsx`

## 2026-03-05 - Stabilize Deep-Scroll Disassembly Rebase Behavior

Docs:
- `docs/work_log.md`
- `docs/change_files.md`

Electron app:
- `app-electron/src/renderer/App.tsx`

## 2026-03-05 - Fix Large-Module Disassembly Scroll Coverage

Docs:
- `docs/work_log.md`
- `docs/change_files.md`

Electron app:
- `app-electron/src/renderer/App.tsx`
- `app-electron/src/renderer/App.disassembly-window.test.tsx`

## 2026-03-05 - Add Persistent File Menu Open Recent Flow

Docs:
- `docs/work_log.md`
- `docs/change_files.md`

Electron app:
- `app-electron/src/main/main.ts`
- `app-electron/src/preload.ts`
- `app-electron/src/shared/protocol.ts`
- `app-electron/src/renderer/App.tsx`
- `app-electron/src/renderer/App.function-browser.test.tsx`

## 2026-03-05 - Split Engine Library into Domain Modules

Docs:
- `docs/work_log.md`
- `docs/change_files.md`

Engine:
- `engine/src/lib.rs`
- `engine/src/error.rs`
- `engine/src/rpc.rs`
- `engine/src/protocol.rs`
- `engine/src/state.rs`
- `engine/src/pe_utils.rs`
- `engine/src/disasm.rs`
- `engine/src/linear.rs`
- `engine/src/tests.rs`

## 2026-03-05 - Virtualize Function Browser List Rendering

Docs:
- `docs/work_log.md`
- `docs/change_files.md`

Electron app:
- `app-electron/src/renderer/App.tsx`
- `app-electron/src/renderer/styles.css`
- `app-electron/src/renderer/App.function-browser.test.tsx`

## 2026-03-05 - Align Renderer Theme Tokens with Shadcn New York v4 Zinc

Docs:
- `docs/work_log.md`
- `docs/change_files.md`

Electron app:
- `app-electron/tailwind.config.cjs`
- `app-electron/src/renderer/styles.css`

## 2026-03-05 - Mirror Shadcn Site Theme and Typography (Light + Dark)

Docs:
- `docs/visual_guidelines.md`
- `docs/work_log.md`
- `docs/change_files.md`

Electron app:
- `app-electron/package.json`
- `app-electron/package-lock.json`
- `app-electron/components.json`
- `app-electron/tailwind.config.cjs`
- `app-electron/vitest.config.ts`
- `app-electron/src/renderer/main.tsx`
- `app-electron/src/renderer/App.tsx`
- `app-electron/src/renderer/styles.css`
- `app-electron/src/renderer/components/theme-provider.tsx`
- `app-electron/src/renderer/components/mode-toggle.tsx`
- `app-electron/src/renderer/components/mode-toggle.test.tsx`
- `app-electron/src/renderer/components/ui/dropdown-menu.tsx`
- `app-electron/src/renderer/components/ui/button.tsx`
- `app-electron/src/renderer/components/ui/badge.tsx`
- `app-electron/src/renderer/components/ui/input.tsx`
- `app-electron/src/renderer/test/setup.ts`

## 2026-03-05 - Migrate Renderer UI Foundation to Shadcn Consistency Model

Docs:
- `docs/visual_guidelines.md`
- `docs/work_log.md`
- `docs/change_files.md`

Electron app:
- `app-electron/package.json`
- `app-electron/package-lock.json`
- `app-electron/components.json`
- `app-electron/postcss.config.cjs`
- `app-electron/tailwind.config.cjs`
- `app-electron/vite.config.ts`
- `app-electron/vitest.config.ts`
- `app-electron/tsconfig.renderer.json`
- `app-electron/src/renderer/App.tsx`
- `app-electron/src/renderer/styles.css`
- `app-electron/src/renderer/components/ui/badge.tsx`
- `app-electron/src/renderer/components/ui/button.tsx`
- `app-electron/src/renderer/components/ui/dialog.tsx`
- `app-electron/src/renderer/components/ui/input.tsx`
- `app-electron/src/renderer/components/ui/scroll-area.tsx`
- `app-electron/src/renderer/components/ui/separator.tsx`
- `app-electron/src/renderer/lib/utils.ts`
- `app-electron/src/renderer/lib/utils.test.ts`
- `app-electron/src/renderer/test/setup.ts`
- `app-electron/test/ui-consistency.test.js`

## 2026-03-05 - Add Function Discovery from PE Exception Directory

Docs:
- `docs/work_log.md`
- `docs/change_files.md`

Shared:
- `shared/schemas/protocol.schema.json`

Electron app:
- `app-electron/src/shared/protocol.ts`
- `app-electron/test/protocol-schema.test.js`

Engine:
- `engine/src/lib.rs`
- `engine/tests/contract_schema_tests.rs`
- `engine/tests/engine_integration.rs`

## 2026-03-05 - Linear Mapped-File View with Virtualized Paging

Docs:
- `docs/work_log.md`
- `docs/change_files.md`

Electron app:
- `app-electron/package.json`
- `app-electron/package-lock.json`
- `app-electron/src/main/main.ts`
- `app-electron/src/preload.ts`
- `app-electron/src/renderer/App.tsx`
- `app-electron/src/renderer/styles.css`
- `app-electron/src/shared/protocol.ts`

Engine:
- `engine/src/lib.rs`

## 2026-03-05 - Branch/Call Follow Actions as Comment Hyperlinks

Docs:
- `docs/work_log.md`
- `docs/change_files.md`

Electron app:
- `app-electron/src/renderer/App.tsx`
- `app-electron/src/renderer/styles.css`

## 2026-03-05 - Open EXE Button Vertical Alignment Fix

Docs:
- `docs/work_log.md`
- `docs/change_files.md`

Electron app:
- `app-electron/src/renderer/styles.css`

## 2026-03-05 - Add Comment Column with Remaining-Width Fill

Docs:
- `docs/work_log.md`
- `docs/change_files.md`

Electron app:
- `app-electron/src/renderer/App.tsx`
- `app-electron/src/renderer/styles.css`

## 2026-03-05 - Disassembly Column Resize Behavior Correction

Docs:
- `docs/work_log.md`
- `docs/change_files.md`

Electron app:
- `app-electron/src/renderer/styles.css`

## 2026-03-05 - Disassembly Column Width Resizing

Docs:
- `docs/work_log.md`
- `docs/change_files.md`

Electron app:
- `app-electron/src/renderer/App.tsx`
- `app-electron/src/renderer/styles.css`

## 2026-03-05 - Remove Operand Dash Fallback in Renderer

Docs:
- `docs/work_log.md`
- `docs/change_files.md`

Electron app:
- `app-electron/src/renderer/App.tsx`

## 2026-03-05 - Disassembly Mono Typography and Row Separator Removal

Docs:
- `docs/work_log.md`
- `docs/change_files.md`

Electron app:
- `app-electron/src/renderer/styles.css`

## 2026-03-05 - Splitter Gap Tightening

Docs:
- `docs/work_log.md`
- `docs/change_files.md`

Electron app:
- `app-electron/src/renderer/styles.css`

## 2026-03-05 - Invisible Splitter UI Tweak

Docs:
- `docs/work_log.md`
- `docs/change_files.md`

Electron app:
- `app-electron/src/renderer/styles.css`

## 2026-03-05 - Independent Panel Scroll Fix

Docs:
- `docs/work_log.md`
- `docs/change_files.md`

Electron app:
- `app-electron/src/renderer/styles.css`

## 2026-03-05 - Panel Resizing and Independent Scroll Behavior

Docs:
- `docs/visual_guidelines.md`
- `docs/work_log.md`
- `docs/change_files.md`

Electron app:
- `app-electron/src/renderer/App.tsx`
- `app-electron/src/renderer/styles.css`

## 2026-03-05 - Ableton Styling Correction Pass

Docs:
- `docs/visual_guidelines.md`
- `docs/work_log.md`
- `docs/change_files.md`

Electron app:
- `app-electron/src/renderer/styles.css`

## 2026-03-05 - Ableton-Inspired Visual System and Layout Refresh

Docs:
- `docs/visual_guidelines.md`
- `docs/work_log.md`
- `docs/change_files.md`

Electron app:
- `app-electron/src/renderer/App.tsx`
- `app-electron/src/renderer/styles.css`

## 2026-03-04 to 2026-03-05 - MVP1 Vertical Slice Foundation

Root:
- `.gitignore`
- `justfile`
- `AGENTS.md`

Docs:
- `docs/electron_disassembler_project_scope.md`
- `docs/work_log.md`
- `docs/change_files.md`

Shared:
- `shared/README.md`
- `shared/schemas/protocol.schema.json`

Electron app:
- `app-electron/package.json`
- `app-electron/package-lock.json`
- `app-electron/biome.json`
- `app-electron/vite.config.ts`
- `app-electron/index.html`
- `app-electron/tsconfig.main.json`
- `app-electron/tsconfig.renderer.json`
- `app-electron/scripts/generate-protocol-types.mjs`
- `app-electron/src/main/main.ts`
- `app-electron/src/main/engineClient.ts`
- `app-electron/src/preload.ts`
- `app-electron/src/shared/protocol.gen.ts`
- `app-electron/src/shared/protocol.ts`
- `app-electron/src/renderer/main.tsx`
- `app-electron/src/renderer/App.tsx`
- `app-electron/src/renderer/electron-api.d.ts`
- `app-electron/src/renderer/styles.css`
- `app-electron/test/protocol-schema.test.js`

Engine:
- `engine/Cargo.toml`
- `engine/Cargo.lock`
- `engine/src/main.rs`
- `engine/src/lib.rs`
- `engine/tests/contract_schema_tests.rs`
- `engine/tests/engine_integration.rs`
- `engine/tests/fixtures/minimal_x64.exe`
