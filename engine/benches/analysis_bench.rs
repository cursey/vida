use std::env;
use std::thread::sleep;
use std::time::Duration;

use criterion::{BenchmarkId, Criterion, black_box, criterion_group, criterion_main};

use engine::api::{
    FunctionGraphByVaParams, FunctionListParams, LinearDisassemblyParams, LinearFindRowByVaParams,
    LinearRowsParams, LinearViewInfoParams, ModuleAnalysisStatusParams, ModuleInfoParams,
    ModuleMemoryOverviewParams, ModuleOpenParams,
};
use engine::{EngineState, fixture_path};

const BENCH_FIXTURE_SET_ENV: &str = "ENGINE_BENCH_FIXTURE_SET";
const FIXTURE_SET_QUICK: &str = "quick";
const FIXTURE_SET_ALL: &str = "all";

#[derive(Clone, Copy)]
struct BenchFixture {
    label: &'static str,
    relative_path: &'static str,
    supports_warm_benches: bool,
}

impl BenchFixture {
    const fn new(
        label: &'static str,
        relative_path: &'static str,
        supports_warm_benches: bool,
    ) -> Self {
        Self {
            label,
            relative_path,
            supports_warm_benches,
        }
    }

    fn resolved_path(self) -> String {
        let path = fixture_path(self.relative_path);
        assert!(
            path.is_file(),
            "Benchmark fixture missing: {} (run `just engine-bench-prepare-fixtures` for generated fixtures)",
            path.display()
        );
        path.to_string_lossy().into_owned()
    }
}

const QUICK_FIXTURES: &[BenchFixture] = &[BenchFixture::new(
    "minimal_with_pdb",
    "minimal_x64.exe",
    true,
)];

const ALL_FIXTURES: &[BenchFixture] = &[
    BenchFixture::new("minimal_with_pdb", "minimal_x64.exe", true),
    BenchFixture::new("minimal_without_pdb", "bench_no_pdb/minimal_x64.exe", true),
    BenchFixture::new(
        "overlay_4mb_without_pdb",
        "bench_overlay/minimal_x64_overlay_4mb.exe",
        false,
    ),
];

struct ReadyFixtureContext {
    state: EngineState,
    module_id: String,
    entry_va: String,
    start_row: u64,
}

fn benchmark_config() -> Criterion {
    Criterion::default()
        .sample_size(30)
        .warm_up_time(Duration::from_secs(1))
        .measurement_time(Duration::from_secs(4))
        .configure_from_args()
}

fn selected_fixtures() -> &'static [BenchFixture] {
    match env::var(BENCH_FIXTURE_SET_ENV).ok().as_deref() {
        Some(FIXTURE_SET_ALL) => ALL_FIXTURES,
        Some(FIXTURE_SET_QUICK) | None => QUICK_FIXTURES,
        Some(other) => panic!(
            "Unsupported {BENCH_FIXTURE_SET_ENV} value `{other}`; expected `{FIXTURE_SET_QUICK}` or `{FIXTURE_SET_ALL}`"
        ),
    }
}

fn wait_for_analysis_ready(state: &mut EngineState, module_id: &str) {
    for _ in 0..400 {
        let status = state
            .get_module_analysis_status(ModuleAnalysisStatusParams {
                module_id: module_id.to_owned(),
            })
            .expect("analysis status should be readable");

        if status.state == "ready" {
            return;
        }
        if status.state == "failed" {
            panic!("analysis failed: {}", status.message);
        }
        if status.state == "canceled" {
            panic!("analysis canceled");
        }
        sleep(Duration::from_millis(5));
    }

    panic!("analysis did not complete within timeout");
}

fn open_ready_fixture(fixture: BenchFixture) -> ReadyFixtureContext {
    let path = fixture.resolved_path();

    let mut state = EngineState::default();
    let open_result = state
        .open_module(ModuleOpenParams { path })
        .expect("module should open");
    let module_id = open_result.module_id;
    let entry_va = open_result.entry_va;

    wait_for_analysis_ready(&mut state, &module_id);

    let start_row = state
        .find_linear_row_by_va(LinearFindRowByVaParams {
            module_id: module_id.clone(),
            va: entry_va.clone(),
        })
        .expect("entry VA row should be found")
        .row_index;

    ReadyFixtureContext {
        state,
        module_id,
        entry_va,
        start_row,
    }
}

fn bench_module_open_and_analyze(c: &mut Criterion) {
    let mut group = c.benchmark_group("engine/cold/module_open_and_analyze");
    group.sample_size(20);
    group.measurement_time(Duration::from_secs(6));

    for fixture in selected_fixtures() {
        let path = fixture.resolved_path();
        group.bench_with_input(
            BenchmarkId::from_parameter(fixture.label),
            &path,
            |bench, path| {
                bench.iter(|| {
                    let mut state = EngineState::default();

                    let open_result = state
                        .open_module(ModuleOpenParams {
                            path: black_box(path.clone()),
                        })
                        .expect("module should open");

                    wait_for_analysis_ready(&mut state, &open_result.module_id);
                    black_box(open_result.entry_va.len())
                })
            },
        );
    }

    group.finish();
}

fn bench_module_info(c: &mut Criterion) {
    let mut group = c.benchmark_group("engine/warm/module_info");

    for fixture in selected_fixtures()
        .iter()
        .copied()
        .filter(|fixture| fixture.supports_warm_benches)
    {
        let mut context = open_ready_fixture(fixture);
        let params = ModuleInfoParams {
            module_id: context.module_id.clone(),
        };

        group.bench_with_input(
            BenchmarkId::from_parameter(fixture.label),
            &fixture.label,
            |bench, _| {
                bench.iter(|| {
                    let info = context
                        .state
                        .get_module_info(black_box(params.clone()))
                        .expect("module info should load");

                    black_box((info.sections.len(), info.imports.len(), info.exports.len()))
                })
            },
        );
    }

    group.finish();
}

fn bench_function_list(c: &mut Criterion) {
    let mut group = c.benchmark_group("engine/warm/function_list");

    for fixture in selected_fixtures()
        .iter()
        .copied()
        .filter(|fixture| fixture.supports_warm_benches)
    {
        let mut context = open_ready_fixture(fixture);
        let params = FunctionListParams {
            module_id: context.module_id.clone(),
        };

        group.bench_with_input(
            BenchmarkId::from_parameter(fixture.label),
            &fixture.label,
            |bench, _| {
                bench.iter(|| {
                    let functions = context
                        .state
                        .list_functions(black_box(params.clone()))
                        .expect("function list should load");

                    black_box(functions.functions.len())
                })
            },
        );
    }

    group.finish();
}

fn bench_module_memory_overview(c: &mut Criterion) {
    let mut group = c.benchmark_group("engine/warm/module_memory_overview");

    for fixture in selected_fixtures()
        .iter()
        .copied()
        .filter(|fixture| fixture.supports_warm_benches)
    {
        let mut context = open_ready_fixture(fixture);
        let params = ModuleMemoryOverviewParams {
            module_id: context.module_id.clone(),
        };

        group.bench_with_input(
            BenchmarkId::from_parameter(fixture.label),
            &fixture.label,
            |bench, _| {
                bench.iter(|| {
                    let overview = context
                        .state
                        .get_module_memory_overview(black_box(params.clone()))
                        .expect("memory overview should load");

                    black_box(overview.regions.len())
                })
            },
        );
    }

    group.finish();
}

fn bench_linear_view_info(c: &mut Criterion) {
    let mut group = c.benchmark_group("engine/warm/linear_view_info");

    for fixture in selected_fixtures()
        .iter()
        .copied()
        .filter(|fixture| fixture.supports_warm_benches)
    {
        let mut context = open_ready_fixture(fixture);
        let params = LinearViewInfoParams {
            module_id: context.module_id.clone(),
        };

        group.bench_with_input(
            BenchmarkId::from_parameter(fixture.label),
            &fixture.label,
            |bench, _| {
                bench.iter(|| {
                    let info = context
                        .state
                        .get_linear_view_info(black_box(params.clone()))
                        .expect("linear view info should load");

                    black_box((info.row_count, info.row_height, info.data_group_size))
                })
            },
        );
    }

    group.finish();
}

fn bench_find_linear_row_by_va(c: &mut Criterion) {
    let mut group = c.benchmark_group("engine/warm/find_linear_row_by_va");

    for fixture in selected_fixtures()
        .iter()
        .copied()
        .filter(|fixture| fixture.supports_warm_benches)
    {
        let mut context = open_ready_fixture(fixture);
        let params = LinearFindRowByVaParams {
            module_id: context.module_id.clone(),
            va: context.entry_va.clone(),
        };

        group.bench_with_input(
            BenchmarkId::from_parameter(fixture.label),
            &fixture.label,
            |bench, _| {
                bench.iter(|| {
                    let row = context
                        .state
                        .find_linear_row_by_va(black_box(params.clone()))
                        .expect("row lookup should load");

                    black_box(row.row_index)
                })
            },
        );
    }

    group.finish();
}

fn bench_linear_rows_fetch(c: &mut Criterion) {
    let mut group = c.benchmark_group("engine/warm/linear_rows");

    for fixture in selected_fixtures()
        .iter()
        .copied()
        .filter(|fixture| fixture.supports_warm_benches)
    {
        let mut context = open_ready_fixture(fixture);
        let params = LinearRowsParams {
            module_id: context.module_id.clone(),
            start_row: context.start_row,
            row_count: 128,
        };

        group.bench_with_input(
            BenchmarkId::from_parameter(fixture.label),
            &fixture.label,
            |bench, _| {
                bench.iter(|| {
                    let rows = context
                        .state
                        .get_linear_rows(black_box(params.clone()))
                        .expect("linear rows should load");

                    black_box(rows.rows.len())
                })
            },
        );
    }

    group.finish();
}

fn bench_function_graph_by_va(c: &mut Criterion) {
    let mut group = c.benchmark_group("engine/warm/function_graph_by_va");

    for fixture in selected_fixtures()
        .iter()
        .copied()
        .filter(|fixture| fixture.supports_warm_benches)
    {
        let mut context = open_ready_fixture(fixture);
        let params = FunctionGraphByVaParams {
            module_id: context.module_id.clone(),
            va: context.entry_va.clone(),
        };

        group.bench_with_input(
            BenchmarkId::from_parameter(fixture.label),
            &fixture.label,
            |bench, _| {
                bench.iter(|| {
                    let graph = context
                        .state
                        .get_function_graph_by_va(black_box(params.clone()))
                        .expect("graph should be available");

                    black_box((graph.blocks.len(), graph.edges.len()))
                })
            },
        );
    }

    group.finish();
}

fn bench_linear_disassembly(c: &mut Criterion) {
    let mut group = c.benchmark_group("engine/warm/linear_disassembly");

    for fixture in selected_fixtures()
        .iter()
        .copied()
        .filter(|fixture| fixture.supports_warm_benches)
    {
        let mut context = open_ready_fixture(fixture);
        let params = LinearDisassemblyParams {
            module_id: context.module_id.clone(),
            start: context.entry_va.clone(),
            max_instructions: Some(128),
        };

        group.bench_with_input(
            BenchmarkId::from_parameter(fixture.label),
            &fixture.label,
            |bench, _| {
                bench.iter(|| {
                    let rows = context
                        .state
                        .disassemble_linear(black_box(params.clone()))
                        .expect("function should disassemble");

                    black_box(rows.instructions.len())
                })
            },
        );
    }

    group.finish();
}

criterion_group! {
    name = analysis_benches;
    config = benchmark_config();
    targets =
        bench_module_open_and_analyze,
        bench_module_info,
        bench_function_list,
        bench_module_memory_overview,
        bench_linear_view_info,
        bench_find_linear_row_by_va,
        bench_linear_rows_fetch,
        bench_function_graph_by_va,
        bench_linear_disassembly
}
criterion_main!(analysis_benches);
