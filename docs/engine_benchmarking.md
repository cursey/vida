# Engine Benchmarking

This document tracks how to measure engine performance and records the latest known results after optimization work.

## Scope

- Measure the Rust engine performance at the API surface used by the Tauri host and renderer.
- Keep one authoritative history of benchmark methodology and observed gains.
- Capture both the benchmark command run and the code changes that drove any speed changes.

## Benchmark Harness

- Criterion benchmark target: `engine/benches/analysis_bench.rs`
- Active benchmarks today:
  - `engine/module_open_and_analyze/minimal_x64`
  - `engine/linear_rows/minimal_x64`
- Fixture: `engine/tests/fixtures/minimal_x64.exe`

## Commands

- Run engine benchmark suite: `just engine-bench`
- Alias for same suite: `just bench`
- Legacy direct command:
  - `cargo bench --manifest-path engine/Cargo.toml --bench analysis_bench`

## A/B comparison procedure (recommended)

Use this when validating a set of performance-oriented edits.

1. Save in-progress edits:
   - `git stash push -u -m "Temporary baseline for benchmark"`
2. Run baseline on clean tree:
   - `just engine-bench`
3. Restore edits:
   - `git stash pop`
4. Re-run benchmark to compare against baseline:
   - `just engine-bench`
5. Log the baseline and current run in the results history below.

Recommended when collecting outputs:
- Keep machine warm for consistency (no background compile-heavy work).
- Prefer running from a clean terminal session.
- Treat single-run deltas under a few percent as noise unless repeated consistently.

## Current benchmark state

### Results history

When performance gains are observed, append a new row under this section:

- Date
- Command used
- Baseline vs current values for each relevant bench
- The code changes that caused the change
- Any caveats (CPU load, debug/release profile, warm cache effects)

### Result update template

Use this template each time the benchmark doc is updated after new performance work:

```text
Date: <YYYY-MM-DD>
Command: just engine-bench
Machine/Profile: <machine details + release/debug>

Bench: <engine/bench_name>
Baseline: <value> (previous baseline)
Current: <value> (post-change)
Delta: <+/- percentage>
Change driver: <file/function/patch summary>
Evidence: <raw notes or commit IDs>
Notes: <warm-cache, contention, sample drift>
```

When gains span multiple benches, repeat the `Bench/...` block for each benchmark.

### Example filled entry

```text
Date: 2026-03-07
Command: just engine-bench
Machine/Profile: Windows 11, release profile

Bench: engine/module_open_and_analyze/minimal_x64
Baseline: ~99.56 ms
Current: ~76.54 ms
Delta: ~-23%
Change driver: `engine/src/analysis.rs` (claim-pass allocation reductions), `engine/src/linear.rs` (linear-row formatting cleanup)
Evidence: stash baseline -> restore edits -> re-run `just engine-bench`
Notes: single-run noise existed in micro-bench windows; ran with warm cache

Bench: engine/linear_rows/minimal_x64
Baseline: ~33.74 µs
Current: ~26.03 µs
Delta: ~-23%
Change driver: `engine/src/linear.rs` (row materialization removed temporary per-row `Vec<String>` allocations)
Evidence: stash baseline -> restore edits -> re-run `just engine-bench`
Notes: additional reruns converged around the ~24-27 µs range
```

| Date | Bench | Baseline | Current | Delta | Change driver | Evidence |
| --- | --- | --- | --- | --- | --- | --- |
| 2026-03-07 | `engine/module_open_and_analyze/minimal_x64` | ~99.56 ms | ~76.54 ms | ~-23% | `engine/src/analysis.rs` (analysis claim pass allocation reductions), `engine/src/linear.rs` (linear row formatting path cleanup) | stash baseline → optimized |
| 2026-03-07 | `engine/linear_rows/minimal_x64` | ~33.74 µs | ~26.03 µs | ~-23% | `engine/src/linear.rs` (row materialization no longer builds temporary row vectors) | stash baseline → optimized |

### Most recent checkpoint

- After the current optimized state stabilized, single-sequence reruns are typically:
  - `engine/module_open_and_analyze/minimal_x64`: ~70.8 ms to ~76.8 ms (run-to-run fluctuation)
  - `engine/linear_rows/minimal_x64`: ~24.2 µs to ~26.9 µs (within noise)
- Use the A/B workflow above for future committed optimization sets.

## Maintenance rule

- Every time a meaningful performance gain is merged, append/update the **Results history** table in this file with the exact command output and root-cause summary.
- Keep `docs/work_log.md` in sync with the change and benchmark update entry.
