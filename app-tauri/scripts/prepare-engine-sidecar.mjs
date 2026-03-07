import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..", "..");
const sourcePath = path.join(
  repoRoot,
  "engine",
  "target",
  "debug",
  "engine.exe",
);
const targetTriple = process.env.CARGO_BUILD_TARGET ?? detectHostTargetTriple();
const targetDir = path.join(repoRoot, "app-tauri", "src-tauri", "binaries");
const targetPath = path.join(targetDir, `engine-${targetTriple}.exe`);

if (!fs.existsSync(sourcePath)) {
  const buildResult = spawnSync(
    "cargo",
    ["build", "--manifest-path", path.join(repoRoot, "engine", "Cargo.toml")],
    {
      cwd: repoRoot,
      stdio: "inherit",
      shell: process.platform === "win32",
    },
  );

  if (buildResult.status !== 0 || !fs.existsSync(sourcePath)) {
    throw new Error(
      `Engine sidecar is missing at '${sourcePath}' and automatic build failed.`,
    );
  }
}

fs.mkdirSync(targetDir, { recursive: true });
fs.copyFileSync(sourcePath, targetPath);

function detectHostTargetTriple() {
  const platform = os.platform();
  const architecture = os.arch();

  if (platform !== "win32" || architecture !== "x64") {
    throw new Error(
      `Unsupported host for automatic sidecar naming: ${platform}/${architecture}`,
    );
  }

  return "x86_64-pc-windows-msvc";
}
