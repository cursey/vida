const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

function collectTsxFiles(rootDir) {
  const entries = fs.readdirSync(rootDir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectTsxFiles(fullPath));
      continue;
    }
    if (entry.isFile() && fullPath.endsWith(".tsx")) {
      files.push(fullPath);
    }
  }
  return files;
}

function lineNumbers(content, pattern) {
  const lines = content.split(/\r?\n/);
  const numbers = [];
  for (let index = 0; index < lines.length; index += 1) {
    if (pattern.test(lines[index])) {
      numbers.push(index + 1);
    }
  }
  return numbers;
}

const RAW_CONTROL_ALLOWLIST = new Set([
  "features\\disassembly\\memory-overview-bar.tsx",
  // Graph operand overlays are canvas-positioned hotspots; the shared Button
  // primitive cannot express that layout without breaking hit-testing/alignment.
  "features\\graph\\graph-panel.tsx",
]);

test("renderer feature components do not use raw button/input elements", () => {
  const rendererRoot = path.resolve(__dirname, "../src/renderer");
  const uiRoot = path.resolve(rendererRoot, "components/ui");
  const files = collectTsxFiles(rendererRoot).filter(
    (filePath) => !filePath.startsWith(uiRoot),
  );

  const violations = [];
  for (const filePath of files) {
    const relativePath = path.relative(rendererRoot, filePath);
    if (RAW_CONTROL_ALLOWLIST.has(relativePath)) {
      continue;
    }

    const content = fs.readFileSync(filePath, "utf8");
    const buttonLines = lineNumbers(content, /<\s*button\b/);
    const inputLines = lineNumbers(content, /<\s*input\b/);
    if (buttonLines.length > 0 || inputLines.length > 0) {
      violations.push({
        file: relativePath,
        buttonLines,
        inputLines,
      });
    }
  }

  assert.deepEqual(
    violations,
    [],
    `Raw controls must be wrapped by shared UI primitives. Violations: ${JSON.stringify(
      violations,
    )}`,
  );
});
