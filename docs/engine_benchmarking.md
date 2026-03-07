# Engine Benchmarking

This document defines the engine benchmarking workflow, fixture sets, and result-recording format.

## Goals

- Measure the Rust engine at the public API surface used by the desktop shell.
- Keep a fast local benchmark path for day-to-day regression checks.
- Keep a higher-signal comparison path for optimization work and historical reporting.
- Store enough run metadata to reproduce a recorded result later.

## Harness

- Criterion benchmark target: `engine/benches/analysis_bench.rs`
- Coverage groups:
  - `engine/cold/module_open_and_analyze/*`
  - `engine/warm/module_info/*`
  - `engine/warm/function_list/*`
  - `engine/warm/linear_view_info/*`
  - `engine/warm/find_linear_row_by_va/*`
  - `engine/warm/linear_rows/*`
  - `engine/warm/function_graph_by_va/*`
  - `engine/warm/linear_disassembly/*`
- Raw Criterion artifacts: `engine/target/criterion/`

Cold benches measure module open plus background analysis completion. Warm benches measure API calls against an already-ready module state.

## Fixture Sets

### Quick default

- Fixture set: `quick`
- Fixture: `engine/tests/fixtures/minimal_x64.exe`
- Notes: runs beside the checked-in `engine/tests/fixtures/fixture_builder.pdb`, so the default path still exercises symbol-rich analysis.

### Full comparison set

- Fixture set: `all`
- Fixtures:
  - `engine/tests/fixtures/minimal_x64.exe`
  - `engine/tests/fixtures/bench_no_pdb/minimal_x64.exe`
  - `engine/tests/fixtures/bench_overlay/minimal_x64_overlay_4mb.exe`
- Generated fixture helper: `engine/tests/fixtures/generate_bench_fixtures.py`
- Fixture notes:
  - `bench_no_pdb/...` isolates the same PE in a directory without a matching PDB.
  - `bench_overlay/...` appends a deterministic 4 MiB overlay to stress cold file-load and parse paths.
  - Overlay fixtures are intentionally excluded from warm benches because the mapped image is otherwise identical.

See `engine/tests/fixtures/README.md` for fixture details.

## Commands

- Quick default run: `just engine-bench`
- Explicit quick run: `just engine-bench-quick`
- Generate derived fixtures: `just engine-bench-prepare-fixtures`
- Full comparison run: `just engine-bench-all`
- Quick filtered run: `just engine-bench-filter engine/warm/function_list`
- Full filtered run: `just engine-bench-filter-all engine/cold/module_open_and_analyze`
- Save a quick baseline: `just engine-bench-save local-baseline`
- Save a full baseline: `just engine-bench-save local-baseline all`
- Compare to a quick baseline: `just engine-bench-compare local-baseline`
- Compare to a full baseline: `just engine-bench-compare local-baseline all`
- Direct Criterion command:
  - quick: `cargo bench --manifest-path engine/Cargo.toml --bench analysis_bench`
  - full (PowerShell): `$env:ENGINE_BENCH_FIXTURE_SET='all'; cargo bench --manifest-path engine/Cargo.toml --bench analysis_bench`

## Recommended Workflow

### Fast local check

Use this when iterating on changes and you want a quick signal:

1. Run `just engine-bench`
2. If a specific API regresses, narrow it with `just engine-bench-filter <pattern>`
3. Treat sub-single-digit deltas in very small warm benches as potential noise until repeated

### Higher-signal comparison

Use this for optimization work, benchmark notes, and work-log entries:

1. Capture a baseline:
   - `just engine-bench-save <baseline-name> all`
2. Make the code change
3. Compare against the saved baseline:
   - `just engine-bench-compare <baseline-name> all`
4. Record the result using the template below
5. Keep `docs/work_log.md` and `docs/change_files.md` in sync with the benchmark update

## Result Recording Template

Use this format whenever benchmark results are recorded after performance work:

```text
Date: <YYYY-MM-DD>
Commit: <git commit or workspace note>
Command: <exact just/cargo command>
Fixture Set: <quick|all>
Machine/Profile: <CPU/OS + release/debug>
Criterion Artifacts: engine/target/criterion/<path>

Bench: <engine/...>
Baseline: <value>
Current: <value>
Delta: <+/- percentage>
Change driver: <file/function/patch summary>
Evidence: <baseline name, raw artifact path, rerun note>
Notes: <noise, cache state, caveats>
```

Repeat the `Bench:` block for each benchmark you are reporting.

## Recording Rules

- Prefer saved Criterion baselines over manual stash/pop transcription.
- Record exact commands, fixture set, and artifact location, not just rounded headline values.
- Note whether the result came from the quick path or the full comparison path.
- Treat very small warm benches as latency indicators, not absolute truth, unless reruns converge.
- When performance changes are meaningful, update `docs/work_log.md`, `docs/change_files.md`, and this file together.

## Historical Measurements

The repository's current recorded optimization checkpoints are:

| Date | Fixture Set | Bench | Baseline | Current | Delta | Change driver |
| --- | --- | --- | --- | --- | --- | --- |
| 2026-03-07 | quick | `engine/cold/module_open_and_analyze/minimal_with_pdb` | ~99.56 ms | ~76.54 ms | ~-23% | `engine/src/analysis.rs`, `engine/src/linear.rs` |
| 2026-03-07 | quick | `engine/warm/linear_rows/minimal_with_pdb` | ~33.74 us | ~26.03 us | ~-23% | `engine/src/linear.rs` |
| 2026-03-07 | quick | `engine/cold/module_open_and_analyze/minimal_with_pdb` | ~76.54 ms | ~70.27 ms | ~-8.2% | `engine/src/analysis.rs`, `engine/src/state.rs` |
| 2026-03-07 | quick | `engine/warm/linear_rows/minimal_with_pdb` | ~26.41 us | ~24.63 us | ~-6.8% | `engine/src/analysis.rs` |
| 2026-03-07 | quick | `engine/warm/function_graph_by_va/minimal_with_pdb` | ~8.97 us | ~9.00 us | ~+0.3% | `engine/src/state.rs` |
| 2026-03-07 | quick | `engine/warm/linear_disassembly/minimal_with_pdb` | ~0.800 us | ~0.791 us | ~-1.1% | `engine/src/analysis.rs`, `engine/src/state.rs` |

## Saved Baseline Checkpoints

### 2026-03-07 - `hybrid-full-2026-03-07`

- Commit: workspace state before the benchmark-system commit for the hybrid workflow rollout
- Command: `just engine-bench-save hybrid-full-2026-03-07 all`
- Fixture Set: `all`
- Machine/Profile: Windows, Criterion release bench profile
- Criterion Artifacts: `engine/target/criterion/engine_*/<fixture>/hybrid-full-2026-03-07/`
- Notes: overlay fixture is cold-only by design; warm micro-bench numbers should still be treated as noise-sensitive latency indicators

| Bench | Fixture | Current | Artifact Root |
| --- | --- | --- | --- |
| `engine/cold/module_open_and_analyze` | `minimal_with_pdb` | `[70.520 ms, 71.511 ms, 72.486 ms]` | `engine/target/criterion/engine_cold_module_open_and_analyze/minimal_with_pdb/hybrid-full-2026-03-07/` |
| `engine/cold/module_open_and_analyze` | `minimal_without_pdb` | `[71.520 ms, 72.184 ms, 72.905 ms]` | `engine/target/criterion/engine_cold_module_open_and_analyze/minimal_without_pdb/hybrid-full-2026-03-07/` |
| `engine/cold/module_open_and_analyze` | `overlay_4mb_without_pdb` | `[71.890 ms, 72.634 ms, 73.469 ms]` | `engine/target/criterion/engine_cold_module_open_and_analyze/overlay_4mb_without_pdb/hybrid-full-2026-03-07/` |
| `engine/warm/module_info` | `minimal_with_pdb` | `[13.951 us, 14.022 us, 14.098 us]` | `engine/target/criterion/engine_warm_module_info/minimal_with_pdb/hybrid-full-2026-03-07/` |
| `engine/warm/module_info` | `minimal_without_pdb` | `[13.937 us, 14.005 us, 14.076 us]` | `engine/target/criterion/engine_warm_module_info/minimal_without_pdb/hybrid-full-2026-03-07/` |
| `engine/warm/function_list` | `minimal_with_pdb` | `[38.115 us, 38.228 us, 38.373 us]` | `engine/target/criterion/engine_warm_function_list/minimal_with_pdb/hybrid-full-2026-03-07/` |
| `engine/warm/function_list` | `minimal_without_pdb` | `[31.264 us, 31.359 us, 31.461 us]` | `engine/target/criterion/engine_warm_function_list/minimal_without_pdb/hybrid-full-2026-03-07/` |
| `engine/warm/linear_view_info` | `minimal_with_pdb` | `[178.17 ns, 181.27 ns, 184.10 ns]` | `engine/target/criterion/engine_warm_linear_view_info/minimal_with_pdb/hybrid-full-2026-03-07/` |
| `engine/warm/linear_view_info` | `minimal_without_pdb` | `[173.43 ns, 174.79 ns, 176.35 ns]` | `engine/target/criterion/engine_warm_linear_view_info/minimal_without_pdb/hybrid-full-2026-03-07/` |
| `engine/warm/find_linear_row_by_va` | `minimal_with_pdb` | `[106.40 ns, 107.26 ns, 108.85 ns]` | `engine/target/criterion/engine_warm_find_linear_row_by_va/minimal_with_pdb/hybrid-full-2026-03-07/` |
| `engine/warm/find_linear_row_by_va` | `minimal_without_pdb` | `[106.43 ns, 106.74 ns, 107.07 ns]` | `engine/target/criterion/engine_warm_find_linear_row_by_va/minimal_without_pdb/hybrid-full-2026-03-07/` |
| `engine/warm/linear_rows` | `minimal_with_pdb` | `[26.086 us, 26.241 us, 26.403 us]` | `engine/target/criterion/engine_warm_linear_rows/minimal_with_pdb/hybrid-full-2026-03-07/` |
| `engine/warm/linear_rows` | `minimal_without_pdb` | `[26.396 us, 26.552 us, 26.770 us]` | `engine/target/criterion/engine_warm_linear_rows/minimal_without_pdb/hybrid-full-2026-03-07/` |
| `engine/warm/function_graph_by_va` | `minimal_with_pdb` | `[9.2074 us, 9.2482 us, 9.2859 us]` | `engine/target/criterion/engine_warm_function_graph_by_va/minimal_with_pdb/hybrid-full-2026-03-07/` |
| `engine/warm/function_graph_by_va` | `minimal_without_pdb` | `[9.3307 us, 9.4318 us, 9.5678 us]` | `engine/target/criterion/engine_warm_function_graph_by_va/minimal_without_pdb/hybrid-full-2026-03-07/` |
| `engine/warm/linear_disassembly` | `minimal_with_pdb` | `[845.32 ns, 849.79 ns, 854.57 ns]` | `engine/target/criterion/engine_warm_linear_disassembly/minimal_with_pdb/hybrid-full-2026-03-07/` |
| `engine/warm/linear_disassembly` | `minimal_without_pdb` | `[855.07 ns, 863.54 ns, 874.38 ns]` | `engine/target/criterion/engine_warm_linear_disassembly/minimal_without_pdb/hybrid-full-2026-03-07/` |
