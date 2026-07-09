import { execFileSync } from "node:child_process";
import { readdirSync } from "node:fs";
const files = readdirSync("tests").filter(f => f.endsWith(".test.mjs")).sort();
let failed = 0;
for (const f of files) {
  try { process.stdout.write(execFileSync("node", [`tests/${f}`], { encoding: "utf8" })); }
  catch (e) { process.stdout.write(e.stdout ?? ""); failed++; }
}
console.log(failed ? `\n${failed} suite(s) FAILED\n` : `\nTất cả ${files.length} suite đều xanh\n`);
process.exit(failed ? 1 : 0);
