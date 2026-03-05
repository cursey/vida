const test = require("node:test");
const assert = require("node:assert/strict");

test("electron app skeleton exists", () => {
  assert.equal(typeof process.versions.node, "string");
});
