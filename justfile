set shell := ["powershell", "-NoLogo", "-Command"]

default:
  just --list

setup:
  cd app; npm install

app-build:
  cd app; npm run build

app-build-release:
  cd app; npx tauri build

app-build-portable:
  cd app; npx tauri build --no-bundle
  python -c "import json, shutil, zipfile; from pathlib import Path; repo = Path.cwd().resolve(); conf = json.loads((repo / 'app' / 'src-tauri' / 'tauri.conf.json').read_text(encoding='utf-8')); product_name = conf['productName']; version = conf['version']; bundle_dir = repo / 'app' / 'src-tauri' / 'target' / 'release' / 'bundle' / 'portable'; staging_dir = bundle_dir / product_name; zip_path = bundle_dir / f'{product_name}_{version}_x64_portable.zip'; exe_source = repo / 'app' / 'src-tauri' / 'target' / 'release' / 'app.exe'; exe_target = staging_dir / f'{product_name}.exe'; shutil.rmtree(bundle_dir, ignore_errors=True); staging_dir.mkdir(parents=True, exist_ok=True); shutil.copy2(exe_source, exe_target); shutil.copy2(repo / 'LICENSE', staging_dir / 'LICENSE'); archive = zipfile.ZipFile(zip_path, 'w', compression=zipfile.ZIP_DEFLATED); [archive.write(path, path.relative_to(bundle_dir)) for path in staging_dir.rglob('*')]; archive.close(); print(zip_path)"

app-dev:
  cd app; npm run dev

app-lint:
  cd app; npm run lint

app-fmt:
  cd app; npm run fmt

app-check:
  cd app; npm run check

app-test:
  cd app; npm run test

clean:
  if (Test-Path "app/dist") { Remove-Item -Recurse -Force "app/dist" }
  if (Test-Path "app/src-tauri/target") { Remove-Item -Recurse -Force "app/src-tauri/target" }
  if (Test-Path "engine/target") { Remove-Item -Recurse -Force "engine/target" }

engine-build:
  cargo build --manifest-path engine/Cargo.toml

engine-fmt:
  cargo fmt --manifest-path engine/Cargo.toml

engine-fmt-check:
  cargo fmt --manifest-path engine/Cargo.toml -- --check

engine-test:
  cargo test --manifest-path engine/Cargo.toml

engine-bench:
  cargo bench --manifest-path engine/Cargo.toml --bench analysis_bench

bench: engine-bench

build: engine-build app-build

build-release: app-build-release
build-portable: app-build-portable

lint: app-lint

fmt: app-fmt engine-fmt

check: app-check engine-fmt-check

test: app-test engine-test
