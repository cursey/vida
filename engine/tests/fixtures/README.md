# Engine Benchmark Fixtures

The benchmark harness uses a hybrid fixture set:

- `minimal_x64.exe` - quick default fixture, runs with the checked-in `fixture_builder.pdb` beside it for symbol-rich analysis coverage.
- `bench_no_pdb/minimal_x64.exe` - generated copy of the same PE placed in a directory without a matching PDB so warm-path comparisons can isolate non-PDB behavior.
- `bench_overlay/minimal_x64_overlay_4mb.exe` - generated copy of the same PE with a deterministic 4 MiB overlay appended to stress cold file-load and parse paths.

Generate the derived fixtures with:

```text
python engine/tests/fixtures/generate_bench_fixtures.py
```

Or use the `just` wrappers:

```text
just engine-bench-prepare-fixtures
just engine-bench-all
```

The generated fixtures are deterministic and can be regenerated at any time from the checked-in source fixture.
