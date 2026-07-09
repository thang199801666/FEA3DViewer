#!/usr/bin/env node
// tools/verify-imports.mjs
// Kiểm tra MỌI import tương đối trong src/ trỏ tới file có thật, và mọi symbol
// được import có được export ở đích. Không chạy trình duyệt, nhưng bắt được
// toàn bộ import gãy — loại lỗi phổ biến nhất sau khi đổi cấu trúc thư mục.
import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import { join, dirname, relative, extname, resolve } from "node:path";

const ROOT = process.argv[2] ?? "src";
const walk = (d, out = []) => {
  for (const e of readdirSync(d, { withFileTypes: true })) {
    const p = join(d, e.name);
    e.isDirectory() ? walk(p, out) : extname(p) === ".js" && out.push(p);
  }
  return out;
};

const files = walk(ROOT);
const exportsOf = new Map();
const namedExport = /export\s+(?:async\s+)?(?:class|function|const|let|var)\s+([A-Za-z_$][\w$]*)/g;
const braceExport = /export\s*\{([^}]*)\}/g;

for (const f of files) {
  const src = readFileSync(f, "utf8");
  const set = new Set();
  for (const m of src.matchAll(namedExport)) set.add(m[1]);
  for (const m of src.matchAll(braceExport))
    for (const part of m[1].split(",")) {
      const t = part.trim().split(/\s+as\s+/).pop()?.trim();
      if (t) set.add(t);
    }
  if (/export\s+default/.test(src)) set.add("default");
  if (/export\s*\*\s*from/.test(src)) set.add("*");
  exportsOf.set(resolve(f), set);
}

const IMPORT = /import\s+(?:([\w$*{][^;]*?)\s+from\s+)?(["'])([^"']+)\2/g;
// re-export có 'from' cũng phải kiểm tra: barrel là nơi lỗi tên symbol hay nằm nhất
const REEXPORT = /export\s+(\{[^}]*\}|\*)\s+from\s+(["'])([^"']+)\2/g;
let missingFile = 0, missingSym = 0, empty = 0;

for (const f of files) {
  const src = readFileSync(f, "utf8");
  if (statSync(f).size === 0) { console.log(`  RỖNG   ${relative(ROOT, f)}  (0 byte)`); empty++; }

  const stmts = [...src.matchAll(IMPORT), ...src.matchAll(REEXPORT)];
  for (const m of stmts) {
    const [, clause, , spec] = m;
    if (!spec.startsWith(".")) continue;
    const target = resolve(dirname(f), spec);
    if (!existsSync(target)) { console.log(`  GÃY    ${relative(ROOT, f)}  ->  ${spec}`); missingFile++; continue; }
    if (statSync(target).size === 0) { console.log(`  RỖNG   ${relative(ROOT, f)}  ->  ${spec}  (đích 0 byte)`); continue; }
    if (!clause) continue;
    const braces = clause.match(/\{([^}]*)\}/);
    if (!braces) continue;
    const have = exportsOf.get(target) ?? new Set();
    if (have.has("*")) continue;
    for (const part of braces[1].split(",")) {
      const name = part.trim().split(/\s+as\s+/)[0]?.trim();
      if (!name || name === "type") continue;
      if (!have.has(name)) { console.log(`  SYMBOL ${relative(ROOT, f)}  ->  ${spec}  không export "${name}"`); missingSym++; }
    }
  }
}
console.log(`\n  ${files.length} file · ${missingFile} import gãy · ${missingSym} symbol thiếu · ${empty} file rỗng`);
process.exit(missingFile + missingSym ? 1 : 0);
