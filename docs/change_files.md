# Change Files

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
