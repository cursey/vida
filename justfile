set shell := ["powershell", "-NoLogo", "-Command"]

default:
  just --list

setup:
  cd app-tauri; npm install

app-build:
  cd app-tauri; npm run build

app-dev:
  cd app-tauri; npm run dev

app-lint:
  cd app-tauri; npm run lint

app-fmt:
  cd app-tauri; npm run fmt

app-check:
  cd app-tauri; npm run check

app-test:
  cd app-tauri; npm run test

engine-build:
  cargo build --manifest-path engine/Cargo.toml

engine-fmt:
  cargo fmt --manifest-path engine/Cargo.toml

engine-fmt-check:
  cargo fmt --manifest-path engine/Cargo.toml -- --check

engine-test:
  cargo test --manifest-path engine/Cargo.toml

build: engine-build app-build

lint: app-lint

fmt: app-fmt engine-fmt

check: app-check engine-fmt-check

test: app-test engine-test
