import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { compile } from "json-schema-to-typescript";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const schemaPath = path.resolve(
  __dirname,
  "../../shared/schemas/protocol.schema.json",
);
const outputPath = path.resolve(__dirname, "../src/shared/protocol.gen.ts");

async function main() {
  const schemaRaw = await readFile(schemaPath, "utf8");
  const schema = JSON.parse(schemaRaw);
  const ts = await compile(schema, "DisassemblerProtocol", {
    bannerComment:
      "/* This file is auto-generated from shared/schemas/protocol.schema.json. */",
    additionalProperties: false,
    style: {
      singleQuote: false,
    },
    cwd: path.resolve(__dirname, ".."),
  });

  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, ts, "utf8");
}

main().catch((error) => {
  console.error("Failed to generate protocol types", error);
  process.exitCode = 1;
});
