#!/usr/bin/env node
// tools/verify-deps.mjs — mọi bare import trong src/ phải được khai báo trong package.json.
// Bắt đúng lớp lỗi "Failed to resolve import" của Vite trước khi nó xảy ra.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, extname } from "node:path";

const walk = (d, out = []) => {
  for (const e of readdirSync(d, { withFileTypes: true })) {
    const p = join(d, e.name);
    e.isDirectory() ? walk(p, out) : extname(p) === ".js" && out.push(p);
  }
  return out;
};
const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const declared = new Set([
  ...Object.keys(pkg.dependencies ?? {}),
  ...Object.keys(pkg.peerDependencies ?? {}),
  ...Object.keys(pkg.optionalDependencies ?? {}),
]);

const found = new Map();   // pkgName -> [file...]
for (const f of walk("src")) {
  for (const m of readFileSync(f, "utf8").matchAll(/from\s+["']([^."'][^"']*)["']/g)) {
    const spec = m[1];
    const name = spec.startsWith("@") ? spec.split("/").slice(0, 2).join("/") : spec.split("/")[0];
    if (!found.has(name)) found.set(name, []);
    found.get(name).push(f);
  }
}

let missing = 0;
for (const [name, files] of [...found].sort()) {
  const ok = declared.has(name);
  if (!ok) missing++;
  console.log(`  ${ok ? "ok    " : "THIẾU "} ${name.padEnd(16)} (${files.length} import)`);
}
// optionalDependencies mà lại bị import TĨNH => sai phân loại
for (const name of Object.keys(pkg.optionalDependencies ?? {})) {
  if (found.has(name)) {
    console.log(`  CẢNH BÁO ${name} khai optional nhưng bị import TĨNH -> luôn trong graph`);
    missing++;
  }
}
console.log(`\n  ${found.size} package · ${missing} vấn đề\n`);
process.exit(missing ? 1 : 0);
