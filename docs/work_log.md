# Work Log

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
