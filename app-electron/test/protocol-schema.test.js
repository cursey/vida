const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Ajv2020 = require("ajv/dist/2020");

const schemaPath = path.resolve(
  __dirname,
  "../../shared/schemas/protocol.schema.json",
);
const schema = JSON.parse(fs.readFileSync(schemaPath, "utf8"));

const ajv = new Ajv2020({ strict: false, allErrors: true });
const validate = ajv.compile(schema);

test("protocol request and response examples validate", () => {
  const request = {
    jsonrpc: "2.0",
    id: 1,
    method: "engine.ping",
    params: {},
  };

  const response = {
    jsonrpc: "2.0",
    id: 1,
    result: {
      version: "0.1.0",
    },
  };

  assert.equal(validate(request), true, JSON.stringify(validate.errors));
  assert.equal(validate(response), true, JSON.stringify(validate.errors));
});
