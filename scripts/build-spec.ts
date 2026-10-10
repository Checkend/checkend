// Writes spec/schemas/brief-v1.schema.json from src/core/brief-schema.ts. Run: npm run spec:build
// A test fails when the file and the generator differ.
import { mkdirSync, writeFileSync } from "node:fs";
import { briefJsonSchemaText } from "../src/core/brief-schema.ts";

mkdirSync("spec/schemas", { recursive: true });
writeFileSync("spec/schemas/brief-v1.schema.json", briefJsonSchemaText());
console.log("Wrote spec/schemas/brief-v1.schema.json");
