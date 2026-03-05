# Work Log

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
