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
  const openRequest = {
    jsonrpc: "2.0",
    id: 2,
    method: "module.open",
    params: {
      path: "C:\\tmp\\sample.exe",
    },
  };
  const unloadRequest = {
    jsonrpc: "2.0",
    id: 3,
    method: "module.unload",
    params: {
      moduleId: "m1",
    },
  };
  const analysisStatusRequest = {
    jsonrpc: "2.0",
    id: 4,
    method: "module.getAnalysisStatus",
    params: {
      moduleId: "m1",
    },
  };
  const graphRequest = {
    jsonrpc: "2.0",
    id: 5,
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
    id: 6,
    result: {
      functions: [
        { start: "0x1000", name: "entry", kind: "entry" },
        { start: "0x2000", name: "exported", kind: "export" },
        { start: "0x2800", name: "tls_callback", kind: "tls" },
        { start: "0x3000", name: "exception_0x3000", kind: "exception" },
        { start: "0x4000", name: "module::main", kind: "pdb" },
      ],
    },
  };
  const disassemblyResponse = {
    jsonrpc: "2.0",
    id: 7,
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
    id: 8,
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
  const analysisStatusResponse = {
    jsonrpc: "2.0",
    id: 9,
    result: {
      state: "analyzing_functions",
      message: "Analyzing functions 12 / 48...",
      discoveredFunctionCount: 48,
      totalFunctionCount: 48,
      analyzedFunctionCount: 12,
    },
  };
  const unloadResponse = {
    jsonrpc: "2.0",
    id: 10,
    result: {},
  };

  assert.equal(validate(request), true, JSON.stringify(validate.errors));
  assert.equal(validate(openRequest), true, JSON.stringify(validate.errors));
  assert.equal(validate(unloadRequest), true, JSON.stringify(validate.errors));
  assert.equal(
    validate(analysisStatusRequest),
    true,
    JSON.stringify(validate.errors),
  );
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
  assert.equal(
    validate(analysisStatusResponse),
    true,
    JSON.stringify(validate.errors),
  );
  assert.equal(validate(unloadResponse), true, JSON.stringify(validate.errors));
});
