# AGENTS.md

## Purpose
This repository is for a minimal IDA-like desktop disassembler:
- Tauri UI (TypeScript/JavaScript + Rust host) for navigation, disassembly views, and CFG visualization.
- Rust analysis engine for PE parsing, disassembly, CFG, and xrefs.

Scope reference: `docs/electron_disassembler_project_scope.md`.

## Current State
The repository currently contains:
- A Tauri 2 desktop shell with a React/Vite renderer and Rust host integration.
- A Rust engine crate used directly by the Tauri host, with typed library APIs and MVP disassembly/CFG flows.

## Planned Repository Layout
- `app/` - Tauri UI, renderer, graph UI, and host shell
- `engine/` - Rust analysis library
- `docs/` - architecture and algorithm notes

## Change Tracking
- For every substantial implementation, append an entry to `docs/work_log.md`.
- Keep `docs/change_files.md` updated with the files changed by each logged work item.
- Work log entries must include: date, summary, and validation commands executed.
- Change file entries should be grouped by subsystem (`app`, `engine`, `docs`, root).
- For any performance-related engine changes, append a benchmark update in `docs/engine_benchmarking.md` using the project template:
  - Record command, baseline/current/Delta per benchmark, and the specific code changes that drove the delta.
  - Include enough evidence to reproduce the comparison later (ideally same benchmark command and baseline workflow).
- New benchmark entries should remain consistent with the corresponding `docs/work_log.md` and `docs/change_files.md` entries.

## Architecture Defaults (Current)
- Renderer stack: React + Vite + TypeScript.
- Engine integration: direct in-process Rust library calls from the Tauri host.
- Engine lifecycle: one shared `EngineState` instance owned by the app session.
- MVP1 binary scope: PE32+ x64 only.
- Type source of truth: public Rust engine API plus handwritten TypeScript renderer contracts in `app`.

## Command Runner Policy
Use `just` and a root `justfile` as the primary command interface.

Rules:
- Do not rely on `package.json` scripts as the main workflow surface.
- Add or update `justfile` recipes for common tasks (build, test, lint, format, run).
- Keep command names stable and task-oriented (for example: `just test`, `just lint`, `just fmt`, `just dev`).

## Commit Message Policy
Use imperative, specific commit subjects that match repository history style.

Required:
- Commit subject should start with a strong verb in Title Case (for example: `Implement ...`, `Refine ...`, `Replace ...`, `Fix ...`).
- Describe the concrete change scope, not a vague shorthand (avoid subjects like `updates`, `misc`, `wip`, or `branch links`).
- Keep subject line concise and focused on the primary change.

## JavaScript/TypeScript Standards
All JavaScript/TypeScript code must be formatted and linted with Biome.

Required:
- Formatting via Biome.
- Linting via Biome.
- `justfile` recipes must expose these checks (for example `just fmt`, `just lint`, `just check`).
- CI should fail on formatting/lint violations.

## Rust Standards
All Rust code must be formatted with `rustfmt`.

Required:
- Run `rustfmt` via `cargo fmt` for the engine crate.
- `just fmt` must include Rust formatting.
- `just check` must include a `rustfmt` check mode (for example `cargo fmt -- --check`).
- CI should fail if Rust formatting checks fail.

## Testing Policy
Tests are required for all production code additions.

Baseline expectations:
- New features must include automated tests.
- Bug fixes should include regression tests when practical.
- `just test` must run the project test suites.
- Keep tests close to the code they validate and make them deterministic.
- Prefer shared UI primitives for standard buttons and inputs, but do not force highly custom interactive visualization controls through generic wrappers when that breaks semantics, behavior, or styling.
- When a raw control is the correct abstraction for a custom renderer element, document that exception clearly in the relevant test or guidance instead of reshaping the component to satisfy an overly broad rule.

## Security Baseline
When handling unknown binaries:
- Never execute loaded binaries.
- Keep parsing/disassembly in the Rust analysis process.
- Tauri permissions and capabilities should stay minimal, with renderer access constrained to the audited host commands required by the app.

## MVP Direction
Build in milestone order from the scope doc:
1. Loader + linear disassembly
2. Basic blocks + CFG
3. Cross references

Keep implementation minimal and incremental. Prefer correctness and clear interfaces over premature optimization.
