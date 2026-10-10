// Writes skills/checkend/SKILL.md from src/core/agent-docs.ts. Run: npm run skill:build
// A test fails when the file and the generator differ.
import { writeFileSync } from "node:fs";
import { skillFile } from "../src/core/agent-docs.ts";

writeFileSync("skills/checkend/SKILL.md", skillFile("https://<your-checkend>"));
console.log("Wrote skills/checkend/SKILL.md");
