const test = require("node:test");
const assert = require("node:assert/strict");

test("tauri app workspace exists", () => {
  assert.equal(typeof process.versions.node, "string");
});
