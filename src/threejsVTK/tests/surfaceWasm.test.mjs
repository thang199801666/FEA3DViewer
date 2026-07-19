import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import * as THREE from "three";
import { DataArray } from "../src/core/FieldData.js";
import { CellType } from "../src/core/CellTypes.js";
import { UnstructuredGrid } from "../src/core/UnstructuredGrid.js";
import { PolyData } from "../src/core/PolyData.js";
import { SmoothFilter } from "../src/filters/SmoothFilter.js";
import { WarpFilter } from "../src/filters/WarpFilter.js";
import { ContourFilter } from "../src/filters/ContourFilter.js";
import { ClipFilter } from "../src/filters/ClipFilter.js";
import { CutterFilter } from "../src/filters/CutterFilter.js";
import { weldVertices } from "../src/geometry/weld.js";
import {
    getSurfaceWasmStatus,
    initializeSurfaceWasm,
    tryParseAsciiWasm,
    tryDecodeBase64Wasm,
} from "../src/wasm/surfaceExtractorWasm.js";

function twoTetrahedra() {
    const grid = new UnstructuredGrid();
    grid.setPoints(new Float32Array([
        0, 0, 0,
        1, 0, 0,
        0, 1, 0,
        0, 0, 1,
        0, 0, -1,
    ]));
    grid.setCells(
        new Int32Array([0, 1, 2, 3, 0, 2, 1, 4]),
        new Int32Array([0, 4, 8]),
        new Uint8Array([CellType.TETRA, CellType.TETRA]),
    );
    grid.cellData.addArray(new DataArray("part", new Float32Array([10, 20]), 1), { asScalars: true });
    return grid;
}

function canonicalFaces(polyData) {
    return Array.from(polyData.polys, (face) => Array.from(face).sort((a, b) => a - b).join(","))
        .sort();
}

function filterInput() {
    const data = new PolyData();
    data.setPoints(new Float32Array([
        0, 0, 0,
        2, 0, 0,
        0, 2, 0,
        0, 0, 2,
    ]));
    data.setPolys([[0, 1, 2], [0, 1, 3], [1, 2, 3], [2, 0, 3]]);
    data.pointData.addArray(new DataArray("displacement", new Float32Array([
        1, 0, 0,
        0, 1, 0,
        0, 0, 1,
        -1, -1, -1,
    ]), 3), { asVectors: true });
    data.pointData.addArray(new DataArray("temperature", new Float32Array([0, 1, 2, 3]), 1), { asScalars: true });
    return data;
}

console.log("\nSurface WASM");

const jsOutput = twoTetrahedra().extractSurface();
assert.equal(jsOutput.polys.length, 6, "JavaScript baseline must remove the shared face");
const jsWarp = new WarpFilter().setScaleFactor(2).setInputData(filterInput()).getOutputData();
const jsSmooth = new SmoothFilter().setIterations(4).setRelaxationFactor(0.2)
    .setInputData(filterInput()).getOutputData();
const jsContour = new ContourFilter().setValues([0.5, 1.5]).setInputData(filterInput()).getOutputData();
const jsClip = new ClipFilter().setPlane([1, 0, 0], [0.2, 0, 0]).setInputData(filterInput()).getOutputData();
const jsCut = new CutterFilter().setPlane([1, 0, 0], [0.2, 0, 0]).setFill(false)
    .setInputData(filterInput()).getOutputData();
const weldInput = new THREE.BufferAttribute(new Float32Array([
    -0.00001, 0, 0, -0.000011, 0, 0, 0.99999, 0, 0,
]), 3);
const jsWeld = weldVertices(weldInput, { tolerance: 0.0001 });

const bytes = await readFile(new URL("../src/wasm/surface_extractor.wasm", import.meta.url));
assert.equal(await initializeSurfaceWasm({ bytes }), true, getSurfaceWasmStatus().error?.message);
assert.equal(getSurfaceWasmStatus().ready, true);

const asciiValues = Array.from({ length: 1200 }, (_, i) => `${i % 2 ? "-" : ""}${i}.25e-1`).join(" ");
const parsedAscii = tryParseAsciiWasm(asciiValues, "Float32");
assert.equal(parsedAscii.length, 1200);
assert.ok(Math.abs(parsedAscii[1199] - (-119.925)) < 1e-4);
const asciiIntegers = Array.from({ length: 1800 }, (_, i) => String(i - 900)).join("\n");
assert.deepEqual(Array.from(tryParseAsciiWasm(asciiIntegers, "Int32")), Array.from({ length: 1800 }, (_, i) => i - 900));

const wasmOutput = twoTetrahedra().extractSurface();
assert.equal(wasmOutput.polys.length, 6, "WASM must remove the shared face");
assert.deepEqual(canonicalFaces(wasmOutput), canonicalFaces(jsOutput), "WASM and JS surface topology differ");
assert.deepEqual(
    Array.from(wasmOutput.userData.polySourceCellMap),
    Array.from(jsOutput.userData.polySourceCellMap),
    "source-cell mapping differs",
);
assert.deepEqual(
    Array.from(wasmOutput.cellData.getArray("part").values),
    Array.from(jsOutput.cellData.getArray("part").values),
    "cell-data remapping differs",
);
assert.equal(wasmOutput.polys.connectivity instanceof Int32Array, true);

const wasmWarp = new WarpFilter().setScaleFactor(2).setInputData(filterInput()).getOutputData();
assert.deepEqual(Array.from(wasmWarp.points), Array.from(jsWarp.points), "WASM warp differs from JavaScript");

const wasmSmooth = new SmoothFilter().setIterations(4).setRelaxationFactor(0.2)
    .setInputData(filterInput()).getOutputData();
for (let i = 0; i < wasmSmooth.points.length; ++i) {
    assert.ok(Math.abs(wasmSmooth.points[i] - jsSmooth.points[i]) < 1e-6, `WASM smooth differs at value ${i}`);
}

const wasmContour = new ContourFilter().setValues([0.5, 1.5]).setInputData(filterInput()).getOutputData();
assert.deepEqual(Array.from(wasmContour.lines.connectivity), Array.from(jsContour.lines.connectivity));
for (let i = 0; i < wasmContour.points.length; ++i) {
    assert.ok(Math.abs(wasmContour.points[i] - jsContour.points[i]) < 1e-6, `WASM contour differs at value ${i}`);
}

const wasmClip = new ClipFilter().setPlane([1, 0, 0], [0.2, 0, 0]).setInputData(filterInput()).getOutputData();
assert.deepEqual(Array.from(wasmClip.polys.offsets), Array.from(jsClip.polys.offsets));
assert.deepEqual(Array.from(wasmClip.polys.connectivity), Array.from(jsClip.polys.connectivity));
for (let i = 0; i < wasmClip.points.length; ++i) {
    assert.ok(Math.abs(wasmClip.points[i] - jsClip.points[i]) < 1e-6, `WASM clip point differs at ${i}`);
}
const wasmClipScalars = wasmClip.pointData.getArray("temperature").values;
const jsClipScalars = jsClip.pointData.getArray("temperature").values;
for (let i = 0; i < wasmClipScalars.length; ++i) {
    assert.ok(Math.abs(wasmClipScalars[i] - jsClipScalars[i]) < 1e-6, `WASM clip data differs at ${i}`);
}

const wasmCut = new CutterFilter().setPlane([1, 0, 0], [0.2, 0, 0]).setFill(false)
    .setInputData(filterInput()).getOutputData();
assert.deepEqual(Array.from(wasmCut.lines.connectivity), Array.from(jsCut.lines.connectivity));
for (let i = 0; i < wasmCut.points.length; ++i) {
    assert.ok(Math.abs(wasmCut.points[i] - jsCut.points[i]) < 1e-6, `WASM cutter differs at ${i}`);
}

const wasmWeld = weldVertices(weldInput, { tolerance: 0.0001 });
assert.deepEqual(Array.from(wasmWeld.canon), Array.from(jsWeld.canon));
assert.equal(wasmWeld.count, jsWeld.count);

const base64Payload = new TextEncoder().encode("native base64 payload");
const encodedPayload = Buffer.from(base64Payload).toString("base64");
assert.deepEqual(Array.from(tryDecodeBase64Wasm(encodedPayload)), Array.from(base64Payload));

console.log("  ok  C++/WASM matches filters, welding, numeric parsing and base64 decoding");
