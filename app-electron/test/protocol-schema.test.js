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
  const graphRequest = {
    jsonrpc: "2.0",
    id: 2,
    method: "function.getGraphByVa",
    params: {
      moduleId: "m1",
      va: "0x140001000",
    },
  };

  const response = {
    jsonrpc: "2.0",
    id: 1,
    result: {
      version: "0.1.0",
    },
  };

  const functionListResponse = {
    jsonrpc: "2.0",
    id: 2,
    result: {
      functions: [
        { start: "0x1000", name: "entry", kind: "entry" },
        { start: "0x2000", name: "exported", kind: "export" },
        { start: "0x3000", name: "exception_0x3000", kind: "exception" },
        { start: "0x4000", name: "module::main", kind: "pdb" },
      ],
    },
  };
  const disassemblyResponse = {
    jsonrpc: "2.0",
    id: 3,
    result: {
      instructions: [
        {
          address: "0x1000",
          bytes: "55",
          mnemonic: "push",
          operands: "rbp",
          instructionCategory: "stack",
        },
      ],
      stopReason: "ret",
    },
  };
  const graphResponse = {
    jsonrpc: "2.0",
    id: 4,
    result: {
      functionStartVa: "0x140001000",
      functionName: "sub_140001000",
      focusBlockId: "b_1000",
      blocks: [
        {
          id: "b_1000",
          startVa: "0x140001000",
          instructions: [
            {
              mnemonic: "push",
              operands: "rbp",
              instructionCategory: "stack",
            },
          ],
        },
      ],
      edges: [],
    },
  };

  assert.equal(validate(request), true, JSON.stringify(validate.errors));
  assert.equal(validate(graphRequest), true, JSON.stringify(validate.errors));
  assert.equal(validate(response), true, JSON.stringify(validate.errors));
  assert.equal(
    validate(functionListResponse),
    true,
    JSON.stringify(validate.errors),
  );
  assert.equal(
    validate(disassemblyResponse),
    true,
    JSON.stringify(validate.errors),
  );
  assert.equal(validate(graphResponse), true, JSON.stringify(validate.errors));
});
