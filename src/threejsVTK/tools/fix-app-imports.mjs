#!/usr/bin/env node
// tools/fix-app-imports.mjs
//
//   node tools/fix-app-imports.mjs src            # dry-run
//   node tools/fix-app-imports.mjs src --apply
//
// Gom mọi deep import threejsVTK trong code app về barrel duy nhất.
//   import { NAV_STYLE }  from "../threejsVTK/Interaction/InputStyleHandler";
//   import { Renderer }   from "../threejsVTK/Rendering/Renderer";
// ->
//   import { NAV_STYLE, Renderer } from "../threejsVTK";

import { readdirSync, readFileSync, writeFileSync, statSync } from "node:fs";
import { join, extname, relative, dirname, sep } from "node:path";

const ROOT = process.argv[2] ?? "src";
const APPLY = process.argv.includes("--apply");

// KHÔNG đổi tên symbol. File đã đổi tên nhưng class giữ nguyên, và barrel export cả
// hai alias. Đổi tên trong import mà không đổi ở thân file = gãy ngay.
// Symbol KHÔNG CÒN TỒN TẠI -> phải xử lý tay.
const REMOVED = {
    VTKCamera: "đã gộp vào Camera facade. Dùng: import { Camera, applyVTKCameraApi } và gọi applyVTKCameraApi(Camera) một lần.",
    GeometryFilter: "-> SurfaceFilter({ strategy: SURFACE_STRATEGY.TOPOLOGY }) hoặc extractByTopology(geometry, opts)",
    ExternalSurfaceFilter: "-> SurfaceFilter({ strategy: SURFACE_STRATEGY.VISIBILITY }) hoặc extractByVisibility(geometry, opts)",
    extractExternalSurfaceGeometry: "-> extractByTopology(geometry, { keepOuterShell: true })",
};

const walk = (d, out = []) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
        if (e.name === "node_modules" || e.name === "threejsVTK" || e.name.startsWith(".")) continue;
        const p = join(d, e.name);
        if (e.isDirectory()) walk(p, out);
        else if ([".js", ".jsx", ".ts", ".tsx"].includes(extname(p))) out.push(p);
    }
    return out;
};

// "../../threejsVTK/Rendering/Renderer" -> "../../threejsVTK"
const DEEP = /import\s*\{([^}]*)\}\s*from\s*(["'])((?:\.\.?\/)+threejsVTK)\/[^"']+\2\s*;?[ \t]*\r?\n/g;

let touched = 0, warnings = [];

for (const file of walk(ROOT)) {
    const src = readFileSync(file, "utf8");
    const matches = [...src.matchAll(DEEP)];
    if (!matches.length) continue;

    const symbols = new Set();
    const removedHere = [];
    let base = null;

    for (const m of matches) {
        base = m[3];
        for (const raw of m[1].split(",")) {
            let name = raw.trim();
            if (!name) continue;
            const [orig, alias] = name.split(/\s+as\s+/).map((s) => s.trim());

            if (REMOVED[orig]) { removedHere.push(orig); continue; }
            symbols.add(alias ? `${orig} as ${alias}` : orig);
        }
    }

    // Có symbol đã bị xoá -> KHÔNG đụng vào file. Xoá import mà giữ chỗ dùng sẽ biến
    // lỗi build (thấy ngay) thành ReferenceError lúc chạy (khó tìm). Bắt sửa tay.
    if (removedHere.length) {
        for (const r of removedHere) warnings.push(`  ${relative(ROOT, file)}: "${r}" ${REMOVED[r]}`);
        console.log(`  BỎ QUA  ${relative(ROOT, file)}  (dùng ${removedHere.join(", ")} — sửa tay trước)`);
        continue;
    }
    if (!symbols.size) continue;

    // xoá mọi dòng deep import, chèn một dòng barrel ở vị trí dòng đầu tiên
    const first = matches[0].index;
    let out = src;
    for (let i = matches.length - 1; i >= 0; i--) {
        const m = matches[i];
        out = out.slice(0, m.index) + out.slice(m.index + m[0].length);
    }
    const line = `import { ${[...symbols].sort().join(", ")} } from "${base}";\n`;
    out = out.slice(0, first) + line + out.slice(first);

    console.log(`  ${APPLY ? "sửa" : "sẽ sửa"}  ${relative(ROOT, file)}  (${matches.length} import -> 1)`);
    if (APPLY) writeFileSync(file, out);
    touched++;
}

console.log(`\n  ${touched} file${APPLY ? " đã sửa" : " cần sửa (dry-run)"}`);
if (warnings.length) {
    console.log(`\n  ${warnings.length} symbol KHÔNG tự chuyển được — sửa tay:`);
    for (const w of [...new Set(warnings)]) console.log(w);
}
if (!APPLY && touched) console.log("\n  Chạy lại với --apply\n");
