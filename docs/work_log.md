# Work Log

## 2026-03-13 - Add Experimental Slint Linear Disassembly App

Summary:
- Added a parallel `app-slint` native desktop crate that reuses the existing in-process Rust `EngineState` instead of the Tauri host, keeping the current `app/` workflow unchanged while introducing an experimental Slint-based UI path.
- Implemented a first-pass native workspace with file open, background analysis progress, a function list, go-to-address navigation, row selection, and a virtualized linear disassembly pane backed by the existing paged linear-view engine APIs.
- Built the Slint disassembly list around a custom row model plus a UI-thread message pump so background engine work only sends plain data back to the UI thread, avoiding cross-thread Slint model access while still prefetching paged linear rows asynchronously.
- Extended the root `justfile` with `slint-build`, `slint-dev`, `slint-fmt`, `slint-check`, and `slint-test`, and folded the Slint crate into the existing root `build`, `fmt`, `check`, and `test` recipes.

Validation commands executed:
- `cargo test --manifest-path app-slint/Cargo.toml`
- `just slint-check`
- `just slint-test`
- `just check`
- `just test`

Changed files index:
- See `docs/change_files.md` for the detailed file list for this work item.

## 2026-03-12 - Add Linear Basic-Block Label Rows

Summary:
- Extended the engine linear view to emit synthetic `label` rows for materialized non-entry basic-block starts, deriving label-start RVAs from cached CFG blocks and inserting zero-length label segments with an empty synthetic `comment` spacer row above each visible label without changing VA lookup semantics.
- Kept label rows in the same row index space as instructions by splitting contiguous instruction segments at interior block starts, while preserving function-header `comment` rows and keeping `find_linear_row_by_va` landing on the first instruction row at each labeled address.
- Updated the shared renderer contract, disassembly panel, and shell behavior so label rows render as distinct address-bearing annotation rows with only the `lbl_<va>:` text colored, instruction text indented more deeply beneath labels like a traditional assembler listing, and Graph View/xref actions driven by the shared address.

Validation commands executed:
- `just engine-fmt`
- `just engine-test`
- `just app-fmt`
- `cd app && npm run test:renderer -- disassembly-panel app.graph-view app.xrefs-modal`
- `just app-check`

Changed files index:
- See `docs/change_files.md` for the detailed file list for this work item.


## 2026-03-12 - Add Linear Function Comment Rows

Summary:
- Extended the engine linear row model with synthetic `comment` rows and zero-length function-header segments so every materialized function contributes a blank spacer row plus a named header row without breaking VA-based row lookup.
- Split contiguous instruction segments at later materialized function starts, kept `find_linear_row_by_va` landing on the first instruction row, and added engine unit/integration coverage for shared-address headers and adjacent functions.
- Updated the shared renderer contract and disassembly panel to render dedicated comment rows separately from the trailing comment column while still filling the section/address cells, prefixing the visible header text with `;`, and letting Graph View and xref flows operate on selected comment rows by their shared function address.

Validation commands executed:
- `just engine-fmt`
- `just engine-test`
- `cd app && npm run test:renderer -- disassembly-panel app.graph-view app.xrefs-modal`
- `just app-fmt`
- `just app-check`

Changed files index:
- See `docs/change_files.md` for the detailed file list for this work item.

## 2026-03-12 - Reduce Initial Function Discovery Churn

Summary:
- Switched discovery progress updates to report counts during the seed-gathering phase and only materialize the full discovered-function snapshot once analysis moves past discovery, cutting repeated vector cloning from the initial-load path.
- Reused `SectionLookup` for PDB-backed seed filtering and skipped demangling/name normalization work for symbol RVAs that already have an equal-or-stronger recorded priority.
- Fixed the engine benchmark harness to pass the now-required `pdb_path` field so cold-load comparisons keep working after the manual-PDB API expansion.

Validation commands executed:
- `just engine-bench-save function-discovery-baseline-2026-03-12 all`
- `just engine-fmt`
- `just engine-test`
- `just engine-bench-compare function-discovery-baseline-2026-03-12 all`

Observed benchmark deltas:
- `engine/cold/module_open_and_analyze/minimal_with_pdb`: no statistically significant change vs `function-discovery-baseline-2026-03-12` (`[18.022 ms, 18.131 ms, 18.272 ms]` -> `[18.000 ms, 18.093 ms, 18.186 ms]`)
- `engine/cold/module_open_and_analyze/minimal_without_pdb`: no statistically significant change vs `function-discovery-baseline-2026-03-12` (`[18.155 ms, 18.260 ms, 18.366 ms]` -> `[18.038 ms, 18.178 ms, 18.300 ms]`)
- `engine/cold/module_open_and_analyze/overlay_4mb_without_pdb`: improved vs `function-discovery-baseline-2026-03-12` (`[19.419 ms, 19.764 ms, 20.144 ms]` -> `[18.854 ms, 18.996 ms, 19.138 ms]`)

Changed files index:
- See `docs/change_files.md` for the detailed file list for this work item.

## 2026-03-09 - Preserve Graph View Across Mouse History Navigation

Summary:
- Replaced the renderer selection history entries with `{ va, preferredView }` records so Back and Forward can replay both the selected address and whether that address should reopen in Disassembly or Graph View.
- Added a graph-specific history replay path that synchronizes the selected VA, reloads the target function graph, and keeps mouse back/forward navigation inside Graph View when the recorded history entry was reached there.
- Kept history VA-centric by rewriting the current entry's preferred view when users toggle Graph View on the same address, so same-VA view switches do not add duplicate history steps.
- Added renderer regressions for graph-to-graph mouse back/forward replay and for mixed linear/graph history where Forward should restore Graph View after returning from Disassembly.

Validation commands executed:
- `cd app && npm run test:renderer -- app.graph-view`
- `just app-check`
- `just app-test`

Changed files index:
- See `docs/change_files.md` for the detailed file list for this work item.

## 2026-03-09 - Fix Graph Operand Overlay Viewport Alignment

Summary:
- Reworked the graph operand link overlay to position links in graph scene coordinates and apply a single shared viewport transform, instead of individually projecting every link into screen space.
- Eliminated the graph-view failure mode where operand links could appear stuck to the viewport during pan, zoom, or reset interactions because the overlay no longer drifts independently from the canvas transform.
- Added renderer regression coverage to verify the graph operand link layer updates when the viewport transform changes.

Validation commands executed:
- `just app-fmt`
- `cd app && npm run test:renderer -- graph-panel app.graph-view`
- `just app-check`

Changed files index:
- See `docs/change_files.md` for the detailed file list for this work item.

## 2026-03-09 - Add Clickable Graph Operand Navigation

Summary:
- Added hyperlink-style operand overlays for direct call and branch targets inside the custom graph view so target-bearing instructions read and behave like the linked operands in linear disassembly.
- Routed graph operand clicks through a graph-local navigation path that records the source VA in selection history, synchronizes the selected VA/linear row, and reloads the graph by target VA without leaving Graph View.
- Made same-function branch links recenter the graph on the target basic block via the returned `focusBlockId`, while cross-function call links switch the graph to the callee function.
- Added renderer regression coverage for graph operand link rendering, same-function branch focus behavior, cross-function call switching, and graph-specific operand history handling.

Validation commands executed:
- `just app-fmt`
- `cd app && npm run test:renderer -- graph-panel app.graph-view operand-navigation`
- `just app-check`

Changed files index:
- See `docs/change_files.md` for the detailed file list for this work item.

## 2026-03-09 - Simplify Graph Cache Boundaries and Xref Name Lookup

Summary:
- Kept lazy instruction rendering unchanged while shrinking the analysis-time graph cache back toward compact semantic data instead of storing extra derived graph metadata.
- Replaced the per-byte graph block lookup map with raw block-start RVAs, kept only stable block and edge ids cached for the hot graph path, and moved entry/exit, back-edge, and end-address derivation back to the request path.
- Reworked xref materialization to resolve source function names from the existing function-name map instead of walking back through the cached graph payloads.
- Captured a named all-fixture baseline before the change and compared the simplified graph/xref boundary against it, with cold module-open and warm graph materialization both improving while xref lookup stayed statistically flat.

Validation commands executed:
- `just engine-bench-save simple-lazy-boundary-baseline-2026-03-09 all`
- `cargo fmt --manifest-path engine/Cargo.toml`
- `cargo test --manifest-path engine/Cargo.toml`
- `just engine-bench-compare simple-lazy-boundary-baseline-2026-03-09 all`
- `cargo fmt --manifest-path engine/Cargo.toml -- --check`

Observed benchmark deltas:
- `engine/cold/module_open_and_analyze/minimal_with_pdb`: improved to `[24.564 ms, 24.673 ms, 24.785 ms]` vs `simple-lazy-boundary-baseline-2026-03-09`
- `engine/warm/function_graph_by_va/minimal_with_pdb`: improved to `[54.395 us, 54.474 us, 54.562 us]` vs `simple-lazy-boundary-baseline-2026-03-09`
- `engine/warm/function_graph_by_va/minimal_without_pdb`: improved to `[55.556 us, 55.664 us, 55.789 us]` vs `simple-lazy-boundary-baseline-2026-03-09`
- `engine/warm/xrefs_to_va/minimal_with_pdb`: no statistically significant change vs `simple-lazy-boundary-baseline-2026-03-09`

Changed files index:
- See `docs/change_files.md` for the detailed file list for this work item.

## 2026-03-09 - Replace Cytoscape Graph View With Custom Canvas Renderer

Summary:
- Replaced the Cytoscape-based graph panel with a custom canvas CFG viewer that owns layered layout, orthogonal edge routing, viewport controls, hit testing, and block/instruction rendering inside the renderer.
- Added graph-local instruction selection and keyboard/pointer interactions so Graph View can sync the selected VA without leaving the graph, while `Enter` and double-click still reuse the existing disassembly navigation path.
- Expanded the graph payload contract with instruction addresses and targets, block bounds/entry-exit flags, and edge ids/source metadata so the renderer no longer has to infer navigation behavior from formatted strings.
- Removed the obsolete Cytoscape runtime dependencies and added renderer and engine regression coverage for the richer graph contract and custom graph interactions.

Validation commands executed:
- `cd app && npm run test:renderer -- graph-panel app.graph-view`
- `cd app && npm run check`
- `cargo fmt --manifest-path engine/Cargo.toml -- --check`
- `cargo test --manifest-path engine/Cargo.toml`

Changed files index:
- See `docs/change_files.md` for the detailed file list for this work item.

## 2026-03-08 - Add Clickable Linear Operand Navigation

Summary:
- Added hyperlink-style operand rendering for symbolized direct call and branch targets in the linear disassembly view.
- Reused the existing VA navigation flow so clicking a named operand follows the target without selecting the current row first, while recording the source instruction VA in selection history for Back navigation.
- Added renderer coverage for linked operand rendering, click-to-follow behavior, source-aware history behavior, and the removal of generated branch/call comment links from the linear view.

Validation commands executed:
- `just fmt`
- `npm run test:renderer -- disassembly-panel` (in `app`)
- `npm run test:renderer -- operand-navigation` (in `app`)
- `npm run check` (in `app`)

Changed files index:
- See `docs/change_files.md` for the detailed file list for this work item.

## 2026-03-08 - Shorten Synthetic Branch Labels

Summary:
- Renamed synthetic direct-branch operand labels from `label_<va>` to `lbl_<va>`.
- Updated engine and renderer regression coverage to match the shorter label prefix.

Validation commands executed:
- `cargo test --manifest-path engine/Cargo.toml`
- `npm run test -- --run src/renderer/features/disassembly/disassembly-panel.test.tsx src/renderer/features/graph/graph-panel.test.ts` (in `app`)

Changed files index:
- See `docs/change_files.md` for the detailed file list for this work item.

## 2026-03-08 - Symbolize Direct Call and Branch Operands

Summary:
- Rewrote lazy-rendered direct `call` operands to show known function names from the analyzed function cache instead of raw target VAs.
- Rewrote direct `jmp` and conditional-branch operands to use synthetic `lbl_<va>` names while leaving indirect control-flow operands unchanged.
- Removed linear-view branch and call comment annotations so disassembly rows rely on operand text alone, while preserving target metadata for later clickable-operand work.
- Added engine and renderer regression coverage for operand symbolization across linear rows, linear disassembly, and graph output.

Validation commands executed:
- `just fmt`
- `just check`
- `just test`

Changed files index:
- See `docs/change_files.md` for the detailed file list for this work item.

## 2026-03-08 - Reorganize Renderer Shell, Platform, and Shared Contracts

Summary:
- Moved renderer shell concerns into dedicated `shell`, `platform`, and `test-utils` namespaces so window chrome, dialogs, status UI, Tauri API wiring, and app-shell tests no longer sit in generic root/component folders.
- Split the shared TypeScript contract surface into `engine-contracts`, `desktop-contracts`, and a shared index, then updated renderer imports to consume the narrower shared modules instead of a single `protocol.ts`.
- Reduced the root renderer entry to a thin `App` re-export and extracted shell-owned hooks for panel layout/resizing and window-chrome/menu wiring while keeping existing workspace behavior and tests intact.

Validation commands executed:
- `npm run check` (in `app`)
- `just test`

Changed files index:
- See `docs/change_files.md` for the detailed file list for this work item.

## 2026-03-08 - Restore Graph Instruction Listing Layout

Summary:
- Fixed graph-node instruction rows so mnemonics and operands render as separate listing columns instead of collapsing together.
- Added graph-node CSS for mnemonic category coloring, operand spacing, and stronger header/listing structure inside Cytoscape HTML labels.
- Added a renderer regression test that exercises the generated graph-node HTML directly.

Validation commands executed:
- `npm run test:renderer -- graph-panel`
- `npm run test:renderer -- App.graph-view`
- `npm run check`

Changed files index:
- See `docs/change_files.md` for the detailed file list for this work item.

## 2026-03-08 - Optimize Engine Analysis with Lazy Instruction Rendering

Summary:
- Removed eager instruction text/byte rendering from the analysis cache so initial analysis keeps compact instruction metadata instead of fully formatted presentation strings.
- Centralized lazy instruction rendering in a shared helper used by linear rows, linear disassembly, and function-graph views to keep warm-path reconstruction consistent.
- Restored broader mnemonic-family categorization coverage without reintroducing eager full-instruction formatting during analysis.
- Added regression coverage to ensure lazily rendered bytes and mnemonics stay populated across linear and graph APIs.

Validation commands executed:
- `cargo fmt --manifest-path engine/Cargo.toml`
- `cargo check --manifest-path engine/Cargo.toml`
- `cargo test --manifest-path engine/Cargo.toml`
- `just test`
- `cargo bench --manifest-path engine/Cargo.toml --bench analysis_bench -- engine/cold/module_open_and_analyze/minimal_with_pdb --baseline hybrid-full-2026-03-07`
- `cargo bench --manifest-path engine/Cargo.toml --bench analysis_bench -- engine/warm/linear_rows/minimal_with_pdb --baseline hybrid-full-2026-03-07`
- `cargo bench --manifest-path engine/Cargo.toml --bench analysis_bench -- engine/warm/function_graph_by_va/minimal_with_pdb --baseline hybrid-full-2026-03-07`

Observed benchmark deltas:
- `engine/cold/module_open_and_analyze/minimal_with_pdb`: improved to `[20.874 ms, 23.165 ms, 26.187 ms]` vs `hybrid-full-2026-03-07`
- `engine/warm/linear_rows/minimal_with_pdb`: regressed to `[70.039 us, 71.349 us, 72.709 us]` vs `hybrid-full-2026-03-07`
- `engine/warm/function_graph_by_va/minimal_with_pdb`: regressed to `[33.520 us, 33.558 us, 33.600 us]` vs `hybrid-full-2026-03-07`

Changed files index:
- See `docs/change_files.md` for the detailed file list for this work item.

## 2026-03-08 - Add Drag-and-Drop Workspace Import

Summary:
- Added `onDragEnter`, `onDragLeave`, and `onDragDrop` wrappers to the `desktopApi` so the UI can listen to Tauri's native full-window drag events.
- Updated `App.tsx` to render a centered, full-screen overlay drop indicator when a drag starts, suggesting the user should drop an executable.
- Wired the `onDragDrop` handler to pass the first dropped file path straight into `openModuleFromPath`.

Validation commands executed:
- `just check`
- `just test`
- `cargo fmt --manifest-path app/src-tauri/Cargo.toml`
- Checked `npm run check` in `app` (type safety of the new protocol entries)

Changed files index:
- See `docs/change_files.md` for the detailed file list for this work item.

## 2026-03-08 - Add Idle Workspace Prompt

Summary:
- Added a centered idle-state message in the main workspace so the shell gives a clear starting instruction before any file is loaded.
- Kept the spinner-only loading flow and hidden analysis panes unchanged while tightening the prompt copy to a short onboarding line.

Validation commands executed:
- `npm run test:renderer -- App.window-chrome.test.tsx` (in `app`)
- `npm run test:renderer -- App.loading-modal.test.tsx App.window-chrome.test.tsx App.disassembly-window.test.tsx` (in `app`)
- `npm run check` (in `app`)

Changed files index:
- See `docs/change_files.md` for the detailed file list for this work item.

## 2026-03-08 - Replace Loading Modal With Workspace Spinner

Summary:
- Removed the blocking file-loading modal and switched the renderer to a spinner-only loading experience in the main workspace.
- Kept the analysis panes hidden until readiness and showed the centered workspace spinner for the full loading/analysis period until the renderer reaches the `ready` state.
- Updated the loading renderer test to cover the spinner lifecycle instead of modal content.

Validation commands executed:
- `npm run test:renderer -- App.loading-modal.test.tsx App.window-chrome.test.tsx App.disassembly-window.test.tsx` (in `app`)
- `npm run check` (in `app`)

Changed files index:
- See `docs/change_files.md` for the detailed file list for this work item.

## 2026-03-08 - Hide Empty Analysis Views Until Analysis Is Ready

Summary:
- Hid the memory overview, browser panel, splitter, and center analysis view until analysis reaches the `ready` state so the shell stays clean both before loading and while analysis is still running.
- Simplified the memory overview empty state back to a plain empty bar and updated renderer tests to assert that the analysis panes stay hidden before readiness and only appear once analysis completes.

Validation commands executed:
- `npm run test:renderer -- App.window-chrome.test.tsx App.disassembly-window.test.tsx App.loading-modal.test.tsx` (in `app`)
- `npm run check` (in `app`)

Changed files index:
- See `docs/change_files.md` for the detailed file list for this work item.

## 2026-03-08 - Simplify Window Chrome Style Reuse

Summary:
- Refactored `window-chrome.tsx` to centralize repeated title-bar menu and control button styles into shared local constants and a small `WindowControlButton` wrapper.
- Kept the Tauri drag-region behavior and shadcn dropdown usage unchanged while reducing duplicated utility strings in the renderer-owned window chrome.

Validation commands executed:
- `npm run test:renderer -- App.window-chrome.test.tsx` (in `app`)
- `npm run check` (in `app`)

Changed files index:
- See `docs/change_files.md` for the detailed file list for this work item.

## 2026-03-08 - Finish Disassembly and Custom Renderer Style Cleanup

Summary:
- Removed the remaining disassembly layout stylesheet by moving column headers, rows, mnemonic colors, row states, and comment-link styling into `disassembly-panel.tsx` with Tailwind classes and typed helper maps.
- Inlined the memory overview shell, SVG slice coloring, and graph panel container styling so the remaining custom renderer stylesheet is reserved for string-rendered graph node HTML only.
- Added `docs/renderer_styling.md` to document the new renderer styling rules: shadcn/Tailwind by default, global CSS only for tokens, base rules, tiny utilities, and unavoidable custom renderer output.

Validation commands executed:
- `npm run test:renderer -- App.disassembly-window.test.tsx App.graph-view.test.tsx App.function-browser.test.tsx App.function-browser-window.test.tsx` (in `app`)
- `npm run check` (in `app`)

Changed files index:
- See `docs/change_files.md` for the detailed file list for this work item.

## 2026-03-08 - Split Renderer Styles Into Scoped Modules

Summary:
- Split the renderer stylesheet entrypoint into focused CSS modules for theme tokens, base rules, Tailwind-safe utilities, disassembly-specific rules, and custom renderer styling so `app/src/renderer/styles.css` no longer acts as a monolith.
- Moved app chrome, panel shells, dialogs, status bar, mode toggle, and browser list presentation into Tailwind/shadcn-friendly component classes, backed by a shared `AppPanel` wrapper for consistent panel structure.
- Replaced touched test selectors that depended on styling classes with stable `data-testid` hooks for browser virtualization, loading state, disassembly canvas bounds, and memory overview assertions.

Validation commands executed:
- `npm run test:renderer -- App.loading-modal.test.tsx App.function-browser.test.tsx App.function-browser-window.test.tsx App.disassembly-window.test.tsx App.window-chrome.test.tsx App.xrefs-modal.test.tsx App.graph-view.test.tsx` (in `app`)
- `npm run check` (in `app`)

Changed files index:
- See `docs/change_files.md` for the detailed file list for this work item.

## 2026-03-08 - Add Disassembly Xref Modal Shortcut and Navigation

Summary:
- Added renderer and host plumbing for `xref.getXrefsToVa`, then wired an `X` disassembly hotkey that opens an xref modal for the highlighted VA.
- Reused the existing VA navigation flow so clicking an xref in the modal jumps the disassembly view to the xref source and preserves selection history behavior.
- Added the no-xrefs status-bar path, modal styling, and renderer regression coverage for opening the modal, jumping from it, and reporting empty xref results.

Validation commands executed:
- `cargo test --manifest-path app/src-tauri/Cargo.toml`
- `npx vitest run src/renderer/App.xrefs-modal.test.tsx src/renderer/App.graph-view.test.tsx` (in `app`)
- `npm run check` (in `app`)

Changed files index:
- See `docs/change_files.md` for the detailed file list for this work item.

## 2026-03-08 - Add Engine Xref Indexing and VA Query Support

Summary:
- Added engine-side xref extraction for direct calls, direct jumps, conditional branch targets, and RIP-relative data references, then indexed canonical inbound xrefs after function ownership is finalized.
- Added a new `get_xrefs_to_va` engine API so later UI work can query inbound xrefs for any mapped VA without recomputing analysis-time relationships.
- Extended engine coverage for xref indexing rules, added an integration test for call-derived function xrefs, and added a warm Criterion benchmark for xref lookup alongside a cold analysis benchmark check.

Validation commands executed:
- `cargo fmt --manifest-path engine/Cargo.toml`
- `cargo test --manifest-path engine/Cargo.toml`
- `cargo bench --manifest-path engine/Cargo.toml --bench analysis_bench -- engine/warm/xrefs_to_va`
- `cargo bench --manifest-path engine/Cargo.toml --bench analysis_bench -- engine/cold/module_open_and_analyze/minimal_with_pdb --baseline hybrid-full-2026-03-07`

Changed files index:
- See `docs/change_files.md` for the detailed file list for this work item.

## 2026-03-08 - Remove Native Menu Updates From Custom Chrome App

Summary:
- Removed native Tauri menu registration and runtime `app.set_menu(...)` calls from the Windows host after crash dumps showed the file-load failure was happening in `muda` menu painting and subclass callbacks.
- Kept the custom title-bar menu model and recent-file command mapping so the renderer-owned chrome menu continues to provide `Open`, `Open Recent`, `Unload`, and `Quit` without relying on native menu state.

Validation commands executed:
- `cargo fmt --manifest-path "app/src-tauri/Cargo.toml"`
- `cargo test --manifest-path "app/src-tauri/Cargo.toml"`
- `just app-test`

Changed files index:
- See `docs/change_files.md` for the detailed file list for this work item.

## 2026-03-08 - Remove Embedded Engine Status Badge and Ping

Summary:
- Removed the renderer status-bar badge that reported the embedded engine as `online`, leaving the status bar focused on live work indicators like search, analysis, and graph building.
- Deleted the unused ping command and typed ping protocol from the Tauri app, renderer desktop API, and shared contracts now that the engine runs in-process.
- Removed the engine-side ping API and regression test so the embedded backend surface only exposes operational module and analysis flows.

Validation commands executed:
- `cargo check --manifest-path "app/src-tauri/Cargo.toml"`
- `cargo test --manifest-path "engine/Cargo.toml"`
- `npm run test:renderer` (in `app`)
- `just test` (fails on pre-existing UI consistency violation in `app/src/renderer/features/disassembly/memory-overview-bar.tsx`)
- `just check` (fails on pre-existing Biome formatting issues in renderer files)

Changed files index:
- See `docs/change_files.md` for the detailed file list for this work item.

## 2026-03-08 - Refine Windows App Icon Assets

Summary:
- Replaced the app icon artwork with `C:\Users\curse\Downloads\vidapro.png`, then pre-pixelated the Windows icon master so downscaled variants keep a chunkier retro look.
- Simplified the repo to a Windows-only icon setup, added a reproducible ICO generator, and rebuilt `icon.ico` with embedded `16, 20, 24, 32, 40, 48, 64, 128, 256` variants using BMP/DIB payloads for small sizes and PNG for `256x256`.
- Updated the Tauri build script to rerun when the Windows icon assets change, experimented with icon ordering for taskbar selection, and kept the final ICO ordered largest-to-smallest before rebuilding the Windows release bundles.

Validation commands executed:
- `just app-icon-windows && python -c "from pathlib import Path; import struct; path=Path(r'D:\source\electron-disassembler\app\src-tauri\icons\icon.ico'); data=path.read_bytes(); count=struct.unpack_from('<H', data, 4)[0]; sizes=[]; offset=6\nfor _ in range(count):\n    width,height,colors,reserved,planes,bits,size,image_offset = struct.unpack_from('<BBBBHHII', data, offset)\n    sizes.append((256 if width==0 else width))\n    offset += 16\nprint(sizes)"`
- `just build-release`

Changed files index:
- See `docs/change_files.md` for the detailed file list for this work item.

## 2026-03-08 - Simplify Memory Overview Into Fixed Slices

Summary:
- Replaced the exact memory-overview region payload with a cached fixed-size slice summary, classifying each slice by its dominant unmapped, permission, or explored state so the memory bar no longer needs byte-perfect backing data.
- Simplified the renderer memory bar to draw directly from slice kinds with approximate tooltips, while keeping the existing click-to-navigate and viewport marker behavior.
- Extended engine and renderer coverage for the sliced overview shape, then benchmarked both the warm memory-overview API and the surrounding cold module-open path before and after the change.

Validation commands executed:
- `cargo bench --manifest-path engine/Cargo.toml --bench analysis_bench -- engine/warm/module_memory_overview --save-baseline memory-overview-slices-baseline-2026-03-08`
- `cargo bench --manifest-path engine/Cargo.toml --bench analysis_bench -- engine/cold/module_open_and_analyze/minimal_with_pdb --save-baseline memory-overview-slices-baseline-2026-03-08`
- `cargo fmt --manifest-path engine/Cargo.toml`
- `npx biome check --write src/shared/protocol.ts src/renderer/test/mock-desktop-api.ts src/renderer/features/disassembly/memory-overview-bar.tsx src/renderer/App.disassembly-window.test.tsx src/renderer/styles.css` (in `app`)
- `cargo test --manifest-path engine/Cargo.toml`
- `npx vitest run src/renderer/App.disassembly-window.test.tsx` (in `app`)
- `cargo bench --manifest-path engine/Cargo.toml --bench analysis_bench -- engine/warm/module_memory_overview --baseline memory-overview-slices-baseline-2026-03-08`
- `cargo bench --manifest-path engine/Cargo.toml --bench analysis_bench -- engine/cold/module_open_and_analyze/minimal_with_pdb --baseline memory-overview-slices-baseline-2026-03-08`

Changed files index:
- See `docs/change_files.md` for the detailed file list for this work item.

## 2026-03-08 - Prioritize Ready Disassembly Paint and Cache Memory Overview

Summary:
- Deferred the ready-state function-list and memory-bar requests until after the disassembly view has a chance to paint, so the first visible linear rows are no longer queued behind nonessential ready-side API calls.
- Cached both the base and ready memory overview snapshots in the engine and rebuilt discovered coverage from the sorted instruction-owner map, removing the expensive post-ready memory-bar recomputation.
- Added renderer and engine regression coverage for the deferred ready path and the optimized memory-overview range construction.

Validation commands executed:
- `cargo bench --manifest-path engine/Cargo.toml --bench analysis_bench -- engine/warm/module_memory_overview --save-baseline memory-overview-baseline-2026-03-08-v2`
- `cargo fmt --manifest-path engine/Cargo.toml`
- `npx biome check --write src/renderer/App.tsx` (in `app`)
- `cargo test --manifest-path engine/Cargo.toml`
- `npx vitest run src/renderer/App.disassembly-window.test.tsx src/renderer/App.function-browser.test.tsx src/renderer/App.function-browser-window.test.tsx` (in `app`)
- `cargo bench --manifest-path engine/Cargo.toml --bench analysis_bench -- engine/warm/module_memory_overview --baseline memory-overview-baseline-2026-03-08-v2`

Changed files index:
- See `docs/change_files.md` for the detailed file list for this work item.

## 2026-03-08 - Defer Browser List and Memory Bar Until Analysis Ready

Summary:
- Simplified the renderer loading flow so the Browser function list and memory overview bar stay empty while analysis is still queued or running.
- Changed the ready transition to initialize disassembly first, then load the function list and final memory overview asynchronously so large modules paint the main view sooner.
- Updated renderer coverage to verify the delayed ready-state loading behavior and preserve large-data virtualization expectations.

Validation commands executed:
- `npx biome check --write src/renderer/App.tsx src/renderer/App.disassembly-window.test.tsx src/renderer/features/browser/browser-panel.tsx` (in `app`)
- `npx vitest run src/renderer/App.disassembly-window.test.tsx src/renderer/App.function-browser.test.tsx src/renderer/App.function-browser-window.test.tsx` (in `app`)

Changed files index:
- See `docs/change_files.md` for the detailed file list for this work item.

## 2026-03-07 - Add Memory Bar Navigation and Placeholder Refinements

Summary:
- Refined the shell memory bar so it stays visible before a module is loaded, using a denser diagonal placeholder pattern instead of hiding the strip.
- Increased the bar height, removed extra framing chrome, and made clicks on the loaded memory bar navigate the disassembly viewport to the corresponding address.
- Extended renderer coverage to verify the empty-state overlay and click-to-address navigation behavior.

Validation commands executed:
- `just check`
- `npx vitest run src/renderer/App.disassembly-window.test.tsx`

Changed files index:
- See `docs/change_files.md` for the detailed file list for this work item.

## 2026-03-07 - Add Shell Memory Layout Overview Bar

Summary:
- Added a new engine memory-overview API that summarizes the loaded image span into compact mapped, unmapped, permission, and discovered-instruction regions so the renderer can paint a full-width overview without walking all linear rows.
- Added a shell-level memory layout bar above the main panels that scales to the window width, colors regions by access state, and draws a live viewport marker for the current disassembly view.
- Extended integration and renderer coverage so the new overview payload, non-scrolling bar rendering, and viewport marker behavior are exercised end to end.

Validation commands executed:
- `just fmt`
- `just check`
- `just test`

Changed files index:
- See `docs/change_files.md` for the detailed file list for this work item.

## 2026-03-07 - Discover Functions from Direct Call Targets

Summary:
- Extended engine function discovery to analyze seeded functions in deterministic waves and register new `call` seeds when direct call instructions target executable RVAs without stronger existing provenance.
- Reused the wave analyses for final graph/linear ownership merging so call-discovered functions stay stable, preserve static-provider precedence, and remain queryable through the existing APIs.
- Added engine regression coverage for call-seed registration rules plus an integration test that verifies no-PDB analysis surfaces graphable call-derived functions, and updated app protocol/provenance handling for the new seed kind.

Validation commands executed:
- `cargo fmt --manifest-path engine/Cargo.toml`
- `cargo test --manifest-path engine/Cargo.toml`
- `cargo fmt --manifest-path engine/Cargo.toml -- --check`
- `npm run check` (in `app`)
- `npx vitest run src/renderer/App.function-provenance.test.ts` (in `app`)

Changed files index:
- See `docs/change_files.md` for the detailed file list for this work item.

## 2026-03-07 - Improve Engine Analysis Cancellation Responsiveness

Summary:
- Threaded cancellation checks into per-function CFG traversal so in-flight workers can stop during basic-block and instruction walks instead of waiting for an entire function to finish.
- Split worker-pool stop scheduling from user cancellation so real analysis errors still propagate correctly while cancel requests prevent new tasks and skip unnecessary merge work.
- Added unit coverage for both CFG-level cancellation and module-level cancellation during parallel analysis.

Validation commands executed:
- `just engine-fmt`
- `cargo fmt --manifest-path engine/Cargo.toml -- --check`
- `just engine-test`

Changed files index:
- See `docs/change_files.md` for the detailed file list for this work item.

## 2026-03-07 - Parallelize Per-Function Engine Analysis

Summary:
- Replaced the serial function-analysis loop with a bounded worker pool so CFG/disassembly work runs in parallel while final ownership claiming still merges in canonical seed-priority order.
- Kept overlap resolution deterministic by moving claim application into a single-threaded ordered merge pass and added regression coverage for canonical ownership plus repeated stable analysis output.
- Captured an all-fixture saved baseline before the change and compared the new build against it, with large cold analysis wins on every fixture and warm micro-bench drift noted for follow-up profiling.

Validation commands executed:
- `just engine-bench-save parallel-analysis-baseline-2026-03-07 all`
- `just engine-fmt`
- `cargo fmt --manifest-path engine/Cargo.toml -- --check`
- `just engine-test`
- `just engine-bench-compare parallel-analysis-baseline-2026-03-07 all`

Changed files index:
- See `docs/change_files.md` for the detailed file list for this work item.

## 2026-03-07 - Record Full Hybrid Benchmark Baseline

Summary:
- Captured a named full-fixture Criterion baseline (`hybrid-full-2026-03-07`) for the new hybrid benchmark workflow.
- Recorded the baseline measurements and artifact roots in `docs/engine_benchmarking.md` so future comparisons can cite an exact saved baseline instead of ad hoc local runs.

Validation commands executed:
- `just engine-bench-save hybrid-full-2026-03-07 all`

Changed files index:
- See `docs/change_files.md` for the detailed file list for this work item.

## 2026-03-07 - Implement Hybrid Engine Benchmark Workflow

Summary:
- Refactored the Criterion harness into cold and warm API benchmark groups, expanded coverage to the missing public engine query APIs, and added fixture-set aware benchmark naming.
- Added deterministic derived benchmark fixtures plus `just` commands for quick runs, full runs, filtered runs, and saved-baseline comparisons.
- Rewrote `docs/engine_benchmarking.md` around the new hybrid workflow so quick local checks and higher-signal comparison runs share one canonical recording format.

Validation commands executed:
- `python engine/tests/fixtures/generate_bench_fixtures.py`
- `cargo fmt --manifest-path engine/Cargo.toml`
- `cargo fmt --manifest-path engine/Cargo.toml -- --check`
- `cargo test --manifest-path engine/Cargo.toml`
- `just engine-bench`
- `just engine-bench-all`
- `just engine-bench-filter engine/warm/function_list`
- `just engine-bench-save hybrid-validation`
- `just engine-bench-compare hybrid-validation`

Changed files index:
- See `docs/change_files.md` for the detailed file list for this work item.

## 2026-03-07 - Add Benchmark Reporting Template and AGENTS Instructions

Summary:
- Added a reusable result-entry template to `docs/engine_benchmarking.md` to standardize future benchmark updates.
- Extended `AGENTS.md` benchmarking instructions so performance updates must stay in sync across `docs/engine_benchmarking.md`, `docs/work_log.md`, and `docs/change_files.md`.

Validation commands executed:
- `just engine-bench`

Changed files index:
- See `docs/change_files.md` for the detailed file list for this work item.

## 2026-03-07 - Expand Engine Benchmark Coverage

Summary:
- Added new engine benchmarks for function graph and linear disassembly APIs so `engine/function_graph_by_va/minimal_x64` and `engine/linear_disassembly/minimal_x64` are tracked by the existing `analysis_bench` suite.
- Kept benchmark setup consistent with existing modules by reusing the analysis-ready wait helper and stable fixture path.

Validation commands executed:
- `cargo fmt --manifest-path engine/Cargo.toml`
- `cargo fmt --manifest-path engine/Cargo.toml -- --check`
- `cargo bench --manifest-path engine/Cargo.toml --bench analysis_bench`

Changed files index:
- See `docs/change_files.md` for the detailed file list for this work item.

## 2026-03-07 - Optimize Instruction Ownership Lookup with Ranges

Summary:
- Replaced byte-by-byte instruction ownership bookkeeping with function-ranged ownership entries in `engine/src/analysis.rs`.
- Added O(log n) range lookup for `function.getGraphByVa` and `function.disassembleLinear` in `engine/src/state.rs`.
- Kept functional behavior the same and added unit/integration coverage for range lookup semantics and in-range address handling.

Validation commands executed:
- `cargo fmt --manifest-path engine/Cargo.toml`
- `cargo fmt --manifest-path engine/Cargo.toml -- --check`
- `cargo test --manifest-path engine/Cargo.toml`
- `git stash push -u -m "Baseline before owner range optimization" -- engine/src/analysis.rs engine/src/state.rs engine/tests/engine_integration.rs`
- `cargo bench --manifest-path engine/Cargo.toml --bench analysis_bench` (baseline)
- `git stash pop`
- `cargo bench --manifest-path engine/Cargo.toml --bench analysis_bench` (post-change)

Observed benchmark deltas:
- `engine/module_open_and_analyze/minimal_x64`: ~76.54 ms -> ~70.27 ms
- `engine/linear_rows/minimal_x64`: ~26.41 µs -> ~24.63 µs
- `engine/function_graph_by_va/minimal_x64`: ~8.97 µs -> ~9.00 µs
- `engine/linear_disassembly/minimal_x64`: ~0.800 µs -> ~0.791 µs

Changed files index:
- See `docs/change_files.md` for the detailed file list for this work item.

## 2026-03-07 - Add Example Filled Benchmark Entry

Summary:
- Added a concrete sample block to `docs/engine_benchmarking.md` showing how to record a multi-benchmark gain update after an optimization pass.

Validation commands executed:
- `just engine-bench` (kept current doc aligned to an actually run benchmark command)

Changed files index:
- See `docs/change_files.md` for the detailed file list for this work item.

## 2026-03-07 - Add Engine Benchmarking Documentation

Summary:
- Added `docs/engine_benchmarking.md` describing the engine benchmark harness, A/B workflow, and how to run reproducible speed checks.
- Added the current known measurement history and a maintenance rule that requires updating results whenever gains are observed.
- Linked the new benchmarking guide from `docs/README.md`.

Validation commands executed:
- `just engine-bench` (to ensure the documented command works in practice)

Changed files index:
- See `docs/change_files.md` for the detailed file list for this work item.

## 2026-03-07 - Add Shared Bench Command to Justfile

Summary:
- Added `just` recipes to standardize engine benchmark execution (`engine-bench` for the engine target and `bench` as a project alias).
- Kept the new recipes narrowly scoped to the existing `analysis_bench` target for reproducible performance checks.

Validation commands executed:
- `just engine-bench`
- `just bench`

Changed files index:
- See `docs/change_files.md` for the detailed file list for this work item.

## 2026-03-07 - Add Criterion Benchmark Harness and Validate Speedup

Summary:
- Added a `criterion`-based benchmark harness for module analysis and linear-row materialization.
- Measured baseline and current code-path timings by stashing changes, benchmarking on clean code, restoring changes, and re-running the same benches.
- Current changes improved both measured paths (~23% speedup) in local runs on `minimal_x64.exe`.

Validation commands executed:
- `git stash push -u -m "Temporary stash for benchmark baseline"`
- `cargo bench --manifest-path engine/Cargo.toml --bench analysis_bench`
- `git stash pop`
- `cargo fmt --manifest-path engine/Cargo.toml`
- `cargo bench --manifest-path engine/Cargo.toml --bench analysis_bench`
- `cargo test --manifest-path engine/Cargo.toml`

Observed baseline vs current results:
- `engine/module_open_and_analyze/minimal_x64`: ~99.56 ms -> ~76.54 ms
- `engine/linear_rows/minimal_x64`: ~33.74 µs -> ~26.03 µs

Changed files index:
- See `docs/change_files.md` for the detailed file list for this work item.

## 2026-03-07 - Continue Low-Risk Engine Profiling Optimizations

Summary:
- Reduced avoidable heap allocation in the analysis-claiming pass by checking/setting `instruction_owner_by_rva` using direct offset loops instead of temporary vector collections.
- Streamlined linear data-row materialization by replacing per-row temporary `Vec<String>` formatting with a fixed-size byte buffer and shared hex encoder.
- Kept analysis behavior unchanged while keeping the same incremental progress semantics and background workflow.

Validation commands executed:
- `cargo fmt --manifest-path engine/Cargo.toml`
- `cargo fmt --manifest-path engine/Cargo.toml -- --check`
- `cargo test --manifest-path engine/Cargo.toml`

Changed files index:
- See `docs/change_files.md` for the detailed file list for this work item.

## 2026-03-07 - Rename Tauri Workspace from `app-tauri` to `app`

Summary:
- Renamed the desktop workspace directory from `app-tauri` to `app` and updated the live repo command surface to use the new path consistently.
- Renamed the app package/crate identifiers to `app` so the Node metadata, Cargo metadata, and build artifact naming match the simplified workspace name.
- Refreshed the active repo instructions and scope docs to describe the desktop workspace as `app`, and updated the portable-build recipe to stage the renamed `app.exe` artifact.

Validation commands executed:
- `just check`
- `just test`
- `just build`
- `just build-portable`

Changed files index:
- See `docs/change_files.md` for the detailed file list for this work item.

## 2026-03-07 - Remove Vite Dev Server from Tauri Runtime Flow

Summary:
- Removed the Tauri `devUrl` and `beforeDevCommand` wiring so the desktop shell no longer depends on a Node-hosted Vite dev server to load the UI.
- Changed app development to build the renderer once and let Tauri load static assets from `dist`, matching the production asset-loading model.
- Dropped the unused Vite dev-server script and server config so the frontend toolchain is only used for bundling, not for serving the desktop UI.

Validation commands executed:
- `npm run check` (in `app-tauri`)
- `npm run test` (in `app-tauri`)
- `npm run build` (in `app-tauri`)
- `just check`
- `just test`
- `just build`

Changed files index:
- See `docs/change_files.md` for the detailed file list for this work item.

## 2026-03-07 - Merge Tauri Host and Engine into One Rust Backend

Summary:
- Replaced the Tauri host's JSON-RPC child-process bridge with direct in-process calls into the reusable `engine` library crate.
- Promoted the engine request/result structs into a public typed API, removed the stdio/server transport layer, and rewired the Tauri backend to expose explicit engine commands instead of a generic `engine_request` entrypoint.
- Deleted the schema/codegen and sidecar packaging pipeline, removed the now-unused `shared/` protocol workspace, and simplified app tooling, permissions, and tests around the unified Rust backend.

Validation commands executed:
- `npm run check` (in `app-tauri`)
- `npm run test` (in `app-tauri`)
- `cargo test --manifest-path engine/Cargo.toml`
- `just check`
- `just test`
- `just build`

Changed files index:
- See `docs/change_files.md` for the detailed file list for this work item.

## 2026-03-07 - Remove Legacy Electron App Workspace

Summary:
- Deleted the legacy `app-electron` workspace now that `app-tauri` is the only supported desktop shell.
- Removed the remaining Electron-specific root recipes and ignore rules so `just` and repo tooling are Tauri-only.
- Renamed the shared protocol schema/type surface to neutral desktop-shell wording and refreshed the current instructions/scope docs to match the post-migration architecture.

Validation commands executed:
- `just check`
- `just test`
- `just build`

Changed files index:
- See `docs/change_files.md` for the detailed file list for this work item.

## 2026-03-07 - Replace Electron Shell with Tauri 2 App Workspace

Summary:
- Added a new `app-tauri` workspace that ports the existing React/Vite renderer to a Tauri 2 desktop shell and replaces the Electron preload/global bridge with a Tauri-backed `desktopApi`.
- Implemented a Tauri Rust host for custom window chrome state, native File menu + recent-files persistence, executable picking, and a persistent JSON-RPC child-process proxy to the existing Rust analysis engine.
- Switched root `just` app workflows to `app-tauri`, kept explicit transitional `app-electron-*` recipes, and added a sidecar preparation step so debug builds bundle the external engine binary layout expected by Tauri.
- Kept root validation green by formatting the engine crate and setting the default Tauri build command to `--no-bundle` until installer/icon branding assets are intentionally introduced.

Validation commands executed:
- `npm run test:renderer` (in `app-tauri`)
- `npm run check` (in `app-tauri`)
- `npm run test` (in `app-tauri`)
- `cargo check --manifest-path app-tauri/src-tauri/Cargo.toml`
- `just check`
- `just test`
- `just build`

Changed files index:
- See `docs/change_files.md` for the detailed file list for this work item.

## 2026-03-06 - Fix C++ PDB Name Extraction for Complex Template Signatures

Summary:
- Reworked PDB symbol-name simplification so C++ demangled names are extracted by scanning from the end of the signature instead of splitting on whitespace.
- Preserved fully qualified callable names across nested template arguments and conversion-operator type names while still dropping return types and parameter lists.
- Added unit coverage for complex templated member functions and conversion operators.

Validation commands executed:
- `cargo test --manifest-path engine/Cargo.toml`

Changed files index:
- See `docs/change_files.md` for the detailed file list for this work item.

## 2026-03-06 - Simplify PDB Demangled Names to Function Names

Summary:
- Changed PDB symbol-name normalization to collapse demangled names down to the callable name instead of preserving return types, parameter lists, and Rust hash suffixes.
- Added unit coverage for signature stripping and an integration assertion that PDB-derived function seeds do not expose parameter lists in `function.list`.

Validation commands executed:
- `cargo test --manifest-path engine/Cargo.toml`

Changed files index:
- See `docs/change_files.md` for the detailed file list for this work item.

## 2026-03-06 - Add Repository MIT License Metadata

Summary:
- Added a root `LICENSE` file with the standard MIT license text for the repository.
- Declared `MIT` package metadata in the Electron app `package.json` and Rust engine `Cargo.toml` so ecosystem tooling reports the same license consistently.

Validation commands executed:
- `cargo metadata --manifest-path engine/Cargo.toml --no-deps`
- `npm pkg get license` (in `app-electron`)

Changed files index:
- See `docs/change_files.md` for the detailed file list for this work item.

## 2026-03-06 - Rebuild Engine Analysis Around Function-Scoped Disassembly

Summary:
- Replaced section-wide executable decoding with a unified module analysis cache that discovers function seeds from PDB, exports, TLS callbacks, entry point, and exception directory, then analyzes each seeded function with CFG-aware disassembly.
- Reworked linear view generation to materialize only claimed function instructions as `instruction` rows while rendering every other mapped byte as grouped `db` data rows, including bytes inside executable sections that are not owned by any analyzed function.
- Added TLS provenance to shared schema/app types and browser provenance rendering so discovered TLS callbacks surface consistently in the UI and schema tests.
- Kept Graph View and `function.disassembleLinear` backed by the same function analysis data so function ownership, block focus, and linear rows all read from one source of truth.

Validation commands executed:
- `cargo check --manifest-path engine/Cargo.toml`
- `cargo test --manifest-path engine/Cargo.toml`
- `just app-gen-protocol`
- `cd app-electron; npm run check`
- `cd app-electron; npm run test`
- `just fmt`
- `just check`
- `just test`

Changed files index:
- See `docs/change_files.md` for the detailed file list for this work item.

## 2026-03-06 - Surface Graph Generation Status in Status Bar

Summary:
- Added renderer state tracking for in-flight graph generation when opening Graph View from Disassembly.
- Updated status bar UI to display a live `Building graph...` indicator while `function.getGraphByVa` is in progress.
- Cleared graph-building status during unload/open flows and after graph request completion (success or error).

Validation commands executed:
- `just fmt`
- `just check`
- `just test`

Changed files index:
- See `docs/change_files.md` for the detailed file list for this work item.

## 2026-03-06 - Center Graph View on Highlighted Disassembly Instruction

Summary:
- Extended `function.getGraphByVa` results with `focusBlockId` to identify the basic block containing the highlighted instruction VA used to open Graph View.
- Added engine-side instruction-RVA to block-id mapping in cached CFG results and returned the focused block id for both cached and newly-built graphs.
- Updated Graph View initialization to keep default zoom at 100% and center on the focused block instead of fitting the full graph extents.
- Updated shared schema/types and renderer/engine tests and mocks to reflect the new graph response contract.

Validation commands executed:
- `just fmt`
- `just check`
- `just test`

Changed files index:
- See `docs/change_files.md` for the detailed file list for this work item.

## 2026-03-06 - Add Mnemonic Category Coloring to Graph View Blocks

Summary:
- Extended graph instruction payloads to include `instructionCategory` so Graph View can reuse Disassembly mnemonic color semantics.
- Updated engine CFG decode output and graph result assembly to populate per-instruction categories in `function.getGraphByVa` responses.
- Updated protocol schema/shared types and regenerated app protocol bindings for the graph instruction contract change.
- Reworked Graph View node text rendering to HTML labels so each instruction line can style mnemonic spans using existing `.mnemonic-*` classes.
- Added schema/integration test coverage for graph instruction category presence and updated renderer graph test fixtures.

Validation commands executed:
- `just fmt`
- `just check`
- `just test`

Changed files index:
- See `docs/change_files.md` for the detailed file list for this work item.

## 2026-03-06 - Add Function Graph View Toggle with Engine CFG RPC

Summary:
- Added a new schema/RPC surface (`function.getGraphByVa`) across shared schema, Electron bridge layers, and engine protocol handling.
- Implemented engine-side function CFG analysis in a dedicated `cfg` module, with basic block/edge extraction and cached instruction-to-function ownership lookup for VA-targeted graph requests.
- Added a renderer Graph View panel (Cytoscape-backed) and Space key toggle behavior from Disassembly, including transient status feedback when the highlighted instruction is not part of a discovered function.
- Hardened graph-opening behavior by ensuring the selected disassembly row page is fetched on-demand before validating instruction row kind.
- Added/updated renderer and engine tests to cover schema contract changes, graph request behavior, and UI toggle/status flows.

Validation commands executed:
- `just fmt`
- `just check`
- `just test`

Changed files index:
- See `docs/change_files.md` for the detailed file list for this work item.

## 2026-03-06 - Generate Default Function Names from VA

Summary:
- Updated engine default auto-generated function seed names to use VA instead of RVA (`sub_<va>`).
- Switched `function.list` default naming callsites (entry/export/exception) to pass VA values derived from image base plus RVA.
- Updated engine integration assertions to validate non-PDB default names against each seed's VA start address.

Validation commands executed:
- `just fmt`
- `just check`
- `just test`

Changed files index:
- See `docs/change_files.md` for the detailed file list for this work item.

## 2026-03-06 - Migrate Engine/App Linear Address Contract from RVA to VA

Summary:
- Completed the protocol migration from RVA-oriented payloads to VA-oriented payloads/results for module metadata and linear navigation surfaces.
- Updated engine protocol boundaries to keep internal linear indexing in RVA while converting request/response addresses at the boundary using module image base.
- Switched linear row/disassembly output addresses and branch/call targets to VA values so renderer address displays and navigation align with loaded image base.
- Unified renderer/browser/disassembly navigation naming and payloads around VA (`findRowByVa` with `va` field) and aligned existing renderer tests with the updated contract.

Validation commands executed:
- `just fmt`
- `just check`
- `just test`

Changed files index:
- See `docs/change_files.md` for the detailed file list for this work item.

## 2026-03-06 - Split Renderer App Monolith into Feature Modules

Summary:
- Refactored `App.tsx` into a composition-oriented root by extracting major UI sections into reusable feature components (`BrowserPanel`, `DisassemblyPanel`, status bar, and dialogs).
- Moved shared renderer utilities out of `App.tsx` into dedicated modules for deferred edge rebasing, DOM edit-target detection, and numeric helpers.
- Moved function provenance shortcode mapping into a browser feature utility and preserved `toFunctionProvenanceCode` compatibility by re-exporting it from `App.tsx`.
- Preserved runtime behavior and existing DOM class/test contracts while reducing `App.tsx` size and grouping code by functionality.

Validation commands executed:
- `just fmt`
- `just check`
- `just test`

Changed files index:
- See `docs/change_files.md` for the detailed file list for this work item.

## 2026-03-06 - Toggle Browser Search with Ctrl+F and Compact Search Label

Summary:
- Changed Browser search input placeholder text from `Filter functions...` to `Search`.
- Converted Browser search UI from always-visible to toggle-on-demand behavior driven by `Ctrl+F` when the Browser panel is active.
- Added Browser search focus management and Escape/active-panel transition handling so the search input closes cleanly and clears query/search state when hidden.
- Updated renderer tests to validate shortcut-driven search visibility and search flow under the new toggle behavior.

Validation commands executed:
- `cd app-electron; npm run test:renderer -- src/renderer/App.function-browser.test.tsx src/renderer/App.function-browser-window.test.tsx`
- `just fmt`
- `just check`
- `just test`

Changed files index:
- See `docs/change_files.md` for the detailed file list for this work item.

## 2026-03-05 - Add Responsive Browser Function Search with Async Search

Summary:
- Added a bottom search input to the Browser panel to search functions by case-insensitive name match.
- Switched Browser list search to asynchronous chunked processing with cancellation so typing remains responsive on very large function sets.
- Kept existing Browser results visible while search is in progress and added an animated `Searching...` indicator in the status bar.
- Updated Browser virtualization to consume search-result index sets, including viewport/rebase resets when a new search result is applied.
- Added renderer tests for case-insensitive search behavior, searched/total count display, no-match handling, and huge-list search-result height behavior.

Validation commands executed:
- `just fmt`
- `just check`
- `just test`

Changed files index:
- See `docs/change_files.md` for the detailed file list for this work item.

## 2026-03-05 - Remove Inspector Panel and Simplify Main Layout

Summary:
- Removed the Inspector panel from the renderer main layout, including its right splitter and related interaction surface.
- Simplified panel layout and resize behavior to a two-panel model (`Browser` + `Disassembly`) with only left-panel width control.
- Removed inspector-specific renderer imports and markup while preserving section data usage for disassembly row section-name labeling.
- Cleaned unused inspector panel style blocks from renderer CSS.

Validation commands executed:
- `just fmt`
- `just check`
- `just test`

Changed files index:
- See `docs/change_files.md` for the detailed file list for this work item.

## 2026-03-05 - Refine Title Badge Chrome and Loading Modal Presentation

Summary:
- Updated the custom title-bar badge label to `V.ıDA Pro` and refined badge-area spacing/background so it reads as a distinct left-edge chrome segment.
- Added and then simplified loading-modal behavior to keep interaction blocking and spinner feedback while removing modal/backdrop fade motion for immediate appearance/disappearance.
- Aligned loading spinner inline with loading text for cleaner visual hierarchy.
- Extended shared dialog primitive support with loading-specific overlay class customization for targeted modal styling.

Validation commands executed:
- `cd app-electron; npm run check`
- `cd app-electron; npm run test:renderer -- src/renderer/App.loading-modal.test.tsx`
- `cd app-electron; npm run test:renderer -- src/renderer/App.window-chrome.test.tsx`

Changed files index:
- See `docs/change_files.md` for the detailed file list for this work item.

## 2026-03-05 - Add Blocking File Loading Modal Overlay

Summary:
- Added a blocking loading dialog that opens while a file is being loaded, dims the main UI, and prevents interaction until loading completes.
- Added explicit loading copy and the selected file path in the modal so users have clear status feedback during module open.
- Wired loading-path state to module-open lifecycle and reset paths on completion/unload.
- Added renderer test coverage for loading-modal visibility during asynchronous file open.

Validation commands executed:
- `just check`
- `just test`

Changed files index:
- See `docs/change_files.md` for the detailed file list for this work item.

## 2026-03-05 - Shorten Function Provenance Labels in Browser UI

Summary:
- Replaced raw function provenance strings in the Browser function list with stable shortcodes to reduce visual noise and improve scanability.
- Added renderer mapping for known provenance kinds (`pdb`, `exception`, `import`, `export`, `entry`) and a lowercase 3-character fallback for unknown future kinds.
- Restyled function provenance badges into compact pill-like chips and reduced spacing to the function name for a tighter list layout.
- Added per-kind provenance badge colors so each source type is visually distinct while keeping light/dark theme consistency.
- Added dedicated renderer unit tests for provenance-code mapping behavior.

Validation commands executed:
- `just check`
- `just test`

Changed files index:
- See `docs/change_files.md` for the detailed file list for this work item.

## 2026-03-05 - Add PDB-Based Function Discovery with Strict RSDS Matching

Summary:
- Added engine-side PDB-backed function discovery that reads RSDS debug metadata from PE debug directory and auto-discovers candidate PDB files on disk using targeted local path resolution.
- Introduced a dedicated reusable PDB parsing module that validates strict GUID+age matches, parses Procedure/Public symbols, filters to executable RVAs, and best-effort demangles Rust/MSVC names.
- Extended `function.list` seed kinds with `pdb` and merged PDB-derived seeds with precedence over overlapping PE-derived seeds at the same RVA.
- Added deterministic fixture coverage by checking in a matching PDB fixture and adding integration tests for both positive discovery and strict GUID+age mismatch fallback behavior.
- Updated shared protocol schema/app schema tests and shared TypeScript protocol type to include the new `pdb` function seed kind.

Validation commands executed:
- `just fmt`
- `just check`
- `just test`

Changed files index:
- See `docs/change_files.md` for the detailed file list for this work item.

## 2026-03-05 - Add File Menu Unload Command Flow

Summary:
- Added a new `File -> Unload` command in Electron main menu construction and mirrored it through the custom title-bar menu model.
- Introduced a new `app:menu-unload-module` IPC event and preload/shared API subscription so the renderer can react to unload commands from either native or custom chrome menus.
- Implemented renderer unload handling to clear module/disassembly/function state and reset virtualization/cache/history state back to an unloaded baseline.
- Added renderer test coverage to verify unloading resets visible module state after a module load.

Validation commands executed:
- `just check`
- `just test`

Changed files index:
- See `docs/change_files.md` for the detailed file list for this work item.

## 2026-03-05 - Add Frameless Custom Window Chrome and Menubar Integration

Summary:
- Enabled frameless Electron windows on all desktop platforms and added window-state IPC events/actions so the renderer can drive minimize/maximize/close controls.
- Implemented a shared custom title bar component in the renderer with shadcn dropdown-based application menus and native-style window controls.
- Added backend title-bar menu modeling and command dispatch in Electron main so the custom menubar stays synchronized with native menu actions, including existing Open and Open Recent flows.
- Expanded renderer tests to cover the new custom chrome API surface and added a regression test for title bar menu and window control interactions.

Validation commands executed:
- `npm run fmt` (in `app-electron`)
- `just check`
- `just test`

Changed files index:
- See `docs/change_files.md` for the detailed file list for this work item.

## 2026-03-05 - Unify Deferred Rebase Logic for Virtualized Scroll Panels

Summary:
- Refactored duplicated deferred edge-rebase behavior into shared renderer helpers for setup, timer cleanup, and state reset.
- Switched both Browser and Disassembly panels to use the same `setupDeferredEdgeRebase` implementation with panel-specific parameters.
- Kept existing behavior unchanged while reducing duplication and centralizing maintenance for scroll-rebase behavior.

Validation commands executed:
- `just check`
- `just test`

Changed files index:
- See `docs/change_files.md` for the detailed file list for this work item.

## 2026-03-05 - Add Deferred Edge Rebase for Function Browser Scrolling

Summary:
- Applied bounded window virtualization to the function browser list to prevent oversized scroll canvases on very large function sets.
- Added deferred edge rebasing for the function list so rebases do not happen during active scrolling, and are applied on `scrollend` (or idle fallback) when the viewport reaches an edge zone.
- Preserved scroll-thumb continuity by adjusting `scrollTop` only after rebase application.
- Added renderer regression coverage for huge function counts to ensure the function-list canvas stays bounded.

Validation commands executed:
- `just check`
- `just test`

Changed files index:
- See `docs/change_files.md` for the detailed file list for this work item.

## 2026-03-05 - Defer Disassembly Rebase Until Scroll Ends

Summary:
- Updated large-view disassembly rebasing to avoid any window rebase while `scroll` events are actively firing.
- Added deferred rebase application that runs on `scrollend` when available, with an idle fallback timer for environments lacking `scrollend` support.
- Ensured edge rebases still preserve viewport continuity by adjusting `scrollTop` after rebasing, but only after scroll interaction completion.

Validation commands executed:
- `just check`
- `just test`

Changed files index:
- See `docs/change_files.md` for the detailed file list for this work item.

## 2026-03-05 - Stabilize Deep-Scroll Disassembly Rebase Behavior

Summary:
- Replaced virtual-item edge-triggered disassembly window rebasing with scroll-position-based rebasing to avoid renderer instability during deep scrolling.
- Preserved viewport continuity by adjusting `scrollTop` during rebase transitions instead of relying on repeated `scrollToIndex` rebases.
- Retained bounded disassembly window rendering for large modules while preventing blank/vanishing UI behavior at large scroll offsets.

Validation commands executed:
- `just check`
- `just test`

Changed files index:
- See `docs/change_files.md` for the detailed file list for this work item.

## 2026-03-05 - Fix Large-Module Disassembly Scroll Coverage

Summary:
- Fixed disassembly navigation for very large modules by replacing a single unbounded virtual canvas with a bounded sliding window of rows.
- Added automatic window rebasing when scrolling near window edges so users can continue scrolling through the full logical row space without hitting browser scroll-height limits.
- Preserved existing paged row fetching and row selection semantics by mapping visible window indexes back to logical row indexes.
- Added renderer regression coverage to ensure huge row counts keep the disassembly canvas bounded.

Validation commands executed:
- `just check`
- `just test`

Changed files index:
- See `docs/change_files.md` for the detailed file list for this work item.

## 2026-03-05 - Add Persistent File Menu Open Recent Flow

Summary:
- Added a `File -> Open Recent` submenu in the Electron app menu that lists recently opened executable paths and dispatches open events to the focused renderer window.
- Implemented a 10-item persistent MRU list stored in Electron `userData` as `recent-executables.json`, with path normalization, deduplication, and stale-file filtering.
- Extended preload/shared renderer API contracts for recent-file add/open IPC, and wired renderer open flows so successful module loads are recorded in the MRU list.
- Updated renderer virtualization test mocks to include the new Electron API surface.

Validation commands executed:
- `just check`
- `just test`

Changed files index:
- See `docs/change_files.md` for the detailed file list for this work item.

## 2026-03-05 - Split Engine Library into Domain Modules

Summary:
- Refactored `engine/src/lib.rs` into focused modules for errors, RPC transport, protocol payloads, engine state/method handlers, PE helpers, disassembly helpers, and linear-view logic.
- Preserved existing public engine API (`EngineState`, JSON-RPC request/response types, stdio server entrypoint, fixture path helper) while reducing `lib.rs` to module wiring and re-exports.
- Moved crate unit tests out of `lib.rs` into a dedicated `engine/src/tests.rs` module file.

Validation commands executed:
- `cargo test --manifest-path engine/Cargo.toml`
- `cargo fmt --manifest-path engine/Cargo.toml`
- `just check`
- `just test`

Changed files index:
- See `docs/change_files.md` for the detailed file list for this work item.

## 2026-03-05 - Virtualize Function Browser List Rendering

Summary:
- Replaced eager function-list rendering with windowed virtualization in the Browser panel using `@tanstack/react-virtual`.
- Added a dedicated virtualized scroll region and absolute-positioned function rows to avoid mounting thousands of function buttons at once.
- Added renderer test coverage to ensure large function datasets use the virtualized list path.

Validation commands executed:
- `cd app-electron; npx biome check --write src/renderer/App.tsx src/renderer/styles.css src/renderer/App.function-browser.test.tsx`
- `cd app-electron; npm run test:renderer -- src/renderer/App.function-browser.test.tsx`
- `just check`
- `just test`

Changed files index:
- See `docs/change_files.md` for the detailed file list for this work item.

## 2026-03-05 - Align Renderer Theme Tokens with Shadcn New York v4 Zinc

Summary:
- Replaced renderer light/dark semantic color tokens with the exact `theme-zinc` values from the live `ui.shadcn.com` `new-york-v4` registry.
- Migrated semantic color rendering from `hsl(var(--token))` to `oklch(var(--token))` across renderer styles and Tailwind color mappings so tokens match the shadcn v4 color model.
- Added chart and sidebar token variables from the same registry set to keep token coverage consistent with shadcn defaults.

Validation commands executed:
- `just fmt`
- `just check`
- `just test`
- `just build`

Changed files index:
- See `docs/change_files.md` for the detailed file list for this work item.

## 2026-03-05 - Mirror Shadcn Site Theme and Typography (Light + Dark)

Summary:
- Added system-aware light/dark theme infrastructure in the renderer with persisted user override (`vite-ui-theme`) and in-app theme toggle controls.
- Updated global renderer tokens and typography to mirror shadcn site styling conventions, including dual light/dark token sets and Geist Sans/Geist Mono font usage.
- Refined shared UI primitives and renderer chrome styles to better match shadcn interaction and visual defaults while preserving disassembly workflows.
- Added renderer test coverage for theme toggle behavior and maintained raw-control consistency guardrails.
- Updated visual guidelines to document light/dark parity and typography standards.

Validation commands executed:
- `just fmt`
- `just check`
- `just test`
- `just build`

Changed files index:
- See `docs/change_files.md` for the detailed file list for this work item.

## 2026-03-05 - Migrate Renderer UI Foundation to Shadcn Consistency Model

Summary:
- Added Tailwind + shadcn-compatible renderer foundations (tokens, aliasing, component registry metadata, and utility helpers).
- Introduced shared renderer UI primitives (`Button`, `Input`, `Badge`, `Dialog`, `ScrollArea`, `Separator`) and migrated `App.tsx` controls/modals/status surfaces to use them.
- Reworked renderer stylesheet to a dark shadcn-token baseline and removed obsolete transport-era CSS surfaces.
- Added consistency and renderer utility tests (`ui-consistency` raw-control guardrail and Vitest coverage for shared class merge utility).
- Updated visual guidance to codify shadcn-based consistency rules and strict shared-primitive usage.

Validation commands executed:
- `just fmt`
- `just check`
- `just test`
- `just build`

Changed files index:
- See `docs/change_files.md` for the detailed file list for this work item.

## 2026-03-05 - Add Function Discovery from PE Exception Directory

Summary:
- Extended engine function discovery to include x64 exception directory (`.pdata`) runtime function entries.
- Added exception-derived seeds to `function.list` with kind `exception`, while preserving entry/export precedence and deterministic RVA ordering.
- Updated protocol schema and app shared types so `FunctionSeed.kind` supports `exception`.
- Added engine unit/integration and schema validation tests for exception seed handling.

Validation commands executed:
- `cargo fmt --manifest-path engine/Cargo.toml`
- `cargo test --manifest-path engine/Cargo.toml`
- `cd app-electron; npx biome check --write src/shared/protocol.ts test/protocol-schema.test.js`
- `cd app-electron; npx biome check src/shared/protocol.ts test/protocol-schema.test.js`
- `cd app-electron; npx tsc -p tsconfig.main.json --noEmit`
- `cd app-electron; npx tsc -p tsconfig.renderer.json --noEmit`
- `cd app-electron; npm run test`

Changed files index:
- See `docs/change_files.md` for the detailed file list for this work item.

## 2026-03-05 - Linear Mapped-File View with Virtualized Paging

Summary:
- Added new engine RPC methods for linear mapped view metadata, paged row retrieval, and RVA-to-row lookup.
- Implemented engine-side linear segment indexing that emits executable rows as disassembly and non-executable rows as `db` byte directives, with explicit gap rows for unmapped ranges.
- Reworked the disassembly panel to a virtualized, paged renderer to keep the UI responsive on large binaries while preserving existing navigation flows.
- Added module-switch safety in renderer paging to prevent stale page responses from previous modules polluting the active view.

Validation commands executed:
- `just fmt`
- `just check`
- `just test`
- `just build`

Changed files index:
- See `docs/change_files.md` for the detailed file list for this work item.

## 2026-03-05 - Branch/Call Follow Actions as Comment Hyperlinks

Summary:
- Replaced branch/call follow controls in the Operands column with hyperlink-style comment text in the `Comment` column.
- Changed interaction semantics from button-style controls to anchor-style navigation actions.
- Kept target navigation behavior the same (`disassembleAt` on click).

Validation commands executed:
- `just fmt`
- `just check`

Changed files index:
- See `docs/change_files.md` for the detailed file list for this work item.

## 2026-03-05 - Open EXE Button Vertical Alignment Fix

Summary:
- Adjusted `.transport-button` layout to use inline-flex centering.
- Ensured button text is vertically centered in the control.

Validation commands executed:
- `just fmt`
- `just check`

Changed files index:
- See `docs/change_files.md` for the detailed file list for this work item.

## 2026-03-05 - Add Comment Column with Remaining-Width Fill

Summary:
- Added a `Comment` column to the disassembly table.
- Kept `Address`, `Bytes`, `Instruction`, and `Operands` as resizable fixed-width columns.
- Updated table width logic so `Comment` absorbs remaining horizontal space in the panel.

Validation commands executed:
- `just fmt`
- `just check`

Changed files index:
- See `docs/change_files.md` for the detailed file list for this work item.

## 2026-03-05 - Disassembly Column Resize Behavior Correction

Summary:
- Fixed disassembly header column resizing behavior so each handle maps reliably to its intended column.
- Removed table width redistribution by using explicit computed table width from column variables.
- Adjusted column-resizer hit area placement to avoid cross-column clipping/overlap issues.

Validation commands executed:
- `just fmt`
- `just check`

Changed files index:
- See `docs/change_files.md` for the detailed file list for this work item.

## 2026-03-05 - Disassembly Column Width Resizing

Summary:
- Added draggable column resizers for `Address`, `Bytes`, `Instruction`, and `Operands` in the disassembly header.
- Added per-column width state with minimum width constraints and pointer-drag resizing behavior.
- Updated table layout to honor explicit column widths while preserving horizontal overflow support.

Validation commands executed:
- `just fmt`
- `just check`

Changed files index:
- See `docs/change_files.md` for the detailed file list for this work item.

## 2026-03-05 - Remove Operand Dash Fallback in Renderer

Summary:
- Removed renderer fallback that displayed `-` for empty operands.
- Empty operands now render as empty content to match engine output semantics.

Validation commands executed:
- `just fmt`
- `just check`

Changed files index:
- See `docs/change_files.md` for the detailed file list for this work item.

## 2026-03-05 - Disassembly Mono Typography and Row Separator Removal

Summary:
- Applied a consistent monospace font across the disassembly panel content and header.
- Removed horizontal separators between instruction rows in the disassembly table body.
- Kept header separation so column labels remain readable.

Validation commands executed:
- `just fmt`
- `just check`

Changed files index:
- See `docs/change_files.md` for the detailed file list for this work item.

## 2026-03-05 - Splitter Gap Tightening

Summary:
- Reduced visible horizontal gaps between panels after making splitters non-visual.
- Removed desktop grid column gaps around splitter tracks.
- Kept usable splitter hit zones via small overlap margins while maintaining tight panel spacing.

Validation commands executed:
- `just fmt`
- `just check`

Changed files index:
- See `docs/change_files.md` for the detailed file list for this work item.

## 2026-03-05 - Invisible Splitter UI Tweak

Summary:
- Made panel resize regions non-visual while preserving drag-to-resize behavior.
- Removed visible splitter line and chrome styling so splitters act as transparent hit zones.

Validation commands executed:
- `just fmt`
- `just check`

Changed files index:
- See `docs/change_files.md` for the detailed file list for this work item.

## 2026-03-06 - Background Module Analysis and Progress Reporting

Summary:
- Changed module loading so `module.open` returns after lightweight PE registration while function discovery and analysis continue in the background.
- Added engine analysis status and unload RPCs, including progress states for discovery, per-function analysis, finalization, failure, and cancelation.
- Updated the Electron client timeout policy so long-running module work no longer times out during large executable loads.
- Updated the renderer to poll analysis status, surface progress in the Browser and status bar, keep the shell responsive, and defer Disassembly until analysis is ready.
- Added schema, renderer, and engine test coverage for staged module loading, status polling, and unload behavior.

Validation commands executed:
- `just fmt`
- `just check`
- `just test`

Changed files index:
- See `docs/change_files.md` for the detailed file list for this work item.

## 2026-03-05 - Independent Panel Scroll Fix

Summary:
- Fixed desktop layout sizing so the page no longer grows with long disassembly content.
- Constrained shell/layout to viewport height and hidden outer overflow on desktop.
- Ensured panel bodies own scrolling behavior instead of creating a single page-level scroll region.
- Added mobile fallback to restore page scrolling behavior in narrow layouts.

Validation commands executed:
- `just fmt`
- `just check`

Changed files index:
- See `docs/change_files.md` for the detailed file list for this work item.

## 2026-03-05 - Panel Resizing and Independent Scroll Behavior

Summary:
- Added draggable splitters between Browser, Disassembly, and Inspector panels in desktop layout.
- Added pointer-based width resizing with minimum/maximum constraints to preserve usable center workspace.
- Ensured each panel body scrolls independently (`overflow` and overscroll containment).
- Updated visual guidelines to capture splitter and panel scroll behavior.

Validation commands executed:
- `just fmt`
- `just check`

Changed files index:
- See `docs/change_files.md` for the detailed file list for this work item.

## 2026-03-05 - Ableton Styling Correction Pass

Summary:
- Removed gradient usage from primary app surfaces and key controls.
- Increased border thickness to create stronger panel/control framing.
- Tightened corner radii while keeping rounded panels and controls.
- Updated visual guidelines to codify these adjustments.

Validation commands executed:
- `just fmt`
- `just check`

Changed files index:
- See `docs/change_files.md` for the detailed file list for this work item.

## 2026-03-05 - Ableton-Inspired Visual System and Layout Refresh

Summary:
- Added a locked visual guideline document for an Ableton Live 12-inspired dark desktop UI.
- Reworked renderer layout into a transport-style top strip and denser panel chrome.
- Replaced previous light styling with compact dark design tokens, typography rules, and single-orange accent state treatment.
- Preserved existing app behavior and data flow while improving visual hierarchy and density.

Validation commands executed:
- `just fmt`
- `just check`
- `just test`
- `just build`

Changed files index:
- See `docs/change_files.md` for the detailed file list for this work item.

## 2026-03-04 to 2026-03-05 - MVP1 Vertical Slice Foundation

Summary:
- Migrated renderer to React + Vite + TypeScript.
- Added persistent Rust engine child process integration in Electron main/preload.
- Implemented JSON-RPC stdio engine server and MVP1 methods (`engine.ping`, `module.open`, `module.info`, `function.list`, `function.disassembleLinear`).
- Added schema-first protocol contract in `shared/schemas/protocol.schema.json` and generated TypeScript protocol types.
- Added deterministic fixture-based engine integration tests and schema contract tests.
- Updated scope and agent guidance to reflect locked architecture decisions.

Validation commands executed:
- `just fmt`
- `just check`
- `just test`
- `just build`

Changed files index:
- See `docs/change_files.md` for the detailed file list for this work item.

## 2026-03-09 - Navigation Coherence Across Linear, Graph, and Memory Overview

Summary:
- Unified renderer-side VA focus updates so graph selection/jumps, linear navigation, and memory-overview jumps all flow through the same lookup and selection path.
- Kept the memory overview marker pinned to the focused instruction while Graph View is active instead of leaving it on the last visible linear viewport midpoint.
- Re-synchronized disassembly selection/viewport from the focused VA when toggling back from Graph View so returning to Linear View lands on the graph-focused instruction.
- Added renderer regression coverage for graph operand jumps preserving the returned linear focus and documented the graph operand overlay control as an explicit shared-UI exception.

Validation commands executed:
- `just app-fmt`
- `just app-test`
- `just app-check`

Changed files index:
- See `docs/change_files.md` for the detailed file list for this work item.

## 2026-03-09 - Prompt for Manual PDB Selection When Auto-Discovery Misses

Summary:
- Added engine-side PDB preflight and strict manual PDB validation so module loading can distinguish between no PDB metadata, an auto-resolved match, and a missing match that needs user input.
- Added Tauri host commands for PDB status lookup and manual `.pdb` file picking, then wired the renderer to show a missing-PDB modal and optionally continue loading without symbols.
- Ensured manual PDB selection failures remain fatal for that load attempt, and added engine plus renderer regression coverage for auto-found, manual-pick, cancel, and mismatch flows.

Validation commands executed:
- `just engine-test`
- `just app-check`
- `cd app; npm run test:backend`
- `cd app; npm run test:renderer -- src/renderer/shell/app.manual-pdb-modal.test.tsx src/renderer/shell/app.loading-modal.test.tsx`

Changed files index:
- See `docs/change_files.md` for the detailed file list for this work item.

## 2026-03-10 - Replace Workspace Error Banner With Shared Error Modal

Summary:
- Replaced the shell's inline workspace error banner with a shared error-details modal so module, PDB, navigation, xref, and shell-chrome failures surface in a consistent dialog.
- Added fatal load cleanup for analysis failures so a failed background analysis returns the workspace to idle instead of leaving the loading spinner active behind the error.
- Changed manual PDB picker cancellation to abort the load quietly without surfacing an error, and expanded renderer regression coverage for the updated modal flows.

Validation commands executed:
- `cmd /c npm run check` (in `app`)
- `cmd /c npm run test:renderer -- src/renderer/shell/app.manual-pdb-modal.test.tsx src/renderer/shell/app.loading-modal.test.tsx src/renderer/shell/app.xrefs-modal.test.tsx src/renderer/shell/app.window-chrome.test.tsx` (in `app`)

Changed files index:
- See `docs/change_files.md` for the detailed file list for this work item.

## 2026-03-10 - Improve Manual PDB Failure Guidance

Summary:
- Reworded manual PDB validation failures so mismatch, open, and parse errors describe the selected file more clearly instead of surfacing the previous raw phrasing.
- Added same-build guidance plus the module's embedded PDB path hint to manual mismatch errors so symbol-selection failures are more actionable.
- Tightened engine and renderer regression coverage around the improved manual PDB failure text.

Validation commands executed:
- `cargo test --manifest-path engine/Cargo.toml`
- `cmd /c npm run check` (in `app`)
- `cmd /c npm run test:renderer -- src/renderer/shell/app.manual-pdb-modal.test.tsx` (in `app`)

Changed files index:
- See `docs/change_files.md` for the detailed file list for this work item.

## 2026-03-10 - Preserve String-Based Backend Error Messages in the Renderer

Summary:
- Added a shared renderer-side error-message extractor so Tauri string rejections are shown verbatim instead of collapsing to generic fallback text.
- Updated the shell and window-chrome error paths to use the shared extractor for module, PDB, graph, xref, address-lookup, and chrome failures.
- Added regression coverage for raw string PDB mismatch failures and the shared extractor helper.

Validation commands executed:
- `cmd /c npm run check` (in `app`)
- `cmd /c npm run test:renderer -- src/renderer/shell/app.manual-pdb-modal.test.tsx src/renderer/lib/utils.test.ts` (in `app`)

Changed files index:
- See `docs/change_files.md` for the detailed file list for this work item.

## 2026-03-10 - Show Module and PDB GUID/Age Values on PDB Mismatch

Summary:
- Expanded manual PDB mismatch errors to include both the module RSDS GUID/age and the selected PDB GUID/age values in the failure details.
- Kept the existing same-build guidance and embedded-path hint while making the mismatch details concrete enough to diagnose version skew directly from the modal.
- Added engine and renderer regression coverage for the new GUID/age detail lines.

Validation commands executed:
- `cargo test --manifest-path engine/Cargo.toml`
- `cmd /c npm run check` (in `app`)
- `cmd /c npm run test:renderer -- src/renderer/shell/app.manual-pdb-modal.test.tsx` (in `app`)

Changed files index:
- See `docs/change_files.md` for the detailed file list for this work item.
