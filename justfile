set shell := ["powershell", "-NoLogo", "-Command"]

default:
  just --list

setup:
  cd app-electron; npm install

app-build:
  cd app-electron; npm run build

app-dev:
  cd app-electron; npm run dev

app-lint:
  cd app-electron; npm run lint

app-fmt:
  cd app-electron; npm run fmt

app-check:
  cd app-electron; npm run check

app-test:
  cd app-electron; npm run test

engine-build:
  cargo build --manifest-path engine/Cargo.toml

engine-fmt:
  cargo fmt --manifest-path engine/Cargo.toml

engine-fmt-check:
  cargo fmt --manifest-path engine/Cargo.toml -- --check

engine-test:
  cargo test --manifest-path engine/Cargo.toml

build: app-build engine-build

lint: app-lint

fmt: app-fmt engine-fmt

check: app-check engine-fmt-check

test: app-test engine-test
