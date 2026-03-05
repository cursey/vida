# Change Files

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

