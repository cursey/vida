# AGENTS.md

## Purpose
This repository is for a minimal IDA-like Electron disassembler:
- Electron UI (TypeScript/JavaScript) for navigation, disassembly views, and CFG visualization.
- Rust analysis engine for PE parsing, disassembly, CFG, and xrefs.

Scope reference: `docs/electron_disassembler_project_scope.md`.

## Current State
No implementation code exists yet. This file defines the baseline standards that all future contributions must follow.

## Planned Repository Layout
- `app-electron/` - Electron UI, renderer, graph UI
- `engine/` - Rust analysis service
- `shared/` - shared message contracts/schemas
- `docs/` - architecture and algorithm notes

## Command Runner Policy
Use `just` and a root `justfile` as the primary command interface.

Rules:
- Do not rely on `package.json` scripts as the main workflow surface.
- Add or update `justfile` recipes for common tasks (build, test, lint, format, run).
- Keep command names stable and task-oriented (for example: `just test`, `just lint`, `just fmt`, `just dev`).

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

## Security Baseline
When handling unknown binaries:
- Never execute loaded binaries.
- Keep parsing/disassembly in the Rust analysis process.
- Electron defaults should remain hardened (`contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`).

## MVP Direction
Build in milestone order from the scope doc:
1. Loader + linear disassembly
2. Basic blocks + CFG
3. Cross references

Keep implementation minimal and incremental. Prefer correctness and clear interfaces over premature optimization.
