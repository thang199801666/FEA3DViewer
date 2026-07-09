#!/usr/bin/env node
// tools/migrate.mjs
// Codemod cho Phase 0 + Phase 1: di chuyển file, viết lại import path, xoá file đã gộp.
//
//   node tools/migrate.mjs --root ./threejsVTK           # dry-run, chỉ in ra
//   node tools/migrate.mjs --root ./threejsVTK --apply   # thực thi
//
// LÀM TRƯỚC:  git commit sạch, và chạy `git add --renormalize .` sau khi thêm
//             .gitattributes (một commit RIÊNG) để CRLF/LF không làm nhiễu diff.

import { readdirSync, readFileSync, writeFileSync, mkdirSync, renameSync, rmSync, existsSync } from "node:fs";
import { join, dirname, relative, extname } from "node:path";

const args = process.argv.slice(2);
const ROOT = args[args.indexOf("--root") + 1] ?? ".";
const APPLY = args.includes("--apply");

// ── Bảng di chuyển: đường dẫn cũ -> mới ────────────────────────────────────
const MOVES = {
    "Core/DataObject.js": "core/DataObject.js",
    "Core/DataSet.js": "core/DataSet.js",
    "Core/FieldData.js": "core/FieldData.js",
    "Core/PolyData.js": "core/PolyData.js",
    "Core/UnstructuredGrid.js": "core/UnstructuredGrid.js",
    "Core/CellTypes.js": "core/CellTypes.js",
    "Core/Conversion.js": "core/conversion.js",

    "IO/VTKReader.js": "io/VTKReader.js",
    "IO/VTKLegacyReader.js": "io/VTKLegacyReader.js",
    "IO/VTPReader.js": "io/VTPReader.js",

    "Filters/Filter.js": "filters/Filter.js",
    "Filters/ContourFilter.js": "filters/ContourFilter.js",
    "Filters/ClipFilter.js": "filters/ClipFilter.js",
    "Filters/ClipClosedSurfaceFilter.js": "filters/ClipClosedSurfaceFilter.js",
    "Filters/CutterFilter.js": "filters/CutterFilter.js",
    "Filters/DataSetSurfaceFilter.js": "filters/DataSetSurfaceFilter.js",
    "Filters/SmoothFilter.js": "filters/SmoothFilter.js",
    "Filters/WarpFilter.js": "filters/WarpFilter.js",
    "Filters/FeatureEdges.js": "geometry/featureEdges.js",

    "Mappers/LookupTable.js": "color/LookupTable.js",
    "Rendering/ColorTransferFunction.js": "color/ColorTransferFunction.js",
    "Mappers/PolyDataMapper.js": "mappers/PolyDataMapper.js",
    "Mappers/DataSetMapper.js": "mappers/DataSetMapper.js",

    "Actors/Actor.js": "actors/Actor.js",
    "Actors/LineActor.js": "actors/LineActor.js",
    "Actors/SectionActor.js": "actors/SectionActor.js",
    "Actors/VectorGlyphActor.js": "actors/VectorGlyphActor.js",

    "Actors/ScalarBarActor.js": "widgets/ScalarBarActor.js",
    "Actors/OrientationTriadActor.js": "widgets/OrientationTriadActor.js",
    "Actors/CameraNavigationActor.js": "widgets/NavigationCube.js",
    "Actors/MeasurementRulerActor.js": "widgets/MeasurementRuler.js",
    "Actors/ActorHighlighter.js": "interaction/highlight/ActorHighlighter.js",

    "Rendering/RenderWindow.js": "rendering/RenderWindow.js",
    "Rendering/Renderer.js": "rendering/Renderer.js",
    "Rendering/ContourShaderMaterial.js": "rendering/materials/ContourShaderMaterial.js",
    "Rendering/HatchMaterial.js": "rendering/materials/HatchMaterial.js",
    "Rendering/Camera.js": "camera/Camera.js",

    "Camera/CameraState.js": "camera/CameraState.js",
    "Camera/CameraMath.js": "camera/CameraMath.js",
    "Camera/CameraAnimation.js": "camera/CameraAnimation.js",
    "Camera/CameraClipping.js": "camera/CameraClipping.js",

    "Interaction/RenderWindowInteractor.js": "interaction/RenderWindowInteractor.js",
    "Interaction/InteractorStyle.js": "interaction/InteractorStyle.js",
    "Interaction/InteractorStyleOrbit.js": "interaction/InteractorStyleOrbit.js",
    "Interaction/InteractorStyleCAD.js": "interaction/InteractorStyleCAD.js",
    "Interaction/InteractorStyleTrackballCamera.js": "interaction/InteractorStyleTrackballCamera.js",
    "Interaction/InputStyleHandler.js": "interaction/InputStyleHandler.js",
    "Interaction/PickMode.js": "interaction/picking/PickMode.js",
    "Interaction/Picker.js": "interaction/picking/Picker.js",
    "Interaction/SubPicker.js": "interaction/picking/SubPicker.js",
    "Interaction/ActorTopology.js": "interaction/picking/ActorTopology.js",
    "Interaction/PickingController.js": "interaction/picking/PickingController.js",
    "Interaction/SelectionHighlighter.js": "interaction/highlight/SelectionHighlighter.js",
};

// ── File bị XOÁ (logic đã gộp vào nơi khác) ────────────────────────────────
const DELETIONS = {
    "Filters/GeometryFilter.js": "gộp vào geometry/surfaceTopology.js (strategy 'topology')",
    "Filters/externalSurfaceGeometry.js": "gộp vào geometry/surfaceTopology.js",
    "Filters/ExternalSurfaceFilter.js": "gộp vào geometry/surfaceVisibility.js (strategy 'visibility')",
    "Filters/earcut.js": "dùng npm: npm i earcut",
    "Rendering/VTKCamera.js": "gộp vào camera/Camera.js",
    "Camera/Camera.js": "shim re-export, không còn cần",
    "Picking/index.js": "barrel legacy, không còn cần",
};

// ── Đổi tên symbol khi import ──────────────────────────────────────────────
const SPECIFIER_REWRITES = [
    // enum chuyển sang constants.js
    { from: /InteractorStyleOrbit\.js"/, symbols: ["RUBBER_BAND_MODE"], to: "constants.js" },
    { from: /InputStyleHandler\.js"/, symbols: ["NAV_STYLE", "INTERACTION_ACTION"], to: "constants.js" },
];

const BARE_IMPORTS = { "./earcut.js": "earcut", "../Filters/earcut.js": "earcut" };

// ── Thực thi ───────────────────────────────────────────────────────────────
const walk = (dir, out = []) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
        if (e.name === "node_modules" || e.name.startsWith(".")) continue;
        const p = join(dir, e.name);
        e.isDirectory() ? walk(p, out) : extname(p) === ".js" && out.push(p);
    }
    return out;
};

const newPathOf = (oldRel) => MOVES[oldRel] ? join("src", MOVES[oldRel]) : null;
const log = [];
const note = (s) => { log.push(s); console.log(s); };

note(`\n${APPLY ? "ÁP DỤNG" : "DRY-RUN"}  root=${ROOT}\n${"─".repeat(70)}`);

// 1) Cảnh báo file rỗng / thiếu
const topo = join(ROOT, "Interaction/ActorTopology.js");
if (existsSync(topo) && readFileSync(topo).length === 0) {
    note(`\n  ⚠  Interaction/ActorTopology.js RỖNG (0 byte) nhưng SubPicker.js và`);
    note(`     SelectionHighlighter.js import nó. Khôi phục TRƯỚC khi migrate:`);
    note(`       git log --all --diff-filter=D -- '**/ActorTopology.js'\n`);
}

// 2) Xoá
note("\nXOÁ:");
for (const [rel, why] of Object.entries(DELETIONS)) {
    const p = join(ROOT, rel);
    if (!existsSync(p)) { note(`  -  ${rel.padEnd(42)} (không có, bỏ qua)`); continue; }
    note(`  ✗  ${rel.padEnd(42)} ${why}`);
    if (APPLY) rmSync(p);
}

// 3) Di chuyển
note("\nDI CHUYỂN:");
for (const [oldRel, newRel] of Object.entries(MOVES)) {
    const src = join(ROOT, oldRel);
    if (!existsSync(src)) { note(`  -  ${oldRel.padEnd(46)} (không có)`); continue; }
    const dst = join(ROOT, "src", newRel);
    note(`  →  ${oldRel.padEnd(46)} src/${newRel}`);
    if (APPLY) { mkdirSync(dirname(dst), { recursive: true }); renameSync(src, dst); }
}

// 4) Viết lại import
note("\nVIẾT LẠI IMPORT:");
const files = APPLY ? walk(join(ROOT, "src")) : [];
let touched = 0;
for (const file of files) {
    let src = readFileSync(file, "utf8");
    const before = src;

    src = src.replace(/from\s+"([^"]+)"/g, (m, spec) => {
        if (BARE_IMPORTS[spec]) return `from "${BARE_IMPORTS[spec]}"`;
        if (!spec.startsWith(".")) return m;
        const abs = join(dirname(file), spec);
        const oldRel = relative(ROOT, abs).replace(/\\/g, "/");
        const np = newPathOf(oldRel);
        if (!np) return m;
        let r = relative(dirname(file), join(ROOT, np)).replace(/\\/g, "/");
        if (!r.startsWith(".")) r = "./" + r;
        return `from "${r}"`;
    });

    for (const rw of SPECIFIER_REWRITES) {
        if (!rw.from.test(src)) continue;
        for (const sym of rw.symbols) {
            if (src.includes(sym)) {
                note(`     ${relative(ROOT, file)}: ${sym} -> interaction/${rw.to}`);
            }
        }
    }

    if (src !== before) { writeFileSync(file, src); touched++; }
}
note(APPLY ? `\n  ${touched} file đã cập nhật import.` : "\n  (dry-run: không sửa import)");

note(`\n${"─".repeat(70)}`);
note(APPLY
    ? "Xong. Chạy: npm test && npx depcruise --config .dependency-cruiser.cjs src"
    : "Chạy lại với --apply để thực thi.");
note("\nCÒN LẠI THỦ CÔNG (codemod không tự làm được):");
note("  • RUBBER_BAND_MODE / NAV_STYLE / INTERACTION_ACTION -> import từ interaction/constants.js");
note("  • DataSetMapper.setInputData()  -> gọi toSurfacePolyData() thay vì copy-paste");
note("  • VTKReader.parseFile()         -> detect format từ NỘI DUNG khi file.name không có đuôi");
note("  • VTPReader / VTKLegacyReader   -> dùng DataArrayCodec chung");
note("  • Actor.js (680 dòng)           -> tách thành 4 file (Phase 2)");
note("  • InteractorStyleOrbit/CAD      -> extends InteractorStyleNavigation (Phase 2)\n");
