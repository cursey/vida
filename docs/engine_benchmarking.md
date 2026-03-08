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
  - `engine/warm/module_memory_overview/*`
  - `engine/warm/linear_view_info/*`
  - `engine/warm/find_linear_row_by_va/*`
  - `engine/warm/linear_rows/*`
  - `engine/warm/function_graph_by_va/*`
  - `engine/warm/linear_disassembly/*`
  - `engine/warm/xrefs_to_va/*`
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
| 2026-03-08 | quick | `engine/cold/module_open_and_analyze/minimal_with_pdb` | `[70.520 ms, 71.511 ms, 72.486 ms]` | `[20.874 ms, 23.165 ms, 26.187 ms]` | `[-70.663%, -68.523%, -65.805%]` | `engine/src/analysis.rs`, `engine/src/cfg.rs`, `engine/src/disasm.rs`, `engine/src/linear.rs`, `engine/src/state.rs` |
| 2026-03-08 | quick | `engine/warm/linear_rows/minimal_with_pdb` | `[26.086 us, 26.241 us, 26.403 us]` | `[70.039 us, 71.349 us, 72.709 us]` | `[+164.93%, +171.42%, +178.68%]` | `engine/src/disasm.rs`, `engine/src/linear.rs`, `engine/src/state.rs` |
| 2026-03-08 | quick | `engine/warm/function_graph_by_va/minimal_with_pdb` | `[9.2074 us, 9.2482 us, 9.2859 us]` | `[33.520 us, 33.558 us, 33.600 us]` | `[+259.71%, +262.26%, +264.76%]` | `engine/src/disasm.rs`, `engine/src/state.rs` |
| 2026-03-08 | quick | `engine/warm/module_memory_overview/minimal_with_pdb` | ~39.36 us | ~105.09 ns | ~-99.7% | `engine/src/api.rs`, `engine/src/state.rs`, `app/src/renderer/features/disassembly/memory-overview-bar.tsx` |
| 2026-03-08 | quick | `engine/warm/xrefs_to_va/minimal_with_pdb` | n/a (new benchmark) | ~664.52 ns | n/a | `engine/src/cfg.rs`, `engine/src/analysis.rs`, `engine/src/state.rs`, `engine/benches/analysis_bench.rs` |
| 2026-03-08 | quick | `engine/cold/module_open_and_analyze/minimal_with_pdb` | ~36.75 ms | ~34.48 ms | no significant change | `engine/src/state.rs` |
| 2026-03-07 | all | `engine/cold/module_open_and_analyze/minimal_with_pdb` | ~77.51 ms | ~30.90 ms | ~-60.6% | `engine/src/analysis.rs` |
| 2026-03-07 | all | `engine/cold/module_open_and_analyze/minimal_without_pdb` | ~75.86 ms | ~30.19 ms | ~-60.1% | `engine/src/analysis.rs` |
| 2026-03-07 | all | `engine/cold/module_open_and_analyze/overlay_4mb_without_pdb` | ~76.39 ms | ~31.89 ms | ~-58.0% | `engine/src/analysis.rs` |
| 2026-03-08 | quick | `engine/warm/module_memory_overview/minimal_with_pdb` | ~469.65 us | ~30.75 us | ~-93.6% | `engine/src/state.rs`, `app/src/renderer/App.tsx` |
| 2026-03-07 | quick | `engine/cold/module_open_and_analyze/minimal_with_pdb` | ~99.56 ms | ~76.54 ms | ~-23% | `engine/src/analysis.rs`, `engine/src/linear.rs` |
| 2026-03-07 | quick | `engine/warm/linear_rows/minimal_with_pdb` | ~33.74 us | ~26.03 us | ~-23% | `engine/src/linear.rs` |
| 2026-03-07 | quick | `engine/cold/module_open_and_analyze/minimal_with_pdb` | ~76.54 ms | ~70.27 ms | ~-8.2% | `engine/src/analysis.rs`, `engine/src/state.rs` |
| 2026-03-07 | quick | `engine/warm/linear_rows/minimal_with_pdb` | ~26.41 us | ~24.63 us | ~-6.8% | `engine/src/analysis.rs` |
| 2026-03-07 | quick | `engine/warm/function_graph_by_va/minimal_with_pdb` | ~8.97 us | ~9.00 us | ~+0.3% | `engine/src/state.rs` |
| 2026-03-07 | quick | `engine/warm/linear_disassembly/minimal_with_pdb` | ~0.800 us | ~0.791 us | ~-1.1% | `engine/src/analysis.rs`, `engine/src/state.rs` |

## 2026-03-07 - Parallelize Per-Function Engine Analysis

Date: 2026-03-07
Commit: workspace state after implementing ordered parallel per-function analysis
Command: `just engine-bench-compare parallel-analysis-baseline-2026-03-07 all`
Fixture Set: `all`
Machine/Profile: Windows, Criterion release bench profile
Criterion Artifacts: `engine/target/criterion/engine_*/<fixture>/{parallel-analysis-baseline-2026-03-07,new,change}/`

Bench: `engine/cold/module_open_and_analyze/minimal_with_pdb`
Baseline: `[76.526 ms, 77.505 ms, 78.638 ms]`
Current: `[30.432 ms, 30.901 ms, 31.442 ms]`
Delta: `[-61.559%, -60.631%, -59.729%]`
Change driver: bounded worker-pool CFG/disassembly execution plus canonical single-thread merge in `engine/src/analysis.rs`
Evidence: `parallel-analysis-baseline-2026-03-07`; `engine/target/criterion/engine_cold_module_open_and_analyze/minimal_with_pdb/parallel-analysis-baseline-2026-03-07/`; `engine/target/criterion/engine_cold_module_open_and_analyze/minimal_with_pdb/new/`; `engine/target/criterion/engine_cold_module_open_and_analyze/minimal_with_pdb/change/`
Notes: cold analysis throughput is the target metric for this change; repeated integration runs kept function lists, graphs, and linear view metadata stable

Bench: `engine/cold/module_open_and_analyze/minimal_without_pdb`
Baseline: `[74.987 ms, 75.859 ms, 76.807 ms]`
Current: `[29.720 ms, 30.186 ms, 30.593 ms]`
Delta: `[-61.010%, -60.081%, -59.241%]`
Change driver: bounded worker-pool CFG/disassembly execution plus canonical single-thread merge in `engine/src/analysis.rs`
Evidence: `parallel-analysis-baseline-2026-03-07`; `engine/target/criterion/engine_cold_module_open_and_analyze/minimal_without_pdb/parallel-analysis-baseline-2026-03-07/`; `engine/target/criterion/engine_cold_module_open_and_analyze/minimal_without_pdb/new/`; `engine/target/criterion/engine_cold_module_open_and_analyze/minimal_without_pdb/change/`
Notes: no-PDB fixture keeps the same cold-path speedup pattern, which suggests the win comes from parallel CFG/disassembly work instead of symbol loading changes

Bench: `engine/cold/module_open_and_analyze/overlay_4mb_without_pdb`
Baseline: `[75.607 ms, 76.391 ms, 77.234 ms]`
Current: `[31.459 ms, 31.887 ms, 32.274 ms]`
Delta: `[-58.936%, -57.979%, -56.778%]`
Change driver: bounded worker-pool CFG/disassembly execution plus canonical single-thread merge in `engine/src/analysis.rs`
Evidence: `parallel-analysis-baseline-2026-03-07`; `engine/target/criterion/engine_cold_module_open_and_analyze/overlay_4mb_without_pdb/parallel-analysis-baseline-2026-03-07/`; `engine/target/criterion/engine_cold_module_open_and_analyze/overlay_4mb_without_pdb/new/`; `engine/target/criterion/engine_cold_module_open_and_analyze/overlay_4mb_without_pdb/change/`
Notes: the same compare run also showed warm micro-bench drift on unaffected APIs (`engine/warm/module_info/*`, `engine/warm/function_list/*`, `engine/warm/linear_disassembly/*`), so those should be treated as follow-up profiling signals rather than hidden by the cold-path win

## 2026-03-08 - Simplify Memory Overview Into Fixed Slices

Date: 2026-03-08
Commands:
- `cargo bench --manifest-path engine/Cargo.toml --bench analysis_bench -- engine/warm/module_memory_overview --baseline memory-overview-slices-baseline-2026-03-08`
- `cargo bench --manifest-path engine/Cargo.toml --bench analysis_bench -- engine/cold/module_open_and_analyze/minimal_with_pdb --baseline memory-overview-slices-baseline-2026-03-08`
Fixture Set: `quick`
Machine/Profile: Windows, Criterion release bench profile
Criterion Artifacts:
- `engine/target/criterion/engine_warm_module_memory_overview/minimal_with_pdb/{memory-overview-slices-baseline-2026-03-08,new,change}/`
- `engine/target/criterion/engine_cold_module_open_and_analyze/minimal_with_pdb/{memory-overview-slices-baseline-2026-03-08,new,change}/`

Bench: `engine/warm/module_memory_overview/minimal_with_pdb`
Baseline: `[37.405 us, 39.356 us, 40.660 us]`
Current: `[104.57 ns, 105.09 ns, 105.44 ns]`
Delta: `[-99.723%, -99.710%, -99.697%]`
Change driver: replaced exact memory-overview regions with a cached 1000-slice dominant-kind summary in `engine/src/state.rs`, then simplified the bar renderer to consume slice kinds directly in `app/src/renderer/features/disassembly/memory-overview-bar.tsx`
Evidence: `memory-overview-slices-baseline-2026-03-08`; `engine/target/criterion/engine_warm_module_memory_overview/minimal_with_pdb/memory-overview-slices-baseline-2026-03-08/`; `engine/target/criterion/engine_warm_module_memory_overview/minimal_with_pdb/new/`; `engine/target/criterion/engine_warm_module_memory_overview/minimal_with_pdb/change/`
Notes: the steady-state memory-bar API now clones only the overall VA span and a compact slice-kind array instead of many per-region hex strings

Bench: `engine/cold/module_open_and_analyze/minimal_with_pdb`
Baseline: `[33.981 ms, 36.752 ms, 40.136 ms]`
Current: `[33.883 ms, 34.484 ms, 34.887 ms]`
Delta: `[-10.893%, -4.5638%, +1.5501%]`
Change driver: same slice-summary change in `engine/src/state.rs`
Evidence: `memory-overview-slices-baseline-2026-03-08`; `engine/target/criterion/engine_cold_module_open_and_analyze/minimal_with_pdb/memory-overview-slices-baseline-2026-03-08/`; `engine/target/criterion/engine_cold_module_open_and_analyze/minimal_with_pdb/new/`; `engine/target/criterion/engine_cold_module_open_and_analyze/minimal_with_pdb/change/`
Notes: Criterion reported no statistically significant cold-path change, which keeps the overview simplification effectively free during module open

## 2026-03-08 - Cache Ready Memory Overview and Prioritize Ready Paint

Date: 2026-03-08
Commit: workspace state after caching ready memory-overview results and deferring ready-side browser/bar loads until after disassembly initialization
Command: `cargo bench --manifest-path engine/Cargo.toml --bench analysis_bench -- engine/warm/module_memory_overview --baseline memory-overview-baseline-2026-03-08-v2`
Fixture Set: `quick`
Machine/Profile: Windows, Criterion release bench profile
Criterion Artifacts: `engine/target/criterion/engine_warm_module_memory_overview/minimal_with_pdb/{memory-overview-baseline-2026-03-08-v2,new,change}/`

Bench: `engine/warm/module_memory_overview/minimal_with_pdb`
Baseline: `[468.54 us, 469.65 us, 470.60 us]`
Current: `[30.500 us, 30.749 us, 30.962 us]`
Delta: `[-93.652%, -93.583%, -93.514%]`
Change driver: cached base/ready overview snapshots plus linear-sweep discovered coverage in `engine/src/state.rs`, alongside renderer deferral of ready-side browser/bar requests in `app/src/renderer/App.tsx`
Evidence: `memory-overview-baseline-2026-03-08-v2`; `engine/target/criterion/engine_warm_module_memory_overview/minimal_with_pdb/memory-overview-baseline-2026-03-08-v2/`; `engine/target/criterion/engine_warm_module_memory_overview/minimal_with_pdb/new/`; `engine/target/criterion/engine_warm_module_memory_overview/minimal_with_pdb/change/`
Notes: this benchmark isolates the memory-bar API cost; the renderer change separately prevents the initial ready disassembly paint from queuing behind the function-list and memory-overview requests

## 2026-03-08 - Add Engine Xref Indexing and Query Benchmark

Date: 2026-03-08
Commit: workspace state after adding engine xref indexing and VA query support
Commands:
- `cargo bench --manifest-path engine/Cargo.toml --bench analysis_bench -- engine/warm/xrefs_to_va`
- `cargo bench --manifest-path engine/Cargo.toml --bench analysis_bench -- engine/cold/module_open_and_analyze/minimal_with_pdb --baseline hybrid-full-2026-03-07`
Fixture Set: `quick`
Machine/Profile: Windows, Criterion release bench profile
Criterion Artifacts:
- `engine/target/criterion/engine_warm_xrefs_to_va/minimal_with_pdb/`
- `engine/target/criterion/engine_cold_module_open_and_analyze/minimal_with_pdb/{hybrid-full-2026-03-07,new,change}/`

Bench: `engine/warm/xrefs_to_va/minimal_with_pdb`
Baseline: `n/a (new benchmark)`
Current: `[655.95 ns, 664.52 ns, 670.18 ns]`
Delta: `n/a (new benchmark)`
Change driver: direct call/jump/branch plus RIP-relative data xref extraction in `engine/src/cfg.rs`, canonical incoming xref indexing in `engine/src/analysis.rs`, and warm VA lookup materialization in `engine/src/state.rs`
Evidence: `engine/target/criterion/engine_warm_xrefs_to_va/minimal_with_pdb/new/`; `engine/target/criterion/engine_warm_xrefs_to_va/minimal_with_pdb/report/`
Notes: warm xref lookup uses an analysis-ready module and reports the cost to materialize the inbound xref list for a stable function VA with at least one inbound reference

Bench: `engine/cold/module_open_and_analyze/minimal_with_pdb`
Baseline: `[70.520 ms, 71.511 ms, 72.486 ms]`
Current: `[36.993 ms, 37.485 ms, 38.038 ms]`
Delta: `[-49.064%, -48.174%, -47.184%]`
Change driver: same xref indexing work above, measured against the saved `hybrid-full-2026-03-07` baseline to keep cold analysis benchmarkable after the new indexing pass
Evidence: `hybrid-full-2026-03-07`; `engine/target/criterion/engine_cold_module_open_and_analyze/minimal_with_pdb/hybrid-full-2026-03-07/`; `engine/target/criterion/engine_cold_module_open_and_analyze/minimal_with_pdb/new/`; `engine/target/criterion/engine_cold_module_open_and_analyze/minimal_with_pdb/change/`
Notes: this comparison is against an older saved baseline that predates several unrelated engine improvements, so it mainly confirms the cold path remains comfortably benchmarkable after adding xref indexing rather than isolating the xref pass alone

## 2026-03-08 - Optimize Engine Analysis with Lazy Instruction Rendering

Date: 2026-03-08
Commit: workspace state after moving instruction presentation formatting to shared lazy-render helpers while keeping analysis caches compact.
Commands:
- `cargo bench --manifest-path engine/Cargo.toml --bench analysis_bench -- engine/cold/module_open_and_analyze/minimal_with_pdb --baseline hybrid-full-2026-03-07`
- `cargo bench --manifest-path engine/Cargo.toml --bench analysis_bench -- engine/warm/linear_rows/minimal_with_pdb --baseline hybrid-full-2026-03-07`
- `cargo bench --manifest-path engine/Cargo.toml --bench analysis_bench -- engine/warm/function_graph_by_va/minimal_with_pdb --baseline hybrid-full-2026-03-07`
Fixture Set: `quick`
Machine/Profile: Windows, Criterion release bench profile
Criterion Artifacts:
- `engine/target/criterion/engine_cold_module_open_and_analyze/minimal_with_pdb/{hybrid-full-2026-03-07,new,change}/`
- `engine/target/criterion/engine_warm_linear_rows/minimal_with_pdb/{hybrid-full-2026-03-07,new,change}/`
- `engine/target/criterion/engine_warm_function_graph_by_va/minimal_with_pdb/{hybrid-full-2026-03-07,new,change}/`

Bench: `engine/cold/module_open_and_analyze/minimal_with_pdb`
Baseline: `[70.520 ms, 71.511 ms, 72.486 ms]`
Current: `[20.874 ms, 23.165 ms, 26.187 ms]`
Delta: `[-70.663%, -68.523%, -65.805%]`
Change driver: removed eager per-instruction byte/mnemonic/operand rendering from `engine/src/analysis.rs` and `engine/src/cfg.rs`, then reconstructed presentation text on demand via shared helpers in `engine/src/disasm.rs`, `engine/src/linear.rs`, and `engine/src/state.rs`
Evidence: `engine/target/criterion/engine_cold_module_open_and_analyze/minimal_with_pdb/hybrid-full-2026-03-07/`; `engine/target/criterion/engine_cold_module_open_and_analyze/minimal_with_pdb/new/`; `engine/target/criterion/engine_cold_module_open_and_analyze/minimal_with_pdb/change/`
Notes: cold analysis remains substantially faster than the saved pre-lazy-render baseline because the analysis pass now stores compact instruction metadata instead of eagerly formatted presentation strings

Bench: `engine/warm/linear_rows/minimal_with_pdb`
Baseline: `[26.086 us, 26.241 us, 26.403 us]`
Current: `[70.039 us, 71.349 us, 72.709 us]`
Delta: `[+164.93%, +171.42%, +178.68%]`
Change driver: `engine/src/linear.rs` now formats instruction bytes and text lazily through the shared renderer when rows are materialized
Evidence: `engine/target/criterion/engine_warm_linear_rows/minimal_with_pdb/hybrid-full-2026-03-07/`; `engine/target/criterion/engine_warm_linear_rows/minimal_with_pdb/new/`; `engine/target/criterion/engine_warm_linear_rows/minimal_with_pdb/change/`
Notes: warm linear-row fetches are slower because formatting work moved from analysis time to view time, but the absolute cost remains on the order of tens of microseconds

Bench: `engine/warm/function_graph_by_va/minimal_with_pdb`
Baseline: `[9.2074 us, 9.2482 us, 9.2859 us]`
Current: `[33.520 us, 33.558 us, 33.600 us]`
Delta: `[+259.71%, +262.26%, +264.76%]`
Change driver: `engine/src/state.rs` now reconstructs graph instruction mnemonics and operands on demand via the shared lazy renderer, while skipping unused byte rendering for graph blocks
Evidence: `engine/target/criterion/engine_warm_function_graph_by_va/minimal_with_pdb/hybrid-full-2026-03-07/`; `engine/target/criterion/engine_warm_function_graph_by_va/minimal_with_pdb/new/`; `engine/target/criterion/engine_warm_function_graph_by_va/minimal_with_pdb/change/`
Notes: graph materialization shows the same intentional warm-path tradeoff as linear rows, but avoiding unused byte formatting cuts a large share of the intermediate regression while keeping formatting consistency covered by engine integration tests

## Saved Baseline Checkpoints

### 2026-03-08 - `memory-overview-slices-baseline-2026-03-08`

- Commands:
  - `cargo bench --manifest-path engine/Cargo.toml --bench analysis_bench -- engine/warm/module_memory_overview --save-baseline memory-overview-slices-baseline-2026-03-08`
  - `cargo bench --manifest-path engine/Cargo.toml --bench analysis_bench -- engine/cold/module_open_and_analyze/minimal_with_pdb --save-baseline memory-overview-slices-baseline-2026-03-08`
- Fixture Set: `quick`
- Machine/Profile: Windows, Criterion release bench profile
- Criterion Artifacts:
  - `engine/target/criterion/engine_warm_module_memory_overview/minimal_with_pdb/memory-overview-slices-baseline-2026-03-08/`
  - `engine/target/criterion/engine_cold_module_open_and_analyze/minimal_with_pdb/memory-overview-slices-baseline-2026-03-08/`
- Notes: captured immediately before replacing the exact region payload with the fixed-size slice summary

### 2026-03-08 - `memory-overview-baseline-2026-03-08-v2`

- Commit: workspace state before caching the ready memory-overview result and before deferring ready-side supplemental renderer requests
- Command: `cargo bench --manifest-path engine/Cargo.toml --bench analysis_bench -- engine/warm/module_memory_overview --save-baseline memory-overview-baseline-2026-03-08-v2`
- Fixture Set: `quick`
- Machine/Profile: Windows, Criterion release bench profile
- Criterion Artifacts: `engine/target/criterion/engine_warm_module_memory_overview/minimal_with_pdb/memory-overview-baseline-2026-03-08-v2/`
- Notes: captured immediately before removing the post-ready memory-overview rebuild from the user-visible path

### 2026-03-07 - `parallel-analysis-baseline-2026-03-07`

- Commit: workspace state before parallelizing per-function analysis
- Command: `just engine-bench-save parallel-analysis-baseline-2026-03-07 all`
- Fixture Set: `all`
- Machine/Profile: Windows, Criterion release bench profile
- Criterion Artifacts: `engine/target/criterion/engine_*/<fixture>/parallel-analysis-baseline-2026-03-07/`
- Notes: captured immediately before replacing the serial function-analysis loop with the ordered parallel worker-pool path

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

