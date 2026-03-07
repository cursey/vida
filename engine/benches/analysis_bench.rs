use std::thread::sleep;
use std::time::Duration;

use criterion::{Criterion, black_box, criterion_group, criterion_main};

use engine::api::{
    FunctionGraphByVaParams, LinearDisassemblyParams, LinearFindRowByVaParams, LinearRowsParams,
    ModuleAnalysisStatusParams, ModuleOpenParams,
};
use engine::{EngineState, fixture_path};

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

fn bench_module_open_and_analyze(c: &mut Criterion) {
    let fixture_path = fixture_path("minimal_x64.exe");
    let fixture = fixture_path.to_string_lossy().into_owned();

    c.bench_function("engine/module_open_and_analyze/minimal_x64", |bench| {
        bench.iter(|| {
            let mut state = EngineState::default();

            let open_result = state
                .open_module(ModuleOpenParams {
                    path: black_box(fixture.clone()),
                })
                .expect("module should open");

            wait_for_analysis_ready(&mut state, &open_result.module_id);
        })
    });
}

fn bench_linear_rows_fetch(c: &mut Criterion) {
    let fixture_path = fixture_path("minimal_x64.exe");
    let fixture = fixture_path.to_string_lossy().into_owned();

    let mut state = EngineState::default();
    let open_result = state
        .open_module(ModuleOpenParams { path: fixture })
        .expect("module should open");
    let module_id = open_result.module_id;
    let start_va = open_result.entry_va;
    wait_for_analysis_ready(&mut state, &module_id);

    let start_row = state
        .find_linear_row_by_va(LinearFindRowByVaParams {
            module_id: module_id.clone(),
            va: start_va,
        })
        .expect("entry VA row should be found");

    c.bench_function("engine/linear_rows/minimal_x64", |bench| {
        bench.iter(|| {
            let rows = state.get_linear_rows(LinearRowsParams {
                module_id: module_id.clone(),
                start_row: start_row.row_index,
                row_count: 128,
            });

            black_box(rows.expect("linear rows should load").rows.len())
        })
    });
}

fn bench_function_graph_by_va(c: &mut Criterion) {
    let fixture_path = fixture_path("minimal_x64.exe");
    let fixture = fixture_path.to_string_lossy().into_owned();

    let mut state = EngineState::default();
    let open_result = state
        .open_module(ModuleOpenParams { path: fixture })
        .expect("module should open");
    let module_id = open_result.module_id;
    let entry_va = open_result.entry_va;
    wait_for_analysis_ready(&mut state, &module_id);

    let params = FunctionGraphByVaParams {
        module_id: module_id.clone(),
        va: entry_va,
    };

    c.bench_function("engine/function_graph_by_va/minimal_x64", |bench| {
        bench.iter(|| {
            let graph = state
                .get_function_graph_by_va(black_box(params.clone()))
                .expect("graph should be available");

            black_box(graph.blocks.len())
        })
    });
}

fn bench_linear_disassembly(c: &mut Criterion) {
    let fixture_path = fixture_path("minimal_x64.exe");
    let fixture = fixture_path.to_string_lossy().into_owned();

    let mut state = EngineState::default();
    let open_result = state
        .open_module(ModuleOpenParams { path: fixture })
        .expect("module should open");
    let module_id = open_result.module_id;
    let entry_va = open_result.entry_va;
    wait_for_analysis_ready(&mut state, &module_id);

    let params = LinearDisassemblyParams {
        module_id: module_id.clone(),
        start: entry_va,
        max_instructions: Some(128),
    };

    c.bench_function("engine/linear_disassembly/minimal_x64", |bench| {
        bench.iter(|| {
            let rows = state
                .disassemble_linear(black_box(params.clone()))
                .expect("function should disassemble");

            black_box(rows.instructions.len())
        })
    });
}

criterion_group!(
    analysis_benches,
    bench_module_open_and_analyze,
    bench_linear_rows_fetch,
    bench_function_graph_by_va,
    bench_linear_disassembly
);
criterion_main!(analysis_benches);
